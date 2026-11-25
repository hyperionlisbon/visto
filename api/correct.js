import { getRole, sameOrigin } from './_lib/auth.js';
import { redis, pipeline } from './_lib/redis.js';
import { correct } from './_lib/claude.js';
import { send, fail, lisbonDate, newId, SUBJECTS, summaryOf } from './_lib/util.js';

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 800 * 1024; // after compression in the app (Vercel accepts up to 4.5 MB per request)
const MAX_THUMB_BYTES = 120 * 1024;

function jpegSize(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(b64)) return -1;
  const buf = Buffer.from(b64, 'base64');
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return -1; // must be a JPEG
  return buf.length;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
  if (!sameOrigin(req)) return fail(res, 403, 'Pedido recusado.');

  let role;
  try {
    role = getRole(req);
  } catch (e) {
    return fail(res, 500, e.message);
  }
  if (!role) return fail(res, 401, 'Sessão terminada. Entra outra vez.');

  const { subject, note = '', images, thumbs } = req.body || {};
  if (!SUBJECTS[subject]) return fail(res, 400, 'Escolhe a disciplina.');
  if (!Array.isArray(images) || images.length < 1) return fail(res, 400, 'Junta pelo menos uma fotografia.');
  if (images.length > MAX_PHOTOS) return fail(res, 400, `No máximo ${MAX_PHOTOS} fotografias de cada vez.`);
  for (const img of images) {
    const size = jpegSize(img);
    if (size < 0 || size > MAX_PHOTO_BYTES) return fail(res, 400, 'Fotografia inválida ou demasiado grande.');
  }
  const safeThumbs = (Array.isArray(thumbs) ? thumbs : [])
    .slice(0, MAX_PHOTOS)
    .filter((t) => {
      const size = jpegSize(t);
      return size > 0 && size <= MAX_THUMB_BYTES;
    });
  const safeNote = typeof note === 'string' ? note.slice(0, 300) : '';

  // Daily limit, so a mistake or a lost phone can't run up the bill.
  const limit = Number(process.env.DAILY_LIMIT) || 15;
  const dayKey = `usage:${lisbonDate()}`;
  let used;
  try {
    used = await redis('INCR', dayKey);
    if (used === 1) await redis('EXPIRE', dayKey, 2 * 24 * 3600);
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message);
  }
  if (used > limit) {
    return fail(res, 429, `Chegaste ao limite de ${limit} correções por hoje. Amanhã há mais!`);
  }

  try {
    const { result, usage, model } = await correct({ subject, note: safeNote, images });
    const entry = {
      id: newId(),
      ts: Date.now(),
      subject,
      note: safeNote,
      by: role,
      result,
      thumbs: safeThumbs,
      model,
      usage,
      seenByParent: role === 'parent',
    };
    const summary = summaryOf(entry);
    await pipeline([
      ['SET', `full:${entry.id}`, JSON.stringify(entry)],
      ['SET', `sum:${entry.id}`, JSON.stringify(summary)],
      ['ZADD', 'entries', String(entry.ts), entry.id],
    ]);
    const { thumbs: _omit, usage: _u, ...light } = entry;
    return send(res, 200, { entry: light, summary, remainingToday: Math.max(0, limit - used) });
  } catch (e) {
    console.error(e);
    try {
      await redis('DECR', dayKey); // a failed correction doesn't count
    } catch {}
    return fail(res, 502, e.message);
  }
}
