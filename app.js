/* Hanasu Cards: speaking-first Japanese flash cards.
   Design rules baked in:
   - Production only (typed romaji), never multiple choice.
   - Confidence must be committed before the reveal.
   - Cards are interleaved across decks.
   - A random example sentence is shown on reveal so you learn the word, not the sentence.
   - SM-2 style spacing; "sure" + wrong is tracked as an overconfident miss and punished. */

const LS_PROGRESS = 'hanasu.progress.v1';
const LS_SETTINGS = 'hanasu.settings.v1';
const LS_SELECTED = 'hanasu.selected.v1';

const state = {
  decks: [],            // [{id,name,description,cards:[...]}]
  cards: new Map(),     // id -> card (with deckId)
  progress: load(LS_PROGRESS, {}),
  settings: Object.assign({ rate: 0.9, autoplay: true, level: 1, macron: false }, load(LS_SETTINGS, {})),
  selected: new Set(load(LS_SELECTED, [])),
  session: null,
  group: null,
};

function load(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function saveProgress() { save(LS_PROGRESS, state.progress); }
function saveSettings() { save(LS_SETTINGS, state.settings); }
function saveSelected() { save(LS_SELECTED, [...state.selected]); }

/* ---------- romaji normalisation ---------- */
// Both the expected answer and the typed answer go through this, so spelling
// systems (Hepburn vs Kunrei, macrons vs doubled vowels, nn vs n') all compare equal.
function normRomaji(s, lenient = false) {
  // macrons and circumflexes first, before NFD would strip them to plain vowels
  s = (s || '').toLowerCase().replace(/[āâ]/g, 'aa').replace(/[īî]/g, 'ii').replace(/[ūû]/g, 'uu').replace(/[ēê]/g, 'ee').replace(/[ōô]/g, 'oo');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  // Kunrei / wapuro variants -> Hepburn
  s = s.replace(/sh[yi]/g, 'sh').replace(/si/g, 'shi').replace(/ti/g, 'chi').replace(/tu/g, 'tsu').replace(/hu/g, 'fu')
       .replace(/zi/g, 'ji').replace(/di/g, 'ji').replace(/du/g, 'zu').replace(/sy/g, 'sh').replace(/ty/g, 'ch').replace(/zy/g, 'j').replace(/jy/g, 'j')
       .replace(/cch/g, 'tch').replace(/wo/g, 'o');
  // long-vowel spellings unify (ou = oo = ō, ei = ee) but length itself is kept: it is phonemic.
  s = s.replace(/ou/g, 'oo').replace(/ei/g, 'ee').replace(/m([bp])/g, 'n$1').replace(/nn(?=[^aiueoy]|$)/g, 'n'); // wapuro final nn = ん
  // lenient form ignores vowel length only; consonants, including n, stay strict
  if (lenient) s = s.replace(/oo/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee/g, 'e');
  return s;
}
// Display romaji in macron style: ou/oo -> ō, uu -> ū, aa -> ā, ee -> ē. ii stays ii, as in Hepburn.
function toMacron(r) { return (r || '').replace(/ou|oo/g, 'ō').replace(/uu/g, 'ū').replace(/aa/g, 'ā').replace(/ee/g, 'ē').replace(/Ou|Oo/g, 'Ō'); }
function fmtRomaji(r) { return state.settings.macron ? toMacron(r) : r; }
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) { cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev]; }
  return prev[n];
}
function gradeRomaji(typed, card) {
  const t = normRomaji(typed);
  const targets = [card.romaji, ...(card.accept || [])].map(normRomaji);
  if (!t) return 'bad';
  if (targets.includes(t)) return 'ok';
  if (vowelAssumed(typed, card)) return 'ok';
  const best = Math.min(...targets.map(x => lev(x, t)));
  return best <= 1 && t.length >= 4 ? 'almost' : 'bad';
}
// True when the answer matches except for vowel length: the macron is assumed to be intended.
function vowelAssumed(typed, card) {
  const t = normRomaji(typed), tl = normRomaji(typed, true);
  const alts = [card.romaji, ...(card.accept || [])];
  return !alts.some(x => normRomaji(x) === t) && alts.some(x => normRomaji(x, true) === tl);
}

