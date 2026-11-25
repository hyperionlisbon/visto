import { roleForPassword, startSession, sameOrigin } from './_lib/auth.js';
import { redis } from './_lib/redis.js';
import { send, fail, clientIp } from './_lib/util.js';

const MAX_FAILS = 8; // wrong attempts allowed per 15 minutes, per device/network

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
  if (!sameOrigin(req)) return fail(res, 403, 'Pedido recusado.');
  try {
    const key = `loginfail:${clientIp(req)}`;
    const fails = Number(await redis('GET', key)) || 0;
    if (fails >= MAX_FAILS) return fail(res, 429, 'Demasiadas tentativas. Espera 15 minutos.');

    const role = roleForPassword(req.body?.password);
    if (!role) {
      await redis('INCR', key);
      await redis('EXPIRE', key, 900);
      return fail(res, 401, 'Palavra-passe errada.');
    }
    await redis('DEL', key);
    startSession(res, role);
    return send(res, 200, { role });
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message);
  }
}
