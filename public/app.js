'use strict';
// Visto — app screens. No libraries; every piece of text from the AI is inserted as text (never as HTML).

const SUBJECTS = { matematica: 'Matemática', ciencias: 'Ciências', portugues: 'Português', outra: 'Outra' };
const STATUS_LABEL = { correct: 'Certo', partial: 'Parcial', wrong: 'Errado', unanswered: 'Sem resposta' };
const MAX_PHOTOS = 4;

const state = {
  role: null,
  name: '',
  items: [],
  remaining: null,
  limit: null,
  entries: {},
  filter: 'all',
  busy: false,
  draft: { subject: null, note: '', photos: [] },
};

const $view = document.getElementById('view');
const $tabbar = document.getElementById('tabbar');
const $topbar = document.getElementById('topbar');

/* ---------------- helpers ---------------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const c of children) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let r;
  try {
    r = await fetch(path, init);
  } catch {
    throw new Error('Sem ligação à internet. Tenta outra vez.');
  }
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && path !== '/api/login') {
    state.role = null;
    go('#entrar');
  }
  if (!r.ok) throw new Error(data.error || 'Algo correu mal. Tenta outra vez.');
  return data;
}

const fmtDate = (ts) =>
  new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
const fmtDay = (ts) => new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short' }).format(ts);
const bucket = (pct) => (pct === null || pct === undefined ? 'na' : pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo');
const statusOf = (ex) => ex.override || ex.status;

function verdict(pct) {
  if (pct === null) return 'Hmm…';
  if (pct >= 90) return 'Excelente!';
  if (pct >= 75) return 'Muito bem!';
  if (pct >= 50) return 'Bom trabalho';
  return 'Vamos rever';
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function showPhoto(src) {
  const dlg = document.getElementById('photo-dialog');
  document.getElementById('photo-dialog-img').src = src;
  dlg.showModal();
}

/* ---------------- photos ---------------- */

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

function toJpeg(source, maxDim, quality, maxBytes) {
  const w0 = source.width;
  const h0 = source.height;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w0 * scale);
  canvas.height = Math.round(h0 * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  let q = quality;
  let data = canvas.toDataURL('image/jpeg', q);
  // base64 is ~4/3 of the real size
  while (data.length * 0.75 > maxBytes && q > 0.35) {
    q -= 0.08;
    data = canvas.toDataURL('image/jpeg', q);
  }
  return data;
}

async function preparePhoto(file) {
  const bmp = await loadBitmap(file);
  const full = toJpeg(bmp, 1800, 0.85, 600 * 1024); // 4 photos stay under the 4.5 MB request limit
  const thumb = toJpeg(bmp, 720, 0.65, 100 * 1024);
  if (bmp.close) bmp.close();
  return { full: full.split(',')[1], thumb: thumb.split(',')[1], thumbUrl: thumb };
}

/* ---------------- shell ---------------- */

const TABS = {
  student: [
    ['#novo', '📷', 'Corrigir'],
    ['#historico', '📚', 'Histórico'],
  ],
  parent: [
    ['#resumo', '📊', 'Resumo'],
    ['#historico', '📚', 'Histórico'],
    ['#novo', '📷', 'Corrigir'],
  ],
};

function renderShell(activeHash) {
  const logged = !!state.role;
  $topbar.hidden = !logged;
  $tabbar.hidden = !logged;
  $tabbar.replaceChildren();
  if (!logged) return;
  for (const [hash, ico, label] of TABS[state.role]) {
    $tabbar.append(
      h('button', { class: 'tab' + (activeHash.startsWith(hash) ? ' active' : ''), onclick: () => go(hash) },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), label)
    );
  }
}

async function refreshHistory() {
  const data = await api('/api/history');
  state.items = data.items;
  state.remaining = data.remainingToday;
  state.limit = data.limit;
}

async function render() {
  const hash = location.hash || '';
  if (!state.role) {
    renderShell('');
    return $view.replaceChildren(loginView());
  }
  const home = state.role === 'parent' ? '#resumo' : '#novo';
  const route = hash || home;
  renderShell(route);
  window.scrollTo(0, 0);
  try {
    if (route.startsWith('#c/')) return $view.replaceChildren(await resultView(route.slice(3)));
    if (route === '#historico') return $view.replaceChildren(historyView());
    if (route === '#novo') return $view.replaceChildren(newView());
    if (route === '#resumo' && state.role === 'parent') return $view.replaceChildren(dashboardView());
    go(home);
  } catch (e) {
    $view.replaceChildren(h('div', { class: 'card center' }, h('p', { class: 'error' }, e.message),
      h('button', { class: 'btn', onclick: () => go(home) }, 'Voltar')));
  }
}

