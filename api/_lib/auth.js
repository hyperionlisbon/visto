// Login with two passwords (one for the student, one for the parents).
// The session is a signed, HttpOnly cookie, so JavaScript in the page can't read it.
import crypto from 'node:crypto';

const COOKIE = 'visto_session';
const DAY = 24 * 60 * 60;
const LIFETIME = { student: 90 * DAY, parent: 30 * DAY };

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET em falta ou demasiado curto (mín. 32 caracteres).');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hmac(data) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

function sameText(a, b) {
  // Constant-time comparison of two strings (compares their hashes).
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function roleForPassword(password) {
  const student = process.env.STUDENT_PASSWORD;
  const parent = process.env.PARENT_PASSWORD;
  if (!student || !parent) throw new Error('Palavras-passe não configuradas.');
  if (typeof password !== 'string' || !password) return null;
  // Check both so the timing does not reveal which one matched.
  const isParent = sameText(password, parent);
  const isStudent = sameText(password, student);
  if (isParent) return 'parent';
  if (isStudent) return 'student';
  return null;
}

export function startSession(res, role) {
  const payload = b64url(JSON.stringify({ role, exp: Date.now() + LIFETIME[role] * 1000 }));
  const token = `${payload}.${hmac(payload)}`;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${LIFETIME[role]}`
  );
}

export function endSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
}

export function getRole(req) {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return null;
  const token = match.slice(COOKIE.length + 1);
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (!sameText(sig, hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    if (data.role !== 'student' && data.role !== 'parent') return null;
    return data.role;
  } catch {
    return null;
  }
}

// Blocks requests that come from other websites (extra protection on top of SameSite).
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
