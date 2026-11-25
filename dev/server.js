// Local test server: serves /public, runs the /api functions, and fakes Redis + the Claude API.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- fake Redis (Upstash REST) ----
const db = new Map();
const zset = new Map();
function run(cmd) {
  const [op, ...a] = cmd;
  switch (op.toUpperCase()) {
    case 'GET': return db.has(a[0]) ? db.get(a[0]) : null;
    case 'SET': db.set(a[0], a[1]); return 'OK';
    case 'DEL': return db.delete(a[0]) ? 1 : 0;
    case 'INCR': { const v = Number(db.get(a[0]) || 0) + 1; db.set(a[0], String(v)); return v; }
    case 'DECR': { const v = Number(db.get(a[0]) || 0) - 1; db.set(a[0], String(v)); return v; }
    case 'EXPIRE': return 1;
    case 'MGET': return a.map((k) => (db.has(k) ? db.get(k) : null));
    case 'ZADD': zset.set(a[2], Number(a[1])); return 1;
    case 'ZREM': return zset.delete(a[1]) ? 1 : 0;
    case 'ZREVRANGE': return [...zset.entries()].sort((x, y) => y[1] - x[1]).map((x) => x[0]).slice(Number(a[1]), Number(a[2]) + 1);
    default: throw new Error('unsupported ' + op);
  }
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const data = JSON.parse(body);
    const out = req.url.endsWith('/pipeline') ? data.map((c) => ({ result: run(c) })) : { result: run(data) };
    res.end(JSON.stringify(out));
  });
}).listen(8801);

// ---- fake Claude API ----
const SAMPLE = {
  topic: 'Equações do 1.º grau',
  summary: 'Bom trabalho! Resolveste bem a maioria das equações. Atenção aos sinais quando passas termos para o outro membro.',
  strengths: ['Isolar a incógnita', 'Organização dos cálculos'],
  to_practice: ['Trocar o sinal ao mudar de membro', 'Desembaraçar de parênteses'],
  exercises: [
    { number: '1a', statement: '2x + 3 = 11', student_answer: 'x = 4', status: 'correct', correct_answer: 'x = 4', explanation: 'Certo! 2x = 8, logo x = 4.', skills: ['Equações do 1.º grau'] },
    { number: '1b', statement: '5x − 7 = 3x + 5', student_answer: 'x = -1', status: 'wrong', correct_answer: 'x = 6', explanation: 'Ao passar −7 para o outro membro, fica +7: 5x − 3x = 5 + 7, logo 2x = 12 e x = 6. Trocaste o sinal do 7.', skills: ['Equações do 1.º grau', 'Sinais'] },
    { number: '1c', statement: '3(x − 2) = 9', student_answer: '3x − 2 = 9 → x = 11/3', status: 'partial', correct_answer: 'x = 5', explanation: 'O método está certo, mas o 3 multiplica também o 2: 3x − 6 = 9, 3x = 15, x = 5.', skills: ['Propriedade distributiva'] },
    { number: '2', statement: 'O dobro de um número mais 4 é 20. Qual é o número?', student_answer: '', status: 'unanswered', correct_answer: '8', explanation: 'Escreve a equação 2x + 4 = 20 e resolve: 2x = 16, x = 8.', skills: ['Problemas com equações'], uncertain: true },
  ],
};
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const data = JSON.parse(body);
    console.log('[fake claude] model', data.model, 'images', data.messages[0].content.filter((c) => c.type === 'image').length);
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: data.model, content: [{ type: 'tool_use', id: 't1', name: 'registar_correcao', input: SAMPLE }], usage: { input_tokens: 1, output_tokens: 1 } }));
    }, 800);
  });
}).listen(8802);

// ---- env, as on Vercel ----
Object.assign(process.env, {
  KV_REST_API_URL: 'http://localhost:8801',
  KV_REST_API_TOKEN: 'dev',
  ANTHROPIC_BASE_URL: 'http://localhost:8802',
  ANTHROPIC_API_KEY: 'dev',
  SESSION_SECRET: 'dev-secret-dev-secret-dev-secret-0123456789',
  STUDENT_PASSWORD: process.env.STUDENT_PASSWORD || 'aluna123',
  PARENT_PASSWORD: process.env.PARENT_PASSWORD || 'pais123',
});

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
    const file = path.join(root, 'api', name + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{}'); }
    let raw = '';
    for await (const c of req) raw += c;
    req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : {};
    req.query = Object.fromEntries(url.searchParams);
    const mod = await import(file);
    return mod.default(req, res);
  }
  let p = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!p.startsWith(path.join(root, 'public')) || !fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(p).pipe(res);
}).listen(3000, () => console.log('http://localhost:3000'));