/* ---------------- login ---------------- */

function loginView() {
  const input = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', placeholder: 'Palavra-passe', required: true });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Entrar');
  const form = h('form', {
    class: 'stack',
    onsubmit: async (ev) => {
      ev.preventDefault();
      btn.disabled = true;
      err.textContent = '';
      try {
        const data = await api('/api/login', { method: 'POST', body: { password: input.value } });
        state.role = data.role;
        await refreshHistory();
        location.hash = '';
        render();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
      }
    },
  }, h('label', { class: 'lbl', for: 'pw' }, 'Palavra-passe'), input, btn, err);

  return h('section', { class: 'login' },
    h('div', { class: 'card' },
      h('div', { class: 'brand-mark big-mark', 'aria-hidden': 'true' }, '✓'),
      h('h1', { class: 'center' }, 'Visto'),
      h('p', { class: 'sub center' }, 'Correção de exercícios'),
      form));
}

/* ---------------- new correction ---------------- */

function newView() {
  const d = state.draft;
  const wrap = h('section', {});

  const redraw = () => wrap.replaceChildren(...build());

  const pick = (capture) => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: capture ? null : true, capture: capture ? 'environment' : null, hidden: true });
    input.addEventListener('change', async () => {
      const files = [...input.files].slice(0, MAX_PHOTOS - d.photos.length);
      for (const f of files) {
        try {
          d.photos.push(await preparePhoto(f));
        } catch {
          alert('Não consegui abrir esta fotografia. Tenta outra.');
        }
      }
      input.remove();
      redraw();
    });
    document.body.append(input);
    input.click();
  };

  const submit = async () => {
    if (state.busy) return;
    state.busy = true;
    const msgs = ['A ler o caderno…', 'A resolver os exercícios…', 'A comparar com as tuas respostas…', 'Quase pronto…'];
    let i = 0;
    const msg = h('p', { class: 'muted' }, msgs[0]);
    const timer = setInterval(() => { i = Math.min(i + 1, msgs.length - 1); msg.textContent = msgs[i]; }, 6000);
    wrap.replaceChildren(h('div', { class: 'card working' }, h('div', { class: 'pen' }), h('h2', {}, 'A corrigir…'), msg,
      h('p', { class: 'small muted' }, 'Pode demorar até um minuto.')));
    try {
      const data = await api('/api/correct', {
        method: 'POST',
        body: { subject: d.subject, note: d.note, images: d.photos.map((p) => p.full), thumbs: d.photos.map((p) => p.thumb) },
      });
      state.entries[data.entry.id] = { ...data.entry, thumbs: d.photos.map((p) => p.thumb) };
      state.items.unshift(data.summary);
      state.remaining = data.remainingToday;
      state.draft = { subject: null, note: '', photos: [] };
      go('#c/' + data.entry.id);
    } catch (e) {
      redraw();
      wrap.prepend(h('div', { class: 'card', role: 'alert' }, h('p', { class: 'error' }, e.message)));
    } finally {
      clearInterval(timer);
      state.busy = false;
    }
  };

  function build() {
    const greeting = state.role === 'parent' ? 'Nova correção' : 'Olá!';
    const ready = d.subject && d.photos.length;
    const recent = state.items.slice(0, 3);
    return [
      h('h1', {}, greeting),
      h('p', { class: 'sub' }, 'Tira uma fotografia aos exercícios e a correção aparece aqui.'),
      h('div', { class: 'card stack' },
        h('label', { class: 'lbl' }, '1. Disciplina'),
        h('div', { class: 'chips' }, Object.entries(SUBJECTS).map(([k, v]) =>
          h('button', { class: 'chip', 'aria-pressed': String(d.subject === k), onclick: () => { d.subject = k; redraw(); } }, v))),
      ),
      h('div', { class: 'card stack', style: null },
        h('label', { class: 'lbl' }, `2. Fotografias (${d.photos.length}/${MAX_PHOTOS})`),
        d.photos.length
          ? h('div', { class: 'thumbs' }, d.photos.map((p, idx) =>
              h('div', { class: 'thumb' },
                h('img', { src: p.thumbUrl, alt: `Página ${idx + 1}`, onclick: () => showPhoto(p.thumbUrl) }),
                h('button', { class: 'x', 'aria-label': 'Tirar fotografia', onclick: () => { d.photos.splice(idx, 1); redraw(); } }, '×'))))
          : h('div', { class: 'drop-hint small' }, 'Fotografa a página inteira, com boa luz e sem sombras.'),
        d.photos.length < MAX_PHOTOS
          ? h('div', { class: 'photo-picks' },
              h('button', { class: 'btn', onclick: () => pick(true) }, '📷 Câmara'),
              h('button', { class: 'btn', onclick: () => pick(false) }, '🖼️ Galeria'))
          : null,
      ),
      h('div', { class: 'card stack' },
        h('label', { class: 'lbl', for: 'note' }, '3. Que exercícios são? ', h('span', { class: 'muted small' }, '(opcional)')),
        h('input', { type: 'text', id: 'note', maxlength: '300', value: d.note, placeholder: 'Ex.: Página 45, exercícios 1 a 6',
          oninput: (e) => { d.note = e.target.value; } }),
      ),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', disabled: !ready, onclick: submit }, '✓ Corrigir'),
        state.remaining !== null
          ? h('p', { class: 'small muted center' }, `Ainda podes fazer ${state.remaining} correções hoje.`)
          : null),
      recent.length ? h('h2', {}, 'Últimas correções') : null,
      recent.length ? h('div', { class: 'list' }, recent.map(itemRow)) : null,
    ];
  }

  redraw();
  return wrap;
}

