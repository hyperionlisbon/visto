import { getRole } from './_lib/auth.js';
import { redis } from './_lib/redis.js';
import { send, fail, lisbonDate } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return fail(res, 405, 'Método não permitido.');
  try {
    const role = getRole(req);
    if (!role) return fail(res, 401, 'Sessão terminada. Entra outra vez.');

    const ids = await redis('ZREVRANGE', 'entries', '0', '499');
    let items = [];
    if (ids && ids.length) {
      const raw = await redis('MGET', ...ids.map((id) => `sum:${id}`));
      items = raw.filter(Boolean).map((r) => JSON.parse(r));
    }
    const usedToday = Number(await redis('GET', `usage:${lisbonDate()}`)) || 0;
    const limit = Number(process.env.DAILY_LIMIT) || 15;
    return send(res, 200, { role, items, remainingToday: Math.max(0, limit - usedToday), limit });
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message);
  }
}
