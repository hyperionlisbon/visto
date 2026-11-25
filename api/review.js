// The student can flag an exercise she thinks the AI got wrong.
// The parents can change the grade of an exercise, or clear the flag.
import { getRole, sameOrigin } from './_lib/auth.js';
import { pipeline, getJson } from './_lib/redis.js';
import { send, fail, summaryOf } from './_lib/util.js';

const ID = /^[a-z0-9]{6,30}$/;
const STATUSES = new Set(['correct', 'partial', 'wrong', 'unanswered']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
  if (!sameOrigin(req)) return fail(res, 403, 'Pedido recusado.');
  try {
    const role = getRole(req);
    if (!role) return fail(res, 401, 'Sessão terminada. Entra outra vez.');

    const { id, index, action, status, comment } = req.body || {};
    if (!ID.test(String(id))) return fail(res, 400, 'Correção não encontrada.');
    const entry = await getJson(`full:${id}`);
    if (!entry) return fail(res, 404, 'Correção não encontrada.');
    const ex = entry.result.exercises[Number(index)];
    if (!ex) return fail(res, 400, 'Exercício não encontrado.');

    if (action === 'flag') {
      ex.flagged = true;
      ex.flagResolved = false;
      ex.flagComment = typeof comment === 'string' ? comment.slice(0, 300) : '';
    } else if (action === 'unflag') {
      ex.flagged = false;
      ex.flagComment = '';
    } else if (action === 'set') {
      if (role !== 'parent') return fail(res, 403, 'Só os pais podem mudar a avaliação.');
      if (status === null || status === ex.status) delete ex.override;
      else if (STATUSES.has(status)) ex.override = status;
      else return fail(res, 400, 'Avaliação inválida.');
      if (ex.flagged) ex.flagResolved = true;
    } else if (action === 'resolve') {
      if (role !== 'parent') return fail(res, 403, 'Só os pais podem fazer isto.');
      ex.flagResolved = true;
    } else {
      return fail(res, 400, 'Ação inválida.');
    }

    const summary = summaryOf(entry);
    await pipeline([
      ['SET', `full:${id}`, JSON.stringify(entry)],
      ['SET', `sum:${id}`, JSON.stringify(summary)],
    ]);
    const { usage: _u, ...out } = entry;
    return send(res, 200, { entry: out, summary });
  } catch (e) {
    console.error(e);
    return fail(res, 500, e.message);
  }
}
