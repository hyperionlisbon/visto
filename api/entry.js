import { getRole, sameOrigin } from './_lib/auth.js';
import { redis, pipeline, getJson } from './_lib/redis.js';
import { send, fail, summaryOf } from './_lib/util.js';

const ID = /^[a-z0-9]{6,30}$/;

export default async function handler(req, res) {
  try {
    const role = getRole(req);
    if (!role) return fail(res, 401, 'Sessão terminada. Entra outra vez.');
    const id = String(req.query?.id || new URL(req.url, 'http://x').searchParams.get('id') || '');
    if (!ID.test(id)) return fail(res, 400, 'Correção não encontrada.');

    if (req.method === 'GET') {
      const entry = await getJson(`full:${id}`);
      if (!entry) return fail(res, 404, 'Correção não encontrada.');
      if (role === 'parent' && !entry.seenByParent) {
        entry.seenByParent = true;
        await pipeline([
          ['SET', `full:${id}`, JSON.stringify(entry)],
          ['SET', `sum:${id}`, JSON.stringify(summaryOf(entry))],
        ]);
      }
      const { usage: _u, ...out } = entry;
      return send(res, 200, { entry: out, summary: summaryOf(entry) });
    }

    if (req.method === 'DELETE') {
      if (!sameOrigin(req)) return fail(res, 403, 'Pedido recusado.');
      if (role !== 'parent') return fail(res, 403, 'Só os pais podem apagar correções.');
      await pipeline([
        ['DEL', `full:${id}`],
        ['DEL', `sum:${id}`],
        ['ZREM', 'entries', id],
      ]);
      return send(res, 200, { ok: true });
    }

    return fail(res, 405, 'Método não permitido.');
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message);
  }
}