/* ---------- meaning grading (English, generous) ---------- */
const STOP = new Set(['the','a','an','is','it','i','im','to','of','for','in','on','at','me','my','you','your','do','does','please','and','or','s','that','this','its']);
function enTokens(str) {
  return (str || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9' ]/g, ' ').replace(/'/g, '')
    .split(/\s+/).filter(w => w && !STOP.has(w))
    .map(w => /^(dont|doesnt|didnt|cant|cannot|no|not|isnt|arent)$/.test(w) ? 'not' : w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);
}
// Correct if the typed meaning matches any "/"-separated alternative of card.en (or card.accept_en)
// by token overlap: every typed content word appears in the alternative, or at least half of the alternative's words were typed.
function gradeMeaning(typed, card) {
  const t = enTokens(typed); if (!t.length) return null;
  const alts = [...String(card.en).split('/'), ...(card.accept_en || [])].map(enTokens).filter(a => a.length);
  return alts.some(a => { const hit = t.filter(w => a.includes(w)).length; return hit === t.length || hit / a.length >= 0.5; }) ? 'ok' : 'bad';
}

/* ---------- speech ---------- */
let jaVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter(v => /^ja/i.test(v.lang));
  // Google's voice honours the rate setting; Apple's Kyoko barely does.
  jaVoice = voices.find(v => /Google 日本語/.test(v.name)) || voices.find(v => /Kyoko|O-ren|Otoya/.test(v.name)) || voices[0] || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
let speakToken = 0;
function utter(text, rate) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice; u.rate = rate;
  return u;
}
function speak(text, slow = false) {
  if (!('speechSynthesis' in window)) return;
  speakToken++; speechSynthesis.cancel();
  speechSynthesis.speak(utter(text, slow ? Math.max(0.5, state.settings.rate * 0.6) : state.settings.rate));
}
// Mora by mora, with a gap between each and a longer gap between words, then the whole phrase slowly.
function speakSyllables(card) {
  if (!('speechSynthesis' in window)) return;
  const token = ++speakToken; speechSynthesis.cancel();
  const words = (card.kana || romajiToKana(card.romaji)).split(' ').filter(Boolean);
  const steps = [];
  words.forEach((w, wi) => { splitMorae(w).forEach(m => steps.push({ text: m, gap: 160 })); if (wi < words.length - 1) steps[steps.length - 1].gap = 450; });
  steps[steps.length - 1].gap = 700;
  steps.push({ text: card.ja, gap: 0, rate: Math.max(0.5, state.settings.rate * 0.7) });
  let i = 0;
  const next = () => {
    if (token !== speakToken || i >= steps.length) return;
    const st = steps[i++], u = utter(st.text, st.rate || 0.85);
    u.onend = () => setTimeout(next, st.gap); u.onerror = () => setTimeout(next, st.gap);
    speechSynthesis.speak(u);
  };
  next();
}

// A Play / Slow / Syllables row for any Japanese text. Pass a card (romaji or kana) to enable Syllables.
function audioButtons(ja, card) {
  const row = el('<div class="audio-row"></div>');
  const add = (label, fn) => { const b = el(`<button type="button">${label}</button>`); b.onclick = fn; row.append(b); };
  add('▶ Play', () => speak(ja)); add('▶ Slow', () => speak(ja, true));
  if (card) add('▶ Syllables', () => speakSyllables(card));
  return row;
}