/* ---------------- result ---------------- */

function ring(pct) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const color = { hi: '#1f8a5b', mid: '#b9780a', lo: '#c8382a', na: '#9a978f' }[bucket(pct)];
  return s('svg', { class: 'ring', viewBox: '0 0 96 96', role: 'img', 'aria-label': pct === null ? 'Sem nota' : `${pct}%` },
    s('circle', { cx: 48, cy: 48, r, fill: 'none', stroke: '#eeede9', 'stroke-width': 9 }),
    s('circle', { cx: 48, cy: 48, r, fill: 'none', stroke: color, 'stroke-width': 9, 'stroke-linecap': 'round',
      'stroke-dasharray': `${((pct || 0) / 100) * c} ${c}`, transform: 'rotate(-90 48 48)' }),
    s('text', { x: 48, y: 54, 'text-anchor': 'middle', 'font-size': 22, fill: '#1d2433' }, pct === null ? '–' : `${pct}%`));
}

async function getEntry(id) {
  if (state.entries[id] && state.entries[id].thumbs) return state.entries[id];
  const data = await api('/api/entry?id=' + encodeURIComponent(id));
  state.entries[id] = data.entry;
  updateSummary(data.summary);
  return data.entry;
}

function updateSummary(summary) {
  const i = state.items.findIndex((x) => x.id === summary.id);
  if (i >= 0) state.items[i] = summary;
}

async function review(entry, index, action, extra = {}) {
  const data = await api('/api/review', { method: 'POST', body: { id: entry.id, index, action, ...extra } });
  state.entries[entry.id] = { ...data.entry, thumbs: entry.thumbs };
  updateSummary(data.summary);
  return state.entries[entry.id];
}

