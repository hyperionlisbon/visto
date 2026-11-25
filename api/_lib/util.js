// Small helpers shared by every API route.

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export function fail(res, status, message) {
  send(res, status, { error: message });
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Date in Lisbon, used for the daily upload limit.
export function lisbonDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' }).format(d);
}

export function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return Date.now().toString(36) + rand;
}

export const SUBJECTS = {
  matematica: 'Matemática',
  ciencias: 'Ciências',
  portugues: 'Português',
  outra: 'Outra disciplina',
};

// Turns the list of corrected exercises into a score.
export function scoreOf(exercises) {
  let got = 0;
  let total = 0;
  for (const ex of exercises) {
    const status = ex.override || ex.status;
    total += 1;
    if (status === 'correct') got += 1;
    else if (status === 'partial') got += 0.5;
  }
  const pct = total ? Math.round((got / total) * 100) : null;
  return { got, total, pct };
}

export function summaryOf(entry) {
  const { got, total, pct } = scoreOf(entry.result.exercises);
  const weak = [];
  for (const ex of entry.result.exercises) {
    const status = ex.override || ex.status;
    if (status === 'wrong' || status === 'partial') weak.push(...(ex.skills || []));
  }
  return {
    id: entry.id,
    ts: entry.ts,
    subject: entry.subject,
    topic: entry.result.topic || '',
    note: entry.note || '',
    got,
    total,
    pct,
    weak,
    flags: entry.result.exercises.filter((e) => e.flagged && !e.flagResolved).length,
    uncertain: entry.result.exercises.filter((e) => e.uncertain).length,
    seenByParent: !!entry.seenByParent,
  };
}