/* ---------- romaji -> kana (for syllable playback) ---------- */
const KANA = {
  a:'あ',i:'い',u:'う',e:'え',o:'お',
  ka:'か',ki:'き',ku:'く',ke:'け',ko:'こ',ga:'が',gi:'ぎ',gu:'ぐ',ge:'げ',go:'ご',
  sa:'さ',shi:'し',si:'し',su:'す',se:'せ',so:'そ',za:'ざ',ji:'じ',zi:'じ',zu:'ず',ze:'ぜ',zo:'ぞ',
  ta:'た',chi:'ち',ti:'ち',tsu:'つ',tu:'つ',te:'て',to:'と',da:'だ',di:'ぢ',du:'づ',de:'で',do:'ど',
  na:'な',ni:'に',nu:'ぬ',ne:'ね',no:'の',
  ha:'は',hi:'ひ',fu:'ふ',hu:'ふ',he:'へ',ho:'ほ',ba:'ば',bi:'び',bu:'ぶ',be:'べ',bo:'ぼ',pa:'ぱ',pi:'ぴ',pu:'ぷ',pe:'ぺ',po:'ぽ',
  ma:'ま',mi:'み',mu:'む',me:'め',mo:'も',ya:'や',yu:'ゆ',yo:'よ',ra:'ら',ri:'り',ru:'る',re:'れ',ro:'ろ',wa:'わ',wo:'を',
  kya:'きゃ',kyu:'きゅ',kyo:'きょ',gya:'ぎゃ',gyu:'ぎゅ',gyo:'ぎょ',sha:'しゃ',shu:'しゅ',sho:'しょ',sya:'しゃ',syu:'しゅ',syo:'しょ',
  ja:'じゃ',ju:'じゅ',jo:'じょ',jya:'じゃ',jyu:'じゅ',jyo:'じょ',zya:'じゃ',zyu:'じゅ',zyo:'じょ',cha:'ちゃ',chu:'ちゅ',cho:'ちょ',tya:'ちゃ',tyu:'ちゅ',tyo:'ちょ',
  nya:'にゃ',nyu:'にゅ',nyo:'にょ',hya:'ひゃ',hyu:'ひゅ',hyo:'ひょ',bya:'びゃ',byu:'びゅ',byo:'びょ',pya:'ぴゃ',pyu:'ぴゅ',pyo:'ぴょ',
  mya:'みゃ',myu:'みゅ',myo:'みょ',rya:'りゃ',ryu:'りゅ',ryo:'りょ',
  fa:'ふぁ',fi:'ふぃ',fe:'ふぇ',fo:'ふぉ',ti_:'てぃ',di_:'でぃ',du_:'どぅ',we:'うぇ',wi:'うぃ',va:'ゔぁ',vi:'ゔぃ',vu:'ゔ',ve:'ゔぇ',vo:'ゔぉ',she:'しぇ',je:'じぇ',che:'ちぇ',tsa:'つぁ',tse:'つぇ',tso:'つぉ',
};
// Tokenise romaji into [{r, k}] pairs, one kana unit each. Spaces become {r:' ', k:' '}.
function romajiTokens(r) {
  let s = (r || '').toLowerCase().replace(/ā/g, 'aa').replace(/ī/g, 'ii').replace(/ū/g, 'uu').replace(/ē/g, 'ee').replace(/ō/g, 'ou').replace(/[^a-z' ]/g, '');
  const out = [];
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === ' ') { out.push({ r: ' ', k: ' ' }); i++; continue; }
    if (c === "'") { i++; continue; }
    if (c === 'n' && !/[aiueoy]/.test(s[i + 1] || '')) { out.push({ r: 'n', k: 'ん' }); i++; continue; }
    if (/[kstpcgzjdbfrhm]/.test(c) && (s[i + 1] === c || (c === 't' && s.slice(i, i + 3) === 'tch'))) { out.push({ r: c, k: 'っ' }); i++; continue; }
    let hit = null;
    for (const len of [3, 2, 1]) { const k = s.slice(i, i + len); if (KANA[k]) { hit = [KANA[k], len]; break; } }
    if (hit) { out.push({ r: s.slice(i, i + hit[1]), k: hit[0] }); i += hit[1]; } else { out.push({ r: c, k: c }); i++; }
  }
  return out;
}
function romajiToKana(r) { return romajiTokens(r).map(t => t.k).join(''); }
// Group tokens into morae for display: っ joins the next unit; with macrons on, a lengthening vowel joins the previous unit.
function moraePairs(r, macron) {
  const toks = romajiTokens(r), out = [];
  for (const t of toks) {
    const prev = out[out.length - 1];
    if (prev && prev.k.endsWith('っ') && t.k !== ' ') { prev.r += t.r; prev.k += t.k; continue; }
    if (macron && prev && /^[aeiou]$/.test(t.r) && prev.k !== ' ' && (prev.r.endsWith('o') && /[ou]/.test(t.r) || prev.r.endsWith(t.r) && t.r !== 'i')) { prev.r = toMacron(prev.r + t.r); prev.k += t.k; continue; }
    out.push({ r: t.r, k: t.k });
  }
  return out;
}
// One mora per element. Small y-kana attach to the previous; っ attaches to the following mora; ー attaches to the previous.
function splitMorae(kana) {
  const out = [];
  for (const ch of kana) {
    if (/[ゃゅょぁぃぅぇぉャュョァィゥェォー]/.test(ch) && out.length) out[out.length - 1] += ch;
    else if (out.length && /[っッ]$/.test(out[out.length - 1])) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/* ---------- progress (lightweight; no scheduling) ---------- */
function prog(id) {
  return state.progress[id] || (state.progress[id] = { seen: 0, correct: 0, lapses: 0, overconf: 0, lastCorrect: null, last: null });
}
function missedLast(id) { const p = state.progress[id]; return !!p && p.seen > 0 && p.lastCorrect === false; }
function record(id, correct, conf) {
  const p = prog(id); p.seen++; p.last = Date.now(); p.lastCorrect = correct;
  if (correct) p.correct++; else { p.lapses++; if (conf === 'sure') p.overconf++; }
  saveProgress();
}

/* ---------- decks ---------- */
async function loadDecks() {
  const index = await (await fetch('decks/index.json')).json();
  const decks = await Promise.all(index.map(async f => {
    const d = await (await fetch('decks/' + f)).json();
    d.file = f; d.cards.forEach(c => { c.deckId = d.id; state.cards.set(c.id, c); }); return d;
  }));
  state.decks = decks;
  if (!state.selected.size) { decks.slice(0, 2).forEach(d => state.selected.add(d.id)); saveSelected(); }
}
const LEVELS = [[1, 'Basics', 'single words, 1–2 word phrases'], [2, 'Phrases', 'short phrases'], [3, 'Sentences', 'full sentences'], [0, 'All', 'everything']];
function cardLevel(c) { return c.level || (c.romaji.split(' ').length <= 2 ? 1 : c.romaji.split(' ').length <= 4 ? 2 : 3); }
function inLevel(c) { const L = state.settings.level; return !L || cardLevel(c) <= L; }
function selectedCards() { return state.decks.filter(d => state.selected.has(d.id)).flatMap(d => d.cards).filter(inLevel); }
function levelPicker(container, onChange) {
  container.replaceChildren(...LEVELS.map(([v, name, desc]) => {
    const b = el(`<button type="button" class="${state.settings.level === v ? 'on' : ''}" aria-pressed="${state.settings.level === v}">${name}<span>${desc}</span></button>`);
    b.onclick = () => { state.settings.level = v; saveSettings(); levelPicker(container, onChange); onChange && onChange(); };
    return b;
  }));
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Round-robin across decks so consecutive cards come from different topics.
function interleave(cards) {
  const byDeck = new Map();
  shuffle(cards).forEach(c => { (byDeck.get(c.deckId) || byDeck.set(c.deckId, []).get(c.deckId)).push(c); });
  const lists = [...byDeck.values()], out = [];
  while (lists.some(l => l.length)) for (const l of lists) if (l.length) out.push(l.shift());
  return out;
}
// Every selected card, every session. Cards you missed last time come first; the rest are shuffled and interleaved across decks.
function buildQueue() {
  const pool = selectedCards();
  return [...interleave(pool.filter(c => missedLast(c.id))), ...interleave(pool.filter(c => !missedLast(c.id)))];
}

// Placeholder examples for the inputs, never the card being asked.
const PLACEHOLDERS = [['sumimasen', 'excuse me'], ['arigatou gozaimasu', 'thank you'], ['mizu', 'water'], ['eki', 'station'], ['oishii', 'delicious'], ['ikura desu ka', 'how much'], ['wakarimasen', 'I don\'t understand'], ['konnichiwa', 'hello'], ['migi', 'right'], ['kudasai', 'please give me']];
function placeholderFor(card) {
  const pool = PLACEHOLDERS.filter(([r, e]) => normRomaji(r, true) !== normRomaji(card.romaji, true) && enTokens(e).join(' ') !== enTokens(card.en.split('/')[0]).join(' '));
  return pool[Math.floor(Math.random() * pool.length)];
}

// Reveal strip: kana over romaji, one underlined segment per mora. Click a segment to hear it.
function renderMorae(container, card) {
  const kataOnly = /^[\u30a0-\u30ff\s]+$/.test(card.ja);
  const pairs = moraePairs(card.kana || card.romaji, state.settings.macron);
  container.replaceChildren(...pairs.map((m, i) => {
    if (m.k === ' ') return el('<span class="gap"></span>');
    const k = kataOnly ? m.k.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60)) : m.k;
    const b = el(`<button type="button" class="mora ${i % 2 ? 'b' : 'a'}" aria-label="${esc(k)} ${esc(m.r)}"><span class="k">${esc(k)}</span><span class="r">${esc(m.r)}</span></button>`);
    b.onclick = () => tapSpeak(k);
    return b;
  }));
}

/* ---------- view plumbing ---------- */
const view = document.getElementById('view');
function tpl(id) { return document.getElementById(id).content.firstElementChild.cloneNode(true); }
function render(node, nav) {
  speechSynthesis && speechSynthesis.cancel && speechSynthesis.cancel();
  view.replaceChildren(node);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.nav === nav));
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-nav]'); if (!b) return;
  ({ home: showHome, group: showGroup, browse: showBrowse, settings: showSettings, kana: () => showKana() })[b.dataset.nav]();
});
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function deckGrid(container, onChange) {
  container.replaceChildren(...state.decks.map(d => {
    const cards = d.cards.filter(inLevel);
    const missed = cards.filter(c => missedLast(c.id)).length;
    const b = el(`<button type="button" class="deck ${state.selected.has(d.id) ? 'on' : ''}" aria-pressed="${state.selected.has(d.id)}">
      <strong>${esc(d.name)}</strong><span>${cards.length} cards${missed ? ' · ' + missed + ' missed' : ''}</span></button>`);
    b.onclick = () => { state.selected.has(d.id) ? state.selected.delete(d.id) : state.selected.add(d.id); saveSelected(); b.classList.toggle('on'); b.setAttribute('aria-pressed', state.selected.has(d.id)); onChange && onChange(); };
    return b;
  }));
}
function statBox(b, label) { return `<div class="stat"><b>${b}</b><span>${label}</span></div>`; }