async function resultView(id) {
  const entry = await getEntry(id);
  const wrap = h('section', {});
  const isParent = state.role === 'parent';

  const redraw = (e) => wrap.replaceChildren(...build(e));

  function exCard(e, ex, idx) {
    const st = statusOf(ex);
    const actions = [];
    if (isParent) {
      const sel = h('select', { 'aria-label': 'Avaliação', onchange: async (ev) => {
        try { redraw(await review(e, idx, 'set', { status: ev.target.value })); } catch (err) { alert(err.message); }
      } }, Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k, selected: k === st }, v)));
      actions.push(h('span', { class: 'small muted' }, 'Avaliação:'), sel);
      if (ex.override) actions.push(h('span', { class: 'small muted' }, `(IA: ${STATUS_LABEL[ex.status]})`));
      if (ex.flagged && !ex.flagResolved) {
        actions.push(h('button', { class: 'btn small', onclick: async () => {
          try { redraw(await review(e, idx, 'resolve')); } catch (err) { alert(err.message); }
        } }, 'A IA estava certa'));
      }
    } else if (!ex.flagged) {
      actions.push(h('button', { class: 'btn small', onclick: async () => {
        const comment = prompt('Porque achas que a correção está errada? (opcional)') ;
        if (comment === null) return;
        try { redraw(await review(e, idx, 'flag', { comment })); } catch (err) { alert(err.message); }
      } }, '🚩 Acho que a correção está errada'));
    } else {
      actions.push(h('button', { class: 'btn small', onclick: async () => {
        try { redraw(await review(e, idx, 'unflag')); } catch (err) { alert(err.message); }
      } }, 'Retirar aviso'));
    }

    let flagNote = null;
    if (ex.flagged) {
      const who = isParent ? 'A aluna acha que esta correção está errada' : 'Avisaste que esta correção pode estar errada. Os pais vão ver.';
      flagNote = h('div', { class: 'flag-note' }, '🚩 ', ex.flagResolved ? 'Aviso já revisto pelos pais.' : who,
        ex.flagComment ? h('div', {}, h('em', {}, '“', ex.flagComment, '”')) : null);
    }

    return h('article', { class: `card ex ${st}` },
      h('div', { class: 'ex-head' },
        h('span', { class: 'ex-num' }, ex.number || `#${idx + 1}`),
        h('span', { class: `status ${st}` }, STATUS_LABEL[st]),
        ex.override ? h('span', { class: 'tag' }, 'revisto') : null),
      ex.statement ? h('p', { class: 'ex-statement' }, ex.statement) : null,
      h('dl', { class: 'answer' },
        h('dt', {}, 'Resposta'), h('dd', { class: 'hand' }, ex.student_answer || '—'),
        st !== 'correct' ? [h('dt', {}, 'Certo'), h('dd', { class: 'right' }, ex.correct_answer || '—')] : null),
      ex.explanation ? h('div', { class: 'explain' }, ex.explanation) : null,
      ex.uncertain ? h('p', { class: 'warn' }, '⚠️ A IA não conseguiu ler isto com certeza.') : null,
      ex.skills && ex.skills.length ? h('div', { class: 'chips', style: null }, ex.skills.map((k) => h('span', { class: 'tag' }, k))) : null,
      flagNote,
      h('div', { class: 'ex-actions' }, actions));
  }

  function build(e) {
    const exs = e.result.exercises;
    let got = 0;
    for (const ex of exs) got += statusOf(ex) === 'correct' ? 1 : statusOf(ex) === 'partial' ? 0.5 : 0;
    const pct = exs.length ? Math.round((got / exs.length) * 100) : null;
    const r = e.result;
    return [
      h('button', { class: 'link-btn', onclick: () => history.length > 1 ? history.back() : go('#historico') }, '← Voltar'),
      h('div', { class: 'card paper stack' },
        h('div', { class: 'row' }, h('span', { class: 'tag' }, SUBJECTS[e.subject] || e.subject),
          h('span', { class: 'small muted' }, fmtDate(e.ts))),
        h('div', { class: 'score-head' },
          ring(pct),
          h('div', { class: 'grow' },
            h('span', { class: 'verdict' }, verdict(pct)),
            h('h1', {}, r.topic || SUBJECTS[e.subject]),
            h('div', { class: 'muted small' }, `${String(got).replace('.', ',')} de ${exs.length} exercícios certos`))),
        r.summary ? h('p', {}, r.summary) : null,
        e.note ? h('p', { class: 'small muted' }, 'Nota: ', e.note) : null,
        (r.strengths.length || r.to_practice.length)
          ? h('div', { class: 'lists' },
              r.strengths.length ? h('div', {}, h('h3', {}, '👍 Correu bem'), h('ul', {}, r.strengths.map((x) => h('li', {}, x)))) : null,
              r.to_practice.length ? h('div', {}, h('h3', {}, '🎯 Para praticar'), h('ul', {}, r.to_practice.map((x) => h('li', {}, x)))) : null)
          : null,
        e.thumbs && e.thumbs.length
          ? h('div', { class: 'thumbs' }, e.thumbs.map((t, i) => {
              const src = 'data:image/jpeg;base64,' + t;
              return h('div', { class: 'thumb' }, h('img', { src, alt: `Página ${i + 1}`, onclick: () => showPhoto(src) }));
            }))
          : null),
      h('h2', {}, `Exercícios (${exs.length})`),
      exs.length
        ? h('div', { class: 'stack' }, exs.map((ex, i) => exCard(e, ex, i)))
        : h('div', { class: 'card empty' }, 'Não foram encontrados exercícios nas fotografias.'),
      h('p', { class: 'disclaimer' }, 'A IA pode enganar-se. Se achares que uma correção está errada, assinala-a.'),
      isParent
        ? h('div', { class: 'center' }, h('button', { class: 'btn danger small', onclick: async () => {
            if (!confirm('Apagar esta correção? Não dá para desfazer.')) return;
            try {
              await api('/api/entry?id=' + encodeURIComponent(e.id), { method: 'DELETE' });
              state.items = state.items.filter((x) => x.id !== e.id);
              delete state.entries[e.id];
              go('#historico');
            } catch (err) { alert(err.message); }
          } }, 'Apagar correção'))
        : null,
    ];
  }

  redraw(entry);
  return wrap;
}

