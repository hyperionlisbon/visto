import { getRole } from './_lib/auth.js';
import { send, fail } from './_lib/util.js';

export default async function handler(req, res) {
  try {
    const role = getRole(req);
    return send(res, 200, { role, studentName: process.env.STUDENT_NAME || '' });
  } catch (e) {
    return fail(res, 500, e.message);
  }
}
