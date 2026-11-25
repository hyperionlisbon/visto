import { endSession } from './_lib/auth.js';
import { send, fail } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
  endSession(res);
  return send(res, 200, { ok: true });
}