/* ---------------- history ---------------- */

function itemRow(it) {
  const b = bucket(it.pct);
  return h('button', { class: 'item', onclick: () => go('#c/' + it.id) },
    h('div', { class: `pct ${b}` }, it.pct === null ? '–' : `${it.pct}%`),
    h('div', { class: 'grow' },
      h('div', { class: 'item-title' }, it.topic || SUBJECTS[it.subject]),
      h('div', { class: 'small muted' }, `${SUBJECTS[it.subject]} · ${fmtDay(it.ts)} · ${String(it.got).replace('.', ',')}/${it.total}`)),
    it.flags ? h('span', { title: 'Correção assinalada' }, '🚩') : null,
    state.role === 'parent' && !it.seenByParent ? h('span', { class: 'dot', title: 'Por ver' }) : null);
}

function historyView() {
  const wrap = h('section', {});
  const redraw = () => {
    const list = state.items.filter((it) => state.filter === 'all' || it.subject === state.filter);
    wrap.replaceChildren(
      h('h1', {}, 'Histórico'),
      h('p', { class: 'sub' }, `${state.items.length} correções no total`),
      h('div', { class: 'filters' },
        [['all', 'Todas'], ...Object.entries(SUBJECTS)].map(([k, v]) =>
          h('button', { class: 'chip', 'aria-pressed': String(state.filter === k), onclick: () => { state.filter = k; redraw(); } }, v))),
      list.length ? h('div', { class: 'list' }, list.map(itemRow)) : h('div', { class: 'card empty' }, 'Ainda não há correções aqui.'));
  };
  redraw();
  return wrap;
}

/* ---------------- parent dashboard ---------------- */

function avg(list) {
  const vals = list.filter((x) => x.pct !== null).map((x) => x.pct);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function trendChart(items) {
  const pts = items.filter((x) => x.pct !== null).slice(0, 20).reverse();
  if (pts.length < 2) return h('p', { class: 'muted small' }, 'O gráfico aparece depois de algumas correções.');
  const W = 600, H = 220, pad = 52, gap = 6;
  const bw = (W - pad - gap * (pts.length - 1)) / pts.length;
  const color = { hi: '#1f8a5b', mid: '#d39a2a', lo: '#c8382a' };
  const y = (p) => H - 30 - (p / 100) * (H - 44);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Notas das últimas correções' },
    s('line', { x1: pad, x2: W, y1: y(50), y2: y(50), stroke: '#d9d5cb', 'stroke-dasharray': '4 4' }),
    s('text', { x: 0, y: y(50) + 7, 'font-size': 20, fill: '#6b6f7a' }, '50%'),
    s('text', { x: 0, y: y(100) + 14, 'font-size': 20, fill: '#6b6f7a' }, '100'));
  pts.forEach((p, i) => {
    const x = pad + i * (bw + gap);
    const top = y(Math.max(p.pct, 3));
    const bar = s('rect', { x, y: top, width: bw, height: H - 30 - top, rx: 4, fill: color[bucket(p.pct)] });
    bar.append(s('title', {}, `${SUBJECTS[p.subject]} · ${fmtDay(p.ts)} · ${p.pct}%`));
    svg.append(bar);
  });
  svg.append(s('text', { x: pad, y: H - 2, 'font-size': 20, fill: '#6b6f7a' }, fmtDay(pts[0].ts)));
  svg.append(s('text', { x: W, y: H - 2, 'font-size': 20, fill: '#6b6f7a', 'text-anchor': 'end' }, fmtDay(pts[pts.length - 1].ts)));
  return h('div', { class: 'trend' }, svg);
}

