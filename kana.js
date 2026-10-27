/* Kana charts, kana practice, and the kanji sheet. Uses globals from app.js (state, KANA, speak, el, esc, tpl, render, normRomaji, shuffle, gradeRomaji, fmtRomaji, load, save, statBox). */

const LS_KANA = 'hanasu.kana.v1';
const kanaProg = load(LS_KANA, {});
const kanaPrefs = Object.assign({ script: 'hira', groups: ['basic'], mode: 'read', showRomaji: true, tapSpeed: 'normal', kanjiHelpOpen: true }, load('hanasu.kanaprefs.v1', {}));
// Tap-to-hear speed, shared by the charts, the kanji sheet, and the mora strip on reveals.
function tapSpeak(text, card) {
  if (kanaPrefs.tapSpeed === 'syllables' && card) return speakSyllables(card);
  speak(text, kanaPrefs.tapSpeed !== 'normal');
}
function tapSpeedControl(withSyllables) {
  const opts = [['normal', 'Normal'], ['slow', 'Slow'], ...(withSyllables ? [['syllables', 'Syllables']] : [])];
  const wrap = el(`<fieldset class="confidence tap-speed"><legend>Tap to hear at</legend>${opts.map(([v, l]) => `<label><input type="radio" name="tapspeed" value="${v}" ${kanaPrefs.tapSpeed === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`);
  wrap.querySelectorAll('input').forEach(i => i.onchange = () => { kanaPrefs.tapSpeed = i.value; saveKanaPrefs(); });
  if (!withSyllables && kanaPrefs.tapSpeed === 'syllables') { kanaPrefs.tapSpeed = 'slow'; saveKanaPrefs(); wrap.querySelector('input[value=slow]').checked = true; }
  return wrap;
}
const kanjiProg = load('hanasu.kanji.v1', {});
function saveKana() { save(LS_KANA, kanaProg); }
function saveKanji() { save('hanasu.kanji.v1', kanjiProg); }

/* ---------- accuracy helpers: stats, shading, delayed tooltip ---------- */
function accOf(p) { return p && p.seen ? p.correct / p.seen : null; }
function statsOf(progs) {
  const seenList = progs.filter(p => p && p.seen);
  const seen = seenList.reduce((a, p) => a + p.seen, 0), correct = seenList.reduce((a, p) => a + p.correct, 0);
  return { covered: seenList.length, total: progs.length, seen, correct, acc: seen ? correct / seen : null };
}
const pct = a => a === null ? '–' : Math.round(a * 100) + '%';
// Background shade from red (0%) to green (100%), legible in both themes. Unseen items keep the plain surface.
function shade(elm, p) {
  const a = accOf(p); if (a === null) return;
  elm.style.background = `hsla(${Math.round(a * 130)}, 60%, 45%, ${(0.16 + a * 0.18).toFixed(2)})`;
}
function tipText(p) {
  if (!p || !p.seen) return 'Not practiced yet';
  return `${p.correct} of ${p.seen} right · ${pct(accOf(p))} · last answer ${p.lastCorrect ? 'right' : 'wrong'}`;
}
let tipEl = null, tipTimer = null;
function showTip(anchor, text) {
  if (!tipEl) { tipEl = el('<div class="tooltip" role="tooltip"></div>'); document.body.append(tipEl); }
  tipEl.textContent = text; tipEl.hidden = false;
  const r = anchor.getBoundingClientRect(), w = tipEl.offsetWidth;
  tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  tipEl.style.top = (r.top + window.scrollY - tipEl.offsetHeight - 8) + 'px';
}
function hideTip() { clearTimeout(tipTimer); if (tipEl) tipEl.hidden = true; }
function attachTip(elm, getText, delay = 450) {
  const show = () => { clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(elm, getText()), delay); };
  elm.addEventListener('mouseenter', show); elm.addEventListener('focus', show);
  elm.addEventListener('mouseleave', hideTip); elm.addEventListener('blur', hideTip);
}
document.addEventListener('click', hideTip, true);
function saveKanaPrefs() { save('hanasu.kanaprefs.v1', kanaPrefs); }

// Row layout of the kana chart. Keys index the KANA table in app.js. null = empty cell.
const KANA_ROWS = {
  basic: [['a','i','u','e','o'],['ka','ki','ku','ke','ko'],['sa','shi','su','se','so'],['ta','chi','tsu','te','to'],['na','ni','nu','ne','no'],['ha','hi','fu','he','ho'],['ma','mi','mu','me','mo'],['ya',null,'yu',null,'yo'],['ra','ri','ru','re','ro'],['wa',null,null,null,'wo'],['n',null,null,null,null]],
  dakuten: [['ga','gi','gu','ge','go'],['za','ji','zu','ze','zo'],['da','di','du','de','do'],['ba','bi','bu','be','bo'],['pa','pi','pu','pe','po']],
  yoon: [['kya','kyu','kyo'],['sha','shu','sho'],['cha','chu','cho'],['nya','nyu','nyo'],['hya','hyu','hyo'],['mya','myu','myo'],['rya','ryu','ryo'],['gya','gyu','gyo'],['ja','ju','jo'],['bya','byu','byo'],['pya','pyu','pyo']],
};
const GROUP_NAMES = { basic: 'Basic (gojūon)', dakuten: 'Dakuten (゛゜)', yoon: 'Combinations (yōon)' };
const SPECIAL = { n: { hira: 'ん', romaji: 'n' }, wo: { romaji: 'wo (o)', accept: ['wo', 'o'] }, di: { romaji: 'ji (di)', accept: ['ji', 'di'] }, du: { romaji: 'zu (du)', accept: ['zu', 'du'] } };
const toKata = s => s.replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
function kanaCell(key, group, row, col) {
  const sp = SPECIAL[key] || {};
  const hira = sp.hira || KANA[key];
  return { key, group, row, col, hira, kata: toKata(hira), romaji: sp.romaji || key, accept: sp.accept || [key] };
}
const KANA_CELLS = Object.entries(KANA_ROWS).flatMap(([g, rows]) => rows.flatMap((r, ri) => r.map((k, ci) => k && kanaCell(k, g, ri, ci)).filter(Boolean)));
const glyph = c => kanaPrefs.script === 'kata' ? c.kata : c.hira;
const kid = c => `${kanaPrefs.script}:${c.key}`;
const kstate = c => { const p = kanaProg[kid(c)]; return !p || !p.seen ? '' : p.lastCorrect ? 'ok' : 'miss'; };

/* ---------- page ---------- */
function showKana(tab) {
  tab = tab || kanaPrefs.tab || 'hira';
  kanaPrefs.tab = tab; saveKanaPrefs();
  const n = tpl('t-kana');
  n.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => showKana(b.dataset.tab); });
  const body = n.querySelector('[data-kana-body]');
  if (tab === 'kanji') renderKanjiSheet(body); else { kanaPrefs.script = tab; saveKanaPrefs(); renderKanaChart(body); }
  render(n, 'kana');
}

function renderKanaChart(body) {
  body.replaceChildren();
  const controls = el(`<div class="kana-controls">
    <label class="field check"><input type="checkbox" ${kanaPrefs.showRomaji ? 'checked' : ''} data-show-romaji><span>Show romaji</span></label>
    <span class="muted small">Tap any kana to hear it. Green: right last time. Red: missed last time.</span></div>`);
  controls.append(tapSpeedControl(false));
  controls.querySelector('[data-show-romaji]').onchange = e => { kanaPrefs.showRomaji = e.target.checked; saveKanaPrefs(); body.classList.toggle('hide-romaji', !kanaPrefs.showRomaji); };
  body.classList.toggle('hide-romaji', !kanaPrefs.showRomaji);
  body.append(controls);
  const all = statsOf(KANA_CELLS.map(c => kanaProg[kid(c)]));
  const stats = el('<div class="stats"></div>');
  stats.innerHTML = statBox(`${all.covered}/${all.total}`, 'kana practiced') + statBox(pct(all.acc), 'accuracy')
    + Object.keys(KANA_ROWS).map(g => statBox(pct(statsOf(KANA_CELLS.filter(c => c.group === g).map(c => kanaProg[kid(c)])).acc), GROUP_NAMES[g].split(' ')[0].toLowerCase() + ' accuracy')).join('');
  body.append(stats);
  for (const [g, rows] of Object.entries(KANA_ROWS)) {
    const sec = el(`<section class="kana-group"><h2>${GROUP_NAMES[g]}</h2><div class="kana-grid cols-${rows[0].length}"></div></section>`);
    const grid = sec.querySelector('.kana-grid');
    rows.forEach(r => r.forEach(k => {
      if (!k) { grid.append(el('<span class="kana-cell empty"></span>')); return; }
      const c = KANA_CELLS.find(x => x.key === k);
      const b = el(`<button type="button" class="kana-cell ${kstate(c)}" aria-label="${esc(glyph(c))} ${esc(c.romaji)}"><span class="g">${esc(glyph(c))}</span><span class="r">${esc(c.romaji)}</span></button>`);
      b.onclick = () => tapSpeak(glyph(c));
      shade(b, kanaProg[kid(c)]); attachTip(b, () => `${glyph(c)} ${c.romaji}: ${tipText(kanaProg[kid(c)])}`);
      grid.append(b);
    }));
    body.append(sec);
  }
  // practice launcher
  const form = el(`<form class="kana-practice"><h2>Practice</h2>
    <fieldset class="confidence"><legend>Groups</legend>${Object.keys(KANA_ROWS).map(g => `<label><input type="checkbox" name="g" value="${g}" ${kanaPrefs.groups.includes(g) ? 'checked' : ''}><span>${GROUP_NAMES[g]}</span></label>`).join('')}</fieldset>
    <fieldset class="confidence"><legend>Mode</legend>
      <label><input type="radio" name="m" value="read" ${kanaPrefs.mode === 'read' ? 'checked' : ''}><span>Read: see the kana, type the romaji</span></label>
      <label><input type="radio" name="m" value="hear" ${kanaPrefs.mode === 'hear' ? 'checked' : ''}><span>Hear: listen, pick the kana from look-alikes</span></label></fieldset>
    <button class="primary" type="submit">Start</button></form>`);
  form.onsubmit = ev => {
    ev.preventDefault();
    kanaPrefs.groups = [...form.querySelectorAll('input[name=g]:checked')].map(i => i.value);
    kanaPrefs.mode = form.m.value; saveKanaPrefs();
    const cells = KANA_CELLS.filter(c => kanaPrefs.groups.includes(c.group));
    if (!cells.length) return;
    const missed = cells.filter(c => kstate(c) === 'miss'), rest = cells.filter(c => kstate(c) !== 'miss');
    state.kana = { queue: [...shuffle(missed), ...shuffle(rest)], total: cells.length, done: 0, results: [], missed: [] };
    kanaNext();
  };
  body.append(form);
}

/* ---------- kana practice ---------- */
function kanaNext() {
  const s = state.kana;
  if (!s.queue.length) return kanaSummary();
  const c = s.queue.shift(); s.current = c;
  const n = tpl('t-kana-play'), q = sel => n.querySelector(sel);
  q('[data-bar]').style.width = Math.round(100 * s.done / s.total) + '%';
  q('[data-counter]').textContent = `${s.done + 1} of ${s.total}`;
  q('[data-mode-label]').textContent = (kanaPrefs.script === 'kata' ? 'Katakana · ' : 'Hiragana · ') + (kanaPrefs.mode === 'read' ? 'Read' : 'Hear');
  const result = q('[data-result]');
  const finish = (correct, typedLabel) => {
    const p = kanaProg[kid(c)] || (kanaProg[kid(c)] = { seen: 0, correct: 0 });
    p.seen++; if (correct) p.correct++; p.lastCorrect = correct; saveKana();
    s.done++; s.results.push(correct);
    if (!correct) { s.missed.push({ c, typed: typedLabel }); s.queue.splice(Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3)), 0, c); s.total++; }
    q('[data-answer]').hidden = true; result.hidden = false;
    const v = q('[data-verdict]'); v.className = 'verdict ' + (correct ? 'ok' : 'bad');
    v.innerHTML = correct ? 'Correct' : `Wrong.<small>You answered “${esc(typedLabel)}”.</small>`;
    q('[data-ja]').textContent = glyph(c); q('[data-romaji]').textContent = c.romaji;
    q('[data-audio-result]').replaceChildren(audioButtons(glyph(c)));
    speak(glyph(c));
    const next = q('[data-next]'); next.onclick = kanaNext; next.focus();
    if (correct) setTimeout(() => { if (state.kana === s && s.current === c && document.contains(result)) kanaNext(); }, 700);
  };
  if (kanaPrefs.mode === 'read') {
    q('[data-prompt]').innerHTML = `<span class="kana-big">${esc(glyph(c))}</span>`;
    const form = q('[data-read-form]'); form.hidden = false;
    const input = form.querySelector('input');
    setTimeout(() => input.focus(), 50);
    form.onsubmit = ev => { ev.preventDefault(); const t = normRomaji(input.value); if (!t) return; finish(c.accept.some(a => normRomaji(a) === t), input.value); };
  } else {
    q('[data-prompt]').innerHTML = `<span class="hint">Listen, then pick what you heard.</span>`;
    const row = q('[data-audio-row]'); row.hidden = false; row.replaceChildren(audioButtons(glyph(c)));
    setTimeout(() => speak(glyph(c)), 300);
    const pool = KANA_CELLS.filter(x => x !== c && x.group === c.group);
    const near = shuffle(pool.filter(x => x.row === c.row || x.col === c.col)), far = shuffle(pool.filter(x => x.row !== c.row && x.col !== c.col));
    const opts = shuffle([c, ...[...near, ...far].slice(0, 5)]);
    const choices = q('[data-choices]'); choices.hidden = false;
    choices.replaceChildren(...opts.map(o => { const b = el(`<button type="button" class="kana-choice">${esc(glyph(o))}</button>`); b.onclick = () => finish(o === c, glyph(o)); return b; }));
  }
  render(n, 'kana');
}
function kanaSummary() {
  const s = state.kana, n = tpl('t-summary');
  const right = s.results.filter(Boolean).length;
  n.querySelector('[data-summary]').innerHTML = statBox(s.results.length, 'answers') + statBox(right, 'correct') + statBox(s.results.length - right, 'wrong');
  const m = n.querySelector('[data-missed]'), seen = new Set();
  s.missed.forEach(({ c, typed }) => { if (seen.has(c.key)) return; seen.add(c.key); m.append(el(`<div class="item"><div class="ja">${esc(glyph(c))} <span class="r">${esc(c.romaji)}</span></div><div class="tag">you answered “${esc(typed)}”</div></div>`)); });
  if (s.missed.length) m.prepend(el('<h2>Missed</h2>'));
  const back = n.querySelector('[data-nav]'); back.dataset.nav = 'kana';
  state.kana = null;
  render(n, 'kana');
}

/* ---------- kanji sheet and practice ---------- */
function kanjiWords() {
  const words = new Map(); // kanji -> cards
  for (const c of state.cards.values()) for (const k of new Set(c.ja.match(/[一-鿿]/g) || [])) (words.get(k) || words.set(k, []).get(k)).push(c);
  return words;
}
function renderKanjiSheet(body) {
  body.replaceChildren();
  const words = kanjiWords();
  const list = [...words.keys()].filter(k => KANJI[k]).sort((a, b) => words.get(b).length - words.get(a).length);
  const top = el(`<div class="kana-controls">
    <details class="explainer" ${kanaPrefs.kanjiHelpOpen ? 'open' : ''} data-kanji-help>
      <summary>What are on and kun readings?</summary>
      <div class="explainer-body">
        <p>Kana are sound symbols: か is always ka. Kanji are meaning symbols borrowed from Chinese, and most have two or more readings depending on the word they sit in. So each entry below lists a meaning plus its readings.</p>
        <p><b>on</b> (on'yomi, sound reading) is the pronunciation that came from Chinese with the character. Used mostly when kanji are stacked into compound words.</p>
        <p><b>kun</b> (kun'yomi, meaning reading) is the native Japanese word the character was assigned to. Used mostly when the kanji stands alone or has hiragana attached.</p>
        <table class="explainer-table"><tr><th>水 water</th><th>reading</th><th>used in</th></tr>
          <tr><td>kun</td><td>mizu</td><td>水 mizu, お水 omizu (alone)</td></tr>
          <tr><td>on</td><td>sui</td><td>水曜日 suiyōbi, Wednesday (compound)</td></tr></table>
        <p>The parentheses in a kun reading show the part written in hiragana after the kanji: 食 ta(beru) gives 食べる taberu.</p>
        <p>For speaking you can mostly ignore this; you learn whole words like eki and densha. It matters when you read signs and menus. Rule of thumb: two kanji together, try the on readings. Kanji with a hiragana tail, try the kun reading.</p>
      </div>
    </details>
    <label class="field"><span>Filter by kanji, reading, or meaning</span><input type="search" data-filter placeholder="e.g. eki, station, 駅"></label>
    <p class="muted small">${list.length} kanji appear in the decks. Readings: on (Chinese-derived, used in compounds) then kun (native, used alone). Tap a word to hear it.</p>
    <button class="primary" type="button" data-kanji-practice>Practice all ${[...state.cards.values()].filter(c => /[\u4e00-\u9fff]/.test(c.ja)).length} kanji words: see the word, type the romaji</button></div>`);
  top.querySelector('[data-kanji-help]').addEventListener('toggle', e => { kanaPrefs.kanjiHelpOpen = e.target.open; saveKanaPrefs(); });
  top.append(tapSpeedControl(true));
  body.append(top);
  const kwords = [...state.cards.values()].filter(c => /[\u4e00-\u9fff]/.test(c.ja));
  const ks = statsOf(kwords.map(c => kanjiProg[c.id]));
  const stats = el('<div class="stats"></div>');
  stats.innerHTML = statBox(`${ks.covered}/${ks.total}`, 'words practiced') + statBox(pct(ks.acc), 'accuracy') + statBox(kwords.filter(c => kanjiProg[c.id] && kanjiProg[c.id].lastCorrect === false).length, 'missed last time');
  body.append(stats);
  const wrap = el('<div class="kanji-list"></div>'); body.append(wrap);
  const draw = (filter = '') => {
    const f = filter.trim().toLowerCase();
    wrap.replaceChildren(...list.filter(k => { const [m, on, kun] = KANJI[k]; return !f || k.includes(f) || m.includes(f) || on.includes(f) || kun.includes(f) || words.get(k).some(c => c.romaji.includes(f)); }).map(k => {
      const [meaning, on, kun] = KANJI[k];
      const card = el(`<div class="kanji-card"><div class="kanji-head"><button type="button" class="kanji-glyph" aria-label="${esc(k)}">${esc(k)}</button>
        <div><div class="kanji-meaning">${esc(meaning)}</div><div class="muted small">${on ? 'on: ' + esc(on) : ''}${on && kun ? ' · ' : ''}${kun ? 'kun: ' + esc(kun) : ''}</div></div></div>
        <div class="kanji-words">${words.get(k).map(c => `<button type="button" class="kanji-word" data-id="${esc(c.id)}"><span class="ja">${esc(c.ja)}</span><span class="r">${esc(fmtRomaji(c.romaji))}</span><span class="e">${esc(c.en)}</span></button>`).join('')}</div></div>`);
      card.querySelector('.kanji-glyph').onclick = () => tapSpeak(k);
      card.querySelectorAll('.kanji-word').forEach(b => { const w = state.cards.get(b.dataset.id); b.onclick = () => tapSpeak(w.ja, w); shade(b, kanjiProg[w.id]); attachTip(b, () => `${w.ja}: ${tipText(kanjiProg[w.id])}`); });
      return card;
    }));
  };
  draw();
  top.querySelector('[data-filter]').oninput = e => draw(e.target.value);
  top.querySelector('[data-kanji-practice]').onclick = () => {
    const pool = [...state.cards.values()].filter(c => /[\u4e00-\u9fff]/.test(c.ja));
    const kp = kanjiProg;
    const missed = pool.filter(c => kp[c.id] && kp[c.id].lastCorrect === false), rest = pool.filter(c => !(kp[c.id] && kp[c.id].lastCorrect === false));
    state.kanji = { queue: [...shuffle(missed), ...shuffle(rest)], total: pool.length, done: 0, results: [], missed: [], prog: kp };
    kanjiNext();
  };
}
function kanjiNext() {
  const s = state.kanji;
  if (!s.queue.length) return kanjiSummary();
  const c = s.queue.shift(); s.current = c;
  const n = tpl('t-kana-play'), q = sel => n.querySelector(sel);
  q('[data-bar]').style.width = Math.round(100 * s.done / s.total) + '%';
  q('[data-counter]').textContent = `${s.done + 1} of ${s.total}`;
  q('[data-mode-label]').textContent = 'Kanji · Read';
  q('[data-prompt]').innerHTML = `<span class="kana-big kanji-prompt">${esc(c.ja)}</span>`;
  const form = q('[data-read-form]'); form.hidden = false; const input = form.querySelector('input'); setTimeout(() => input.focus(), 50);
  form.onsubmit = ev => {
    ev.preventDefault(); if (!input.value.trim()) return;
    const g = gradeRomaji(input.value, c), correct = g === 'ok';
    const p = s.prog[c.id] || (s.prog[c.id] = { seen: 0, correct: 0 }); p.seen++; if (correct) p.correct++; p.lastCorrect = correct; saveKanji();
    s.done++; s.results.push(correct);
    if (!correct) { s.missed.push({ c, typed: input.value }); s.queue.splice(Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3)), 0, c); s.total++; }
    form.hidden = true; const r = q('[data-result]'); r.hidden = false;
    const v = q('[data-verdict]'); v.className = 'verdict ' + (correct ? 'ok' : g === 'almost' ? 'almost' : 'bad');
    v.innerHTML = correct ? 'Correct' : `${g === 'almost' ? 'Almost, but no.' : 'Wrong.'}<small>You typed “${esc(input.value)}”.</small>`;
    q('[data-ja]').textContent = c.ja; q('[data-romaji]').textContent = fmtRomaji(c.romaji);
    const parts = [...new Set(c.ja.match(/[一-鿿]/g) || [])].filter(k => KANJI[k]);
    q('[data-extra]').innerHTML = `<div class="en">${esc(c.en)}</div><div class="kanji-parts">${parts.map(k => `<span><b>${esc(k)}</b> ${esc(KANJI[k][0])}</span>`).join('')}</div>`;
    q('[data-audio-result]').replaceChildren(audioButtons(c.ja, c));
    speak(c.ja);
    const next = q('[data-next]'); next.onclick = kanjiNext; next.focus();
  };
  render(n, 'kana');
}
function kanjiSummary() {
  const s = state.kanji, n = tpl('t-summary');
  const right = s.results.filter(Boolean).length;
  n.querySelector('[data-summary]').innerHTML = statBox(s.results.length, 'answers') + statBox(right, 'correct') + statBox(s.results.length - right, 'wrong');
  const m = n.querySelector('[data-missed]'), seen = new Set();
  s.missed.forEach(({ c, typed }) => { if (seen.has(c.id)) return; seen.add(c.id); m.append(el(`<div class="item"><div class="ja">${esc(c.ja)} <span class="r">${esc(fmtRomaji(c.romaji))}</span></div><div>${esc(c.en)}</div><div class="tag">you typed “${esc(typed)}”</div></div>`)); });
  if (s.missed.length) m.prepend(el('<h2>Missed</h2>'));
  n.querySelector('[data-nav]').dataset.nav = 'kana';
  state.kanji = null;
  render(n, 'kana');
}