/* ---------- home ---------- */
function showHome() {
  const n = tpl('t-home');
  const stats = n.querySelector('[data-stats]');
  const refresh = () => {
    const pool = selectedCards(), seen = pool.filter(c => state.progress[c.id]?.seen);
    const missed = pool.filter(c => missedLast(c.id)).length;
    const over = pool.reduce((s, c) => s + (state.progress[c.id]?.overconf || 0), 0);
    const tries = seen.reduce((s, c) => s + state.progress[c.id].seen, 0), right = seen.reduce((s, c) => s + state.progress[c.id].correct, 0);
    stats.innerHTML = statBox(pool.length, 'cards in a session') + statBox(missed, 'missed last time')
      + statBox(tries ? Math.round(100 * right / tries) + '%' : '–', 'accuracy') + statBox(over, 'overconfident misses');
  };
  const grid = n.querySelector('[data-deck-grid]');
  deckGrid(grid, refresh); refresh();
  levelPicker(n.querySelector('[data-levels]'), () => { deckGrid(grid, refresh); refresh(); });
  n.querySelectorAll('[data-start]').forEach(b => b.onclick = () => startSession(b.dataset.start));
  render(n, 'home');
}

/* ---------- study session ---------- */
function startSession(mode) {
  const queue = buildQueue();
  if (!queue.length) { alert('No cards in the selected decks at this level. Pick another deck or a higher level.'); return; }
  state.session = { mode, queue, total: queue.length, done: 0, results: [], missed: [] };
  nextCard();
}
function nextCard() {
  const s = state.session;
  if (!s.queue.length) return showSummary();
  const card = s.queue.shift(); s.current = card;
  const n = tpl('t-study');
  const q = sel => n.querySelector(sel);
  q('[data-bar]').style.width = Math.round(100 * s.done / s.total) + '%';
  q('[data-counter]').textContent = `${s.done + 1} of ${s.total}`;
  q('[data-mode-label]').textContent = s.mode === 'speak' ? 'Speak' : 'Listen';
  const prompt = q('[data-prompt]');
  if (s.mode === 'speak') {
    prompt.innerHTML = `${esc(card.en)}<span class="hint">Say it out loud first. Then type it.</span>`;
    q('[data-conf-label]').textContent = 'Before you check: how sure are you?';
  } else {
    prompt.innerHTML = `<span class="hint">Listen. Type the romaji of what you heard, and decide whether you know what it means.</span>`;
    q('[data-audio-row]').hidden = false;
    q('[data-conf-label]').textContent = 'Do you know what it means?';
    q('[data-meaning-field]').hidden = false;
    setTimeout(() => speak(card.ja), 300);
  }
  n.querySelectorAll('[data-play]').forEach(b => b.onclick = () => speak(card.ja));
  n.querySelectorAll('[data-play-slow]').forEach(b => b.onclick = () => speak(card.ja, true));
  n.querySelectorAll('[data-play-syl]').forEach(b => b.onclick = () => speakSyllables(card));

  const form = q('[data-answer-form]'), input = q('[data-input]'), submit = q('[data-submit]');
  const [phR, phE] = placeholderFor(card); input.placeholder = 'e.g. ' + fmtRomaji(phR); q('[data-meaning]').placeholder = 'e.g. ' + phE;
  const ready = () => { submit.disabled = !(input.value.trim() && form.conf.value); };
  input.oninput = ready; form.querySelectorAll('input[name=conf]').forEach(r => r.onchange = ready);
  setTimeout(() => input.focus(), 50);

  form.onsubmit = ev => {
    ev.preventDefault();
    const conf = form.conf.value, g = gradeRomaji(input.value, card);
    const meaningTyped = s.mode === 'listen' ? q('[data-meaning]').value : '';
    const mg = s.mode === 'listen' ? gradeMeaning(meaningTyped, card) : null; // null = left blank
    const correct = g === 'ok' && mg !== 'bad';
    record(card.id, correct, conf);
    s.done++; s.results.push({ id: card.id, correct, conf, g });
    if (!correct) {
      s.missed.push({ card, conf, typed: input.value + (mg === 'bad' ? ` / meaning: ${meaningTyped}` : '') });
      // Re-queue a few cards later in the same session.
      const at = Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3));
      s.queue.splice(at, 0, card); s.total++;
    }
    form.hidden = true; q('[data-audio-row]').hidden = true;
    const r = q('[data-result]'); r.hidden = false;
    const v = q('[data-verdict]');
    v.className = 'verdict ' + (correct ? 'ok' : g === 'bad' ? 'bad' : 'almost');
    const meaningNote = mg === 'ok' ? ` Meaning “${esc(meaningTyped)}” matched.` : mg === 'bad' ? ` Meaning “${esc(meaningTyped)}” did not match.` : '';
    const vowelNote = g === 'ok' && vowelAssumed(input.value, card) ? ` You typed “${esc(input.value)}”, read as ${esc(toMacron(card.romaji))}. Long vowel.` : '';
    v.innerHTML = g === 'ok' && correct ? 'Correct' + `<small>${mg === 'ok' ? 'Heard it and knew it.' : ''}${vowelNote}${conf === 'none' ? ' You said no idea. Counted, but spaced short.' : ''}</small>`
      : g === 'ok' ? `Heard it right, but the meaning was off.<small>${vowelNote}${meaningNote}${conf === 'sure' ? ' You were sure. That is the one to pay attention to.' : ''}</small>`
      : g === 'almost' ? `Almost, but no.<small>You typed “${esc(input.value)}”. Close counts as wrong here on purpose.${meaningNote}</small>`
      : `Wrong.<small>You typed “${esc(input.value)}”.${meaningNote}${conf === 'sure' ? ' You were sure. That is the one to pay attention to.' : ''}</small>`;
    q('[data-ja]').textContent = card.ja;
    q('[data-romaji]').textContent = fmtRomaji(card.romaji);
    q('[data-en]').textContent = card.en;
    q('[data-notes]').textContent = card.notes || '';
    q('[data-tip]').hidden = !card.tip; q('[data-tip-text]').textContent = card.tip || '';
    renderMorae(q('[data-morae]'), card);
    const ex = card.examples && card.examples.length ? card.examples[Math.floor(Math.random() * card.examples.length)] : null;
    q('[data-example]').innerHTML = ex ? `<div class="ja">${esc(ex.ja)}</div><div class="romaji">${esc(fmtRomaji(ex.romaji))}</div><div class="en">${esc(ex.en)}</div>` : '';
    if (state.settings.autoplay) speak(ex && s.mode === 'speak' ? card.ja : card.ja);
    const next = q('[data-next]'); next.onclick = nextCard; next.focus();
  };
  render(n, 'home');
}
function showSummary() {
  const s = state.session, n = tpl('t-summary');
  const right = s.results.filter(r => r.correct).length, over = s.results.filter(r => !r.correct && r.conf === 'sure').length;
  n.querySelector('[data-summary]').innerHTML = statBox(s.results.length, 'answers') + statBox(right, 'correct') + statBox(s.results.length - right, 'wrong') + statBox(over, 'sure but wrong');
  const m = n.querySelector('[data-missed]');
  const seen = new Set();
  s.missed.forEach(({ card, conf, typed }) => { if (seen.has(card.id)) return; seen.add(card.id);
    m.append(el(`<div class="item"><div class="ja">${esc(card.ja)} <span class="r">${esc(fmtRomaji(card.romaji))}</span></div><div>${esc(card.en)}</div><div class="tag">${conf === 'sure' ? 'overconfident · ' : ''}you typed “${esc(typed)}”</div></div>`)); });
  if (s.missed.length) m.prepend(el('<h2>Missed this session</h2>'));
  state.session = null;
  render(n, 'home');
}