function dashboardView() {
  const now = Date.now();
  const DAY = 86400000;
  const last30 = state.items.filter((x) => now - x.ts < 30 * DAY);
  const last7 = state.items.filter((x) => now - x.ts < 7 * DAY);
  const unseen = state.items.filter((x) => !x.seenByParent);
  const flagged = state.items.filter((x) => x.flags > 0);

  const skillCount = {};
  for (const it of last30) for (const k of it.weak || []) skillCount[k] = (skillCount[k] || 0) + 1;
  const practice = Object.entries(skillCount).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const subjectRows = [];
  for (const [k, v] of Object.entries(SUBJECTS)) {
    const list = last30.filter((x) => x.subject === k);
    if (!list.length) continue;
    const a = avg(list);
    const fill = h('div', { class: 'bar-fill' });
    fill.style.width = `${a || 0}%`;
    fill.style.background = { hi: '#1f8a5b', mid: '#d39a2a', lo: '#c8382a', na: '#9a978f' }[bucket(a)];
    subjectRows.push(h('div', { class: 'bar-row' },
      h('div', {}, v, h('div', { class: 'small muted' }, `${list.length} correç${list.length === 1 ? 'ão' : 'ões'}`)),
      h('div', { class: 'bar-track' }, fill),
      h('strong', {}, a === null ? '–' : `${a}%`)));
  }

  const stat = (n, l) => h('div', { class: 'card stat' }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, l));

  if (!state.items.length) {
    return h('section', {},
      h('h1', {}, 'Como está a correr'),
      h('div', { class: 'card empty' }, 'Ainda não há correções. Quando a sua filha enviar a primeira, o resumo aparece aqui.'));
  }

  return h('section', {},
    h('h1', {}, 'Como está a correr'),
    h('p', { class: 'sub' }, 'Resumo dos últimos 30 dias'),
    h('div', { class: 'stats' },
      stat(last7.length, 'correções (7 dias)'),
      stat(avg(last30) === null ? '–' : `${avg(last30)}%`, 'média (30 dias)'),
      stat(unseen.length, 'por ver'),
      stat(flagged.length, 'correções assinaladas')),

    flagged.length ? [h('h2', {}, '🚩 Ela acha que a IA se enganou'), h('div', { class: 'list' }, flagged.map(itemRow))] : null,

    h('h2', {}, 'Evolução'),
    h('div', { class: 'card' }, trendChart(state.items)),

    h('h2', {}, 'Por disciplina'),
    h('div', { class: 'card bars' }, subjectRows.length ? subjectRows : h('p', { class: 'muted small' }, 'Sem correções nos últimos 30 dias.')),

    h('h2', {}, '🎯 Temas a praticar'),
    h('div', { class: 'card practice' }, practice.length
      ? h('ol', {}, practice.map(([k, n]) => h('li', {}, k, ' ', h('span', { class: 'count' }, `· ${n} erro${n === 1 ? '' : 's'}`))))
      : h('p', { class: 'muted small' }, 'Sem erros repetidos nos últimos 30 dias. 🎉')),

    h('h2', {}, 'Últimas correções'),
    h('div', { class: 'list' }, state.items.slice(0, 6).map(itemRow)),
    state.items.length > 6 ? h('p', { class: 'center' }, h('button', { class: 'btn small', onclick: () => go('#historico') }, 'Ver todas')) : null);
}

/* ---------------- start ---------------- */

document.getElementById('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  state.role = null;
  state.items = [];
  state.entries = {};
  location.hash = '';
  render();
});

window.addEventListener('hashchange', render);

(async function start() {
  try {
    const me = await api('/api/me');
    state.role = me.role;
    state.name = me.studentName;
    if (state.role) await refreshHistory();
  } catch (e) {
    state.role = null;
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
