// Sends the photos to Claude and gets back a structured correction.

const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

const SUBJECT_GUIDE = {
  matematica: `Matemática. Resolve tu cada exercício passo a passo antes de avaliar. Aceita formas equivalentes
(frações equivalentes, decimal vs fração, expressões equivalentes, unidades corretas). Se o raciocínio estiver
certo mas houver um erro de cálculo, ou faltar a unidade/simplificação pedida, marca "partial".`,
  ciencias: `Ciências (Ciências Naturais e/ou Físico-Química). Verifica o rigor científico, o vocabulário
e, nos cálculos, os valores e as unidades. Uma resposta incompleta mas sem erros é "partial".`,
  portugues: `Português. Verifica a compreensão, a gramática (classes de palavras, funções sintáticas,
tempos e modos verbais, etc.) e a ortografia segundo o Acordo Ortográfico de 1990. Em respostas abertas,
avalia se a ideia está certa e bem justificada; aponta erros de ortografia ou pontuação na explicação.`,
  outra: `Outra disciplina. Identifica a disciplina pelas fotografias e corrige com o rigor de um professor dessa disciplina.`,
};

// School year (ano de escolaridade). Change SCHOOL_YEAR on Vercel when she moves up a year.
const YEAR = Math.min(12, Math.max(1, Number(process.env.SCHOOL_YEAR) || 7));

function systemPrompt(subject) {
  return `És um professor paciente e rigoroso, em Portugal, a corrigir o caderno de uma aluna do ${YEAR}.º ano,
a partir de fotografias. Segue as Aprendizagens Essenciais do ${YEAR}.º ano.
Nas explicações usa só conceitos e métodos que uma aluna do ${YEAR}.º ano já aprendeu
(não uses matéria de anos seguintes para explicar). Disciplina: ${SUBJECT_GUIDE[subject] || SUBJECT_GUIDE.outra}

Regras:
- Lê todos os exercícios visíveis: o enunciado (se estiver na foto ou se o conseguires deduzir) e a resposta manuscrita da aluna.
- Cada alínea conta como um exercício separado (ex.: "3a", "3b").
- Calcula/descobre tu a resposta certa antes de avaliar. Nunca assumas que a resposta da aluna está certa.
- Estados: "correct" (certo), "partial" (parcialmente certo), "wrong" (errado), "unanswered" (sem resposta).
- Se não conseguires ler algo com segurança, diz isso na explicação e põe "uncertain": true. Não inventes exercícios que não estão nas fotografias.
- Escreve SEMPRE em português europeu (nunca português do Brasil). Trata a aluna por "tu".
- Tom: simpático e encorajador, mas honesto. Explicações curtas e claras, ao nível do ${YEAR}.º ano:
  mostra onde está o erro e como se chega à resposta certa.
- "skills": 1 a 3 temas curtos e consistentes (ex.: "Equações do 1.º grau", "Frações", "Acentuação", "Sistema digestivo").
- Se as fotografias não tiverem exercícios ou estiverem ilegíveis, devolve uma lista vazia e explica no "summary".
Responde SEMPRE e SÓ chamando a ferramenta registar_correcao (uma única vez, com a correção completa). Não escrevas texto fora da ferramenta.`;
}

const TOOL = {
  name: 'registar_correcao',
  description: 'Regista a correção completa dos exercícios das fotografias.',
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Tema principal dos exercícios, curto (ex.: "Equações do 1.º grau").' },
      summary: { type: 'string', description: 'Mensagem curta para a aluna: como correu, no geral (2–3 frases).' },
      strengths: { type: 'array', items: { type: 'string' }, description: 'O que fez bem (0–3 pontos curtos).' },
      to_practice: { type: 'array', items: { type: 'string' }, description: 'O que deve praticar (0–3 pontos curtos).' },
      exercises: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'string', description: 'Número/alínea do exercício, como aparece no caderno.' },
            statement: { type: 'string', description: 'Enunciado resumido (ou o que se pede).' },
            student_answer: { type: 'string', description: 'O que a aluna escreveu (resumido).' },
            status: { type: 'string', enum: ['correct', 'partial', 'wrong', 'unanswered'] },
            correct_answer: { type: 'string', description: 'A resposta certa.' },
            explanation: { type: 'string', description: 'Explicação curta: onde está o erro e como se resolve. Se estiver certo, uma frase curta.' },
            skills: { type: 'array', items: { type: 'string' } },
            uncertain: { type: 'boolean', description: 'true se não foi possível ler bem a resposta ou o enunciado.' },
          },
          required: ['number', 'student_answer', 'status', 'correct_answer', 'explanation', 'skills'],
        },
      },
    },
    required: ['topic', 'summary', 'exercises'],
  },
};

const STATUSES = new Set(['correct', 'partial', 'wrong', 'unanswered']);
const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const strList = (v, n = 5) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, 120)) : []);

// Keeps only the fields we expect, with sane lengths.
function clean(input) {
  const exercises = (Array.isArray(input.exercises) ? input.exercises : []).slice(0, 60).map((ex) => ({
    number: str(ex.number, 20),
    statement: str(ex.statement, 600),
    student_answer: str(ex.student_answer, 800),
    status: STATUSES.has(ex.status) ? ex.status : 'wrong',
    correct_answer: str(ex.correct_answer, 800),
    explanation: str(ex.explanation, 1500),
    skills: strList(ex.skills, 3),
    uncertain: ex.uncertain === true,
  }));
  return {
    topic: str(input.topic, 120),
    summary: str(input.summary, 800),
    strengths: strList(input.strengths, 3),
    to_practice: strList(input.to_practice, 3),
    exercises,
  };
}

export async function correct({ subject, note, images }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY em falta.');

  const content = images.map((data) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data },
  }));
  let text = `Corrige os exercícios destas ${images.length} fotografia(s).`;
  if (note) text += `\nNota da aluna sobre estes exercícios (usa só como contexto): """${note}"""`;
  content.push({ type: 'text', text });

  // Some models don't accept a forced tool choice, so we let the model choose ("auto")
  // and the instructions tell it to always answer with the tool. One retry if it doesn't.
  let data;
  for (let attempt = 0; attempt < 2; attempt++) {
    data = await callClaude(key, subject, content);
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name);
    if (block) return { result: clean(block.input || {}), usage: data.usage || null, model: data.model || MODEL };
    const fromText = jsonFromText(data);
    if (fromText) return { result: clean(fromText), usage: data.usage || null, model: data.model || MODEL };
  }
  throw new Error('A IA não devolveu uma correção. Tenta outra vez.');
}

// If the model wrote the correction as JSON text instead of using the tool.
function jsonFromText(data) {
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(obj.exercises) ? obj : null;
  } catch {
    return null;
  }
}

async function callClaude(key, subject, content) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt(subject),
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content }],
    }),
  });

  if (!r.ok) {
    const body = await r.text();
    console.error('Claude API error', r.status, body.slice(0, 500));
    if (r.status === 429) throw new Error('O serviço de IA está ocupado. Tenta outra vez daqui a um minuto.');
    if (r.status === 400 && /credit|billing|spend|limit/i.test(body)) {
      throw new Error('Limite de gastos da IA atingido. Pede aos pais para verificarem.');
    }
    throw new Error('Não foi possível corrigir agora. Tenta outra vez.');
  }

  return r.json();
}