/* ---------- group ---------- */
function showGroup() {
  const n = tpl('t-group');
  const ggrid = n.querySelector('[data-deck-grid]');
  deckGrid(ggrid);
  levelPicker(n.querySelector('[data-levels]'), () => deckGrid(ggrid));
  const ta = n.querySelector('[data-players]'); ta.value = (state.group && state.group.playerNames) ? state.group.playerNames.join('\n') : '';
  n.querySelector('[data-group-form]').onsubmit = ev => {
    ev.preventDefault();
    const names = ta.value.split('\n').map(x => x.trim()).filter(Boolean);
    if (!names.length) { ta.focus(); return; }
    const dir = n.querySelector('input[name=gdir]:checked').value;
    const cards = interleave(selectedCards()); if (!cards.length) return;
    state.group = { playerNames: names, dir, cards, i: 0, score: Object.fromEntries(names.map(x => [x, { ok: 0, bad: 0 }])) };
    groupCard();
  };
  render(n, 'group');
}
function groupCard() {
  const g = state.group;
  if (g.i >= g.cards.length) { g.i = 0; shuffle(g.cards); }
  const card = g.cards[g.i], n = tpl('t-group-play'), q = s => n.querySelector(s);
  q('[data-counter]').textContent = `Card ${g.i + 1} of ${g.cards.length}`;
  const prompt = q('[data-prompt]');
  if (g.dir === 'speak') prompt.innerHTML = `${esc(card.en)}<span class="hint">Host reads this aloud. Everyone says it in Japanese.</span>`;
  else { prompt.innerHTML = `<span class="hint">Host plays the audio. Everyone says what it means.</span>`; q('[data-audio-row]').hidden = false; }
  n.querySelectorAll('[data-play]').forEach(b => b.onclick = () => speak(card.ja));
  n.querySelectorAll('[data-play-slow]').forEach(b => b.onclick = () => speak(card.ja, true));
  n.querySelectorAll('[data-play-syl]').forEach(b => b.onclick = () => speakSyllables(card));
  const marks = {};
  q('[data-reveal]').onclick = ev => {
    ev.target.hidden = true; q('[data-result]').hidden = false;
    q('[data-ja]').textContent = card.ja; q('[data-romaji]').textContent = fmtRomaji(card.romaji); q('[data-en]').textContent = card.en; q('[data-notes]').textContent = card.notes || '';
    q('[data-tip]').hidden = !card.tip; q('[data-tip-text]').textContent = card.tip || '';
    renderMorae(q('[data-morae]'), card);
    if (g.dir === 'speak' && state.settings.autoplay) speak(card.ja);
    q('[data-players]').replaceChildren(...g.playerNames.map(name => {
      const p = el(`<div class="player"><span class="name">${esc(name)}</span><span class="grade"><button class="ok" aria-label="${esc(name)} correct">✓</button><button class="bad" aria-label="${esc(name)} wrong">✗</button></span></div>`);
      p.querySelectorAll('button').forEach(b => b.onclick = () => { marks[name] = b.classList.contains('ok'); p.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
      return p;
    }));
  };
  q('[data-next]').onclick = () => {
    for (const name of g.playerNames) if (name in marks) g.score[name][marks[name] ? 'ok' : 'bad']++;
    g.i++; groupCard();
  };
  q('[data-scoreboard]').innerHTML = g.playerNames.map(nm => statBox(`${g.score[nm].ok}<span style="font-size:14px;color:var(--muted)">/${g.score[nm].ok + g.score[nm].bad}</span>`, esc(nm))).join('');
  render(n, 'group');
}

/* ---------- browse ---------- */
function showBrowse() {
  const n = tpl('t-browse'), wrap = n.querySelector('[data-browse]');
  state.decks.forEach(d => {
    const rows = d.cards.map(c => { const p = state.progress[c.id];
      const seen = !p || !p.seen ? '–' : `${p.correct}/${p.seen}`;
      return `<tr><td class="ja">${esc(c.ja)}<span class="lvl">L${cardLevel(c)}</span></td><td class="r">${esc(fmtRomaji(c.romaji))}</td><td>${esc(c.en)}</td><td class="due">${seen}${p && p.overconf ? ' · ' + p.overconf + '×sure-wrong' : ''}</td></tr>`; }).join('');
    wrap.append(el(`<div class="browse-deck"><h2>${esc(d.name)} <span class="muted small">${esc(d.file)}</span></h2><p class="muted small">${esc(d.description || '')}</p><table>${rows}</table></div>`));
  });
  render(n, 'browse');
}

/* ---------- settings ---------- */
function showSettings() {
  const n = tpl('t-settings');
  n.querySelectorAll('[data-set]').forEach(i => {
    const k = i.dataset.set;
    if (i.type === 'checkbox') { i.checked = !!state.settings[k]; i.onchange = () => { state.settings[k] = i.checked; saveSettings(); }; }
    else { i.value = state.settings[k]; i.onchange = () => { state.settings[k] = Number(i.value); saveSettings(); }; }
  });
  n.querySelector('[data-export]').onclick = () => {
    const blob = new Blob([JSON.stringify({ progress: state.progress, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'hanasu-progress.json' }); a.click();
  };
  n.querySelector('[data-import]').onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (d.progress) { state.progress = d.progress; saveProgress(); showSettings(); } } catch { alert('Not a valid progress file.'); }
  };
  n.querySelector('[data-reset]').onclick = () => { if (confirm('Erase all progress on this device?')) { state.progress = {}; saveProgress(); showSettings(); } };
  n.querySelector('[data-voice-info]').textContent = 'speechSynthesis' in window
    ? (jaVoice ? `Japanese voice: ${jaVoice.name}` : 'No Japanese voice found on this device. Audio prompts will be silent.')
    : 'This browser has no speech synthesis.';
  render(n, 'settings');
}

loadDecks().then(showHome).catch(err => { view.innerHTML = `<p>Could not load decks: ${esc(err.message)}. Serve this folder over http (e.g. <code>python3 -m http.server</code>); file:// blocks fetch.</p>`; });
