// Minimal client for Upstash Redis (REST API). No dependencies.
// The Upstash integration on Vercel creates these variables automatically.

const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

function check() {
  if (!BASE || !TOKEN) throw new Error('Base de dados não configurada (Upstash Redis).');
}

export async function redis(...command) {
  check();
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (data.error) throw new Error(`Redis: ${data.error}`);
  return data.result;
}

export async function pipeline(commands) {
  check();
  const r = await fetch(`${BASE.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  const data = await r.json();
  for (const item of data) if (item.error) throw new Error(`Redis: ${item.error}`);
  return data.map((item) => item.result);
}

export async function getJson(key) {
  const raw = await redis('GET', key);
  return raw ? JSON.parse(raw) : null;
}
