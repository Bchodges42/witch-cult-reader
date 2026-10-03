(() => {
'use strict';
if (document.getElementById('wcr-panel')) return;
const content = document.querySelector('article .entry-content, .entry-content');
if (!content) return;
const key = 'wcr:v2';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(key) || 'null') || JSON.parse(localStorage.getItem('wcr:v1') || 'null') || {}; } catch {}
const state = {theme:'paper', size:20, width:740, highlight:true, focus:false, pages:{}, ...saved};
state.pages ||= {}; delete state.notes;
state.tts = Object.assign({rate:1, play:true, narrator:'', voices:{}, engine:'device'}, state.tts || {});
state.tts.voices = Object.assign({}, state.tts.voices);
state.tts.local = Object.assign({url:'http://127.0.0.1:9880', kind:'gptsovits', presets:{}}, state.tts.local || {});
state.tts.local.presets = Object.assign({}, state.tts.local.presets);
const path = location.pathname;
let statusEl = null;
const note = msg => { if (statusEl) statusEl.textContent = msg; };
const persist = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { note('Storage unavailable; settings cannot be saved.'); } };

const paragraphs = [...content.querySelectorAll('p')].filter(p => p.textContent.trim());
// Site dialogue format: "Name: [spoken line]" on its own paragraph.
// "???"/"??": masked speaker. Whole-italic paragraphs are inner thoughts.
const LABEL = /^([^:[\]\u2026!?]{1,45}?):\s*[\[\u300C]/u;
const UNKNOWN = /^(\?{2,6}):\s*[\[\u300C]/u;
const UNLABELED = /^[\[\u300C][\s\S]*[\]\u300D]$/u;
const FOOTNOTE = /^\[\d+\]/u;
const metaLabel = /^(https?|translated|proofread|source)$/i;

// Pass 1 - collect the cast from dialogue labels.
const names = new Set();
let hasUnknown = false;
for (const p of paragraphs) {
  const text = p.textContent.trim();
  if (UNKNOWN.test(text)) { hasUnknown = true; continue; }
  const m = text.match(LABEL);
  if (m && /\p{L}/u.test(m[1]) && !metaLabel.test(m[1].trim())) names.add(m[1].trim());
}
const cast = [...names].sort((a, b) => a.localeCompare(b));
// Golden-angle spacing keeps neighbouring speakers visually distinct.
const hueOf = {};
cast.forEach((name, i) => hueOf[name] = (i * 137.508) % 360);
const hue = name => hueOf[name] ?? 258;

// Wrap the character range [start, end) of root's flattened text in a span.
function wrapRange(root, start, end, className) {
  const nodes = [];
  let idx = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const n = walker.currentNode; nodes.push({n, s: idx, e: idx + n.nodeValue.length}); idx += n.nodeValue.length; }
  const wrapped = [];
  for (const {n, s, e} of nodes) {
    if (e <= start || s >= end) continue;
    if (e > end) n.splitText(end - s);
    wrapped.push(s < start ? n.splitText(start - s) : n);
  }
  if (!wrapped.length) return null;
  const span = document.createElement('span');
  span.className = className;
  wrapped[0].parentNode.insertBefore(span, wrapped[0]);
  for (const n of wrapped) span.appendChild(n);
  return span;
}

// Pass 2 - classify every paragraph: dialogue (tinted per speaker), inner thought, or narration.
let lastSpeaker = null;
for (const p of paragraphs) {
  const text = p.textContent;
  const trimmed = text.trim();
  const unknown = UNKNOWN.test(trimmed);
  const m = unknown ? null : trimmed.match(LABEL);
  const speaker = (!unknown && m && /\p{L}/u.test(m[1]) && !metaLabel.test(m[1].trim())) ? m[1].trim() : null;
  if (unknown || speaker) {
    p.classList.add('wcr-dialogue');
    if (unknown) p.classList.add('wcr-unknown');
    else { p.dataset.speaker = speaker; p.style.setProperty('--h', hue(speaker)); lastSpeaker = speaker; }
    const colon = text.indexOf(':');
    if (colon > -1) {
      const chip = wrapRange(p, 0, colon + 1, 'wcr-label');
      if (chip) chip.dataset.speaker = unknown ? '???' : speaker;
    }
    continue;
  }
  if (UNLABELED.test(trimmed) && !FOOTNOTE.test(trimmed)) {
    // Unlabeled bracketed line: same speaker as the previous dialogue continues.
    p.classList.add('wcr-dialogue', 'wcr-continuation');
    if (lastSpeaker) { p.dataset.speaker = lastSpeaker; p.style.setProperty('--h', hue(lastSpeaker)); }
    else p.classList.add('wcr-unknown');
    continue;
  }
  const total = trimmed.replace(/\s+/g, '');
  if (total.length >= 15) {
    const italic = [...p.querySelectorAll('i, em')].map(e => e.textContent).join('').replace(/\s+/g, '');
    if (italic.length / total.length >= 0.9) { p.classList.add('wcr-thought'); continue; }
  }
  p.classList.add('wcr-narration');
}

// Pass 3 - tint name mentions in narration/dialogue with the same per-speaker color.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ordered = [...names].sort((a, b) => b.length - a.length);
if (ordered.length) {
  const regex = new RegExp('(?<![\\p{L}\\p{N}_])(' + ordered.map(escape).join('|') + ')(?![\\p{L}\\p{N}_])', 'gu');
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {acceptNode: n => n.parentElement.closest('a,script,style,button,textarea,code,.wcr-label') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue; regex.lastIndex = 0; let match, last = 0; const frag = document.createDocumentFragment();
    while ((match = regex.exec(text))) {
      frag.append(text.slice(last, match.index));
      const mark = document.createElement('span');
      mark.className = 'wcr-name'; mark.dataset.name = match[0]; mark.style.setProperty('--h', hue(match[0])); mark.textContent = match[0];
      frag.append(mark); last = regex.lastIndex;
    }
    if (last) { frag.append(text.slice(last)); node.replaceWith(frag); }
  }
}

// ---- read aloud: voice casting knowledge base ----
// Gender + delivery hints for the recurring Re:Zero cast (fan-known profiles).
const CHARACTER_PROFILES = {
  'Subaru':{g:'m',pitch:1.02,rate:1.05}, 'Emilia':{g:'f',pitch:1.18}, 'Rem':{g:'f',pitch:1.06},
  'Ram':{g:'f',pitch:1.12,rate:0.97}, 'Beatrice':{g:'f',pitch:1.45,rate:1.02}, 'Echidna':{g:'f',pitch:1.0},
  'Anastasia':{g:'f',pitch:1.28}, 'Julius':{g:'m',pitch:0.92,rate:0.98}, 'Otto':{g:'m',pitch:1.12},
  'Garfiel':{g:'m',pitch:0.86}, 'Roswaal':{g:'m',pitch:0.8,rate:0.9}, 'Meili':{g:'f',pitch:1.42},
  'Louis':{g:'f',pitch:1.32}, 'Petra':{g:'f',pitch:1.4}, 'Crusch':{g:'f',pitch:1.0},
  'Felt':{g:'f',pitch:1.32}, 'Priscilla':{g:'f',pitch:1.22}, 'Wilhelm':{g:'m',pitch:0.82},
  'Reinhard':{g:'m',pitch:0.92}, 'Puck':{g:'m',pitch:1.35}, 'Vincent':{g:'m',pitch:0.9},
  'Todd':{g:'m',pitch:1.0}, 'Chisha':{g:'m',pitch:0.95}, 'Medium':{g:'f',pitch:1.2},
  'Florence':{g:'f',pitch:0.95}, 'Jamal':{g:'m',pitch:0.95}, 'Grob':{g:'m',pitch:0.8},
  'Ubilk':{g:'m',pitch:1.1}, 'Al':{g:'m',pitch:0.85}, 'Ricardo':{g:'m',pitch:0.8},
  'Mimi':{g:'f',pitch:1.38}, 'Hetaro':{g:'m',pitch:1.1}, 'Tivey':{g:'m',pitch:1.15},
  'Patrasche':{g:'f',pitch:1.0,rate:0.95}, 'Clind':{g:'m',pitch:0.9}, 'Frederica':{g:'f',pitch:1.0},
  'Liliana':{g:'f',pitch:1.25}
};
// Known natural voices by gender (macOS, Windows, Edge-natural, Google) + novelty voices to avoid.
const VOICE_DB = {
  f: ['samantha','karen','moira','tessa','fiona','vicki','victoria','sandy','shelley','flo','serena','ava','allison','susan','zira','hazel','catherine','aria','jenny','michelle','amber','ana','emma','amy','libby','sonia','lily','sara','nancy','jane','cora','monica','elizabeth','tara','joana','kanya','paulina','yelda','meijia','laura','milena','zosia','ellen','lekha','damayanti','carmit','kyoko','ting-ting','yuna','melina','marisol','isabela','helena','luciana','camila','bianca','alva','nora','satu','google uk english female','google us english'],
  m: ['alex','daniel','eddy','reed','rocko','tom','aaron','david','mark','george','guy','christopher','jason','tony','roger','ryan','steffan','thomas','will','eric','brian','andrew','jacob','joe','john','kai','liam','matthew','michael','paul','peter','philip','arthur','oliver','harry','davis','brandon','gordon','rishi','aman','google uk english male'],
  novelty: ['bad news','good news','bahh','bells','boing','bubbles','cellos','wobble','jester','organ','superstar','trinoids','whisper','zarvox','fred','albert','ralph','junior','grandma','grandpa','eloquence','deranged','hysterical']
};
const nameHash = s => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; };
const profileOf = name => CHARACTER_PROFILES[name] || {g: nameHash(name) % 2 ? 'f' : 'm', pitch: 0.95 + (nameHash(name) % 11) / 50, rate: 1};
const synth = window.speechSynthesis || null;
const ttsUI = synth ? `<details id="wcr-ttsbox" open><summary>Read aloud</summary><div class="wcr-actions"><button id="wcr-speak">\u25b6 Read from top</button><button id="wcr-pause" hidden>\u23f8 Pause</button><button id="wcr-stop" hidden>\u23f9 Stop</button></div><label>Voice engine <select id="wcr-engine"><option value="device">Device voices (offline)</option><option value="local">Local AI server (your desktop)</option></select></label><label>Speed <input id="wcr-rate" type="range" min="0.5" max="2" step="0.05"><output id="wcr-rate-value"></output></label><label><input id="wcr-playmode" type="checkbox"> Give each character their own voice</label><div id="wcr-local-ui" hidden><label>Server address <input id="wcr-server" type="url" placeholder="http://127.0.0.1:9880"></label><label>Server type <select id="wcr-server-kind"><option value="gptsovits">GPT-SoVITS (api_v2)</option><option value="sbvits2">Style-Bert-VITS2</option></select></label><div class="wcr-actions"><button id="wcr-test-server">Test</button><button id="wcr-load-models">Load character models</button><button id="wcr-preset-tpl">Cast template</button></div><label>Voice presets JSON \u2014 <span id="wcr-preset-count"></span><textarea id="wcr-presets" rows="7" spellcheck="false" placeholder='{"narrator":{"ref":"C:/voices/narrator.wav","prompt":"what that clip says","lang":"ja"},"Rem":{"ref":"C:/voices/rem.wav","prompt":"...","lang":"ja"}}'></textarea></label><div class="wcr-actions"><button id="wcr-save-presets">Apply presets</button></div><p class="wcr-small">GPT-SoVITS: every voice is a short clip of the character + what it says. Characters without a preset fall back to the narrator. Audio is generated entirely on your machine.</p></div><div id="wcr-device-ui"><label>Narrator voice <select id="wcr-narrator"></select></label><div id="wcr-voice-rows"></div><div class="wcr-actions"><button id="wcr-autovoice">\u2728 Auto-pick voices that match the cast</button></div><p class="wcr-small">Tip: click any line to start reading from there. On a Mac add nicer voices under System Settings \u2192 Accessibility \u2192 Spoken Content.</p></div></details>` : '';

const panel = document.createElement('aside'); panel.id = 'wcr-panel'; panel.setAttribute('aria-label', 'Witch Cult Reader settings');
panel.innerHTML = `<button id="wcr-toggle" aria-expanded="false" aria-controls="wcr-controls">\u2726 Reader</button><section id="wcr-controls" hidden><header><strong>Witch Cult Reader</strong><button id="wcr-close" aria-label="Close settings">\u00d7</button></header><div id="wcr-jump" hidden></div>${ttsUI}<p class="wcr-legend">Each speaker's dialogue keeps one color. Dashed italics = inner thoughts. Plain text = narration.</p><label><input id="wcr-highlight" type="checkbox"> Color dialogue by character</label><label><input id="wcr-focus" type="checkbox"> Calm reading mode (hide site menus)</label><label>Theme <select id="wcr-theme"><option value="paper">Warm paper</option><option value="night">Night</option><option value="light">Light</option></select></label><label>Text size <input id="wcr-size" type="range" min="16" max="30"><output id="wcr-size-value"></output></label><label>Column width <input id="wcr-width" type="range" min="520" max="1000" step="20"></label><div class="wcr-actions"><button id="wcr-bookmark">Save position</button><button id="wcr-resume">Resume</button></div><p id="wcr-status" role="status"></p><details><summary>Speakers in this chapter</summary><p>Detected from dialogue labels. Unlabeled lines continue the previous speaker; ??? means the translation hid the name. Colors can repeat.</p><div id="wcr-cast"></div></details><p class="wcr-small">Saved in this browser on this website. No accounts, AI calls, or analytics.</p><a href="https://witchculttranslation.com/arc-7/">Arc 7 chapter index</a></section>`;
document.body.append(panel);
const q = id => panel.querySelector('#wcr-' + id);
statusEl = q('status');
const controls = q('controls'), toggle = q('toggle');
function open(value) { controls.hidden = !value; toggle.setAttribute('aria-expanded', String(value)); if (value) q('close').focus(); else toggle.focus(); }
toggle.onclick = () => open(controls.hidden); q('close').onclick = () => open(false);
panel.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
content.classList.add('wcr-content');
// Theme, text size and column width restyle the article immediately; calm mode only declutters.
function apply() {
  document.body.classList.toggle('wcr-focus', state.focus);
  document.documentElement.classList.toggle('wcr-focus', state.focus);
  document.body.dataset.wcrTheme = state.theme;
  document.documentElement.dataset.wcrTheme = state.theme;
  document.documentElement.style.setProperty('--wcr-size', state.size + 'px');
  document.documentElement.style.setProperty('--wcr-width', state.width + 'px');
  content.classList.toggle('wcr-colors', state.highlight);
  q('size-value').textContent = state.size + ' px';
}
for (const id of ['highlight', 'focus', 'theme', 'size', 'width']) {
  const input = q(id); if (input.type === 'checkbox') input.checked = state[id]; else input.value = state[id];
  input.addEventListener('input', () => { state[id] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value; apply(); persist(); });
}
const list = [...cast]; if (hasUnknown) list.push('???');
for (const name of list) {
  const button = document.createElement('button'); button.textContent = name; button.className = 'wcr-cast-name' + (name === '???' ? ' wcr-cast-unknown' : '');
  if (name !== '???') button.style.setProperty('--h', hue(name));
  button.title = 'Jump to the next ' + (name === '???' ? 'unknown-speaker line' : 'line by this speaker');
  button.onclick = () => {
    const sel = name === '???' ? '.wcr-dialogue.wcr-unknown' : '.wcr-dialogue[data-speaker="' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
    const lines = [...content.querySelectorAll(sel)];
    const next = lines.find(n => n.getBoundingClientRect().top > 90) || lines[0];
    if (next) next.scrollIntoView({block: 'center', behavior: 'smooth'});
  };
  q('cast').append(button);
}
if (!list.length) q('cast').textContent = 'No dialogue labels detected on this page.';
// ---- reading position: saves where you are and which chapter ----
const isChapter = content.querySelector('.wcr-dialogue') !== null;
const cleanTitle = t => (t || '').replace(/\s*[|\u2013\u2014]\s*Witch Cult Translations.*$/i, '').trim() || t || 'Chapter';
function position() {
  let index = paragraphs.findIndex(p => p.getBoundingClientRect().bottom > 80);
  if (index < 0) index = Math.max(0, paragraphs.length - 1);
  const p = paragraphs[index];
  return {index, offset: p ? Math.round(p.getBoundingClientRect().top) : 0, title: cleanTitle(document.title), progress: paragraphs.length > 1 ? index / (paragraphs.length - 1) : 0};
}
function savePosition(manual = false) {
  const pos = position(); state.pages[path] = pos;
  // A quick glance at a chapter top must not steal "Continue reading" from real progress.
  if (isChapter && (manual || !state.last || state.last.path === path || pos.progress > 0.02)) state.last = {path, title: pos.title};
  persist(); renderJump(); if (manual) note('Reading position saved.');
}
function restore(pos, instant = false) {
  let p = paragraphs[pos.index];
  if (!p && typeof pos.progress === 'number' && paragraphs.length > 1) p = paragraphs[Math.min(paragraphs.length - 1, Math.round(pos.progress * (paragraphs.length - 1)))];
  if (!p) return false;
  window.scrollTo({top: window.scrollY + p.getBoundingClientRect().top - (pos.offset || 0), behavior: instant ? 'auto' : 'smooth'});
  return true;
}
q('bookmark').onclick = () => savePosition(true);
q('resume').onclick = () => { const pos = state.pages[path]; if (!pos) { note('No saved position on this page yet.'); return; } restore(pos); };
// The panel always shows the arc/chapter you left off on, with a jump back to it.
function renderJump() {
  const box = q('jump');
  const lastCh = state.last, lastPos = lastCh && state.pages[lastCh.path];
  if (!lastCh || !lastPos || !(lastPos.progress > 0.005)) { box.hidden = true; box.textContent = ''; return; }
  const pct = Math.round(lastPos.progress * 100);
  const here = lastCh.path === path;
  const strong = document.createElement('strong'); strong.textContent = 'Continue reading';
  const span = document.createElement('span'); span.textContent = lastPos.title || lastCh.title || lastCh.path;
  const em = document.createElement('em'); em.textContent = pct + '% through' + (here ? ' this chapter' : '');
  box.textContent = ''; box.hidden = false;
  if (here) { box.append(strong, span, em); return; }
  const link = document.createElement('a'); link.href = new URL(lastCh.path, location.origin).href;
  const tag = document.createElement('small'); tag.textContent = 'Jump back in \u2192';
  link.append(strong, span, em, tag); box.append(link);
}
renderJump();

// ---- read aloud: engine ----
if (synth) {
  const tts = state.tts;
  const speaking = {seq: [], i: 0, queue: [], on: false, paused: false, busy: false, para: null, gen: 0, audio: null, pre: null, weights: null};
  let voices = synth.getVoices().slice();
  let lastUserScroll = 0;
  window.addEventListener('wheel', () => { lastUserScroll = Date.now(); }, {passive: true});
  window.addEventListener('touchmove', () => { lastUserScroll = Date.now(); }, {passive: true});

  const enVoices = () => voices.filter(v => /^en/i.test(v.lang));
  const isNovelty = n => VOICE_DB.novelty.some(x => n.toLowerCase().includes(x));
  const voiceGender = n => { const l = n.toLowerCase(); return VOICE_DB.f.some(x => l.includes(x)) ? 'f' : VOICE_DB.m.some(x => l.includes(x)) ? 'm' : ''; };
  // Lower score = more natural: online/natural voices, then Google, then local; novelty never used.
  const voiceScore = v => { const l = v.name.toLowerCase(); let s = 0; if (/natural|online|premium|enhanced/.test(l)) s -= 40; if (l.includes('google')) s -= 30; if (v.localService) s += 5; return s; };
  const bestVoices = () => enVoices().filter(v => !isNovelty(v.name)).sort((a, b) => voiceScore(a) - voiceScore(b));

  function autoAssign(names) {
    const pool = bestVoices();
    const pools = {f: pool.filter(v => voiceGender(v.name) === 'f'), m: pool.filter(v => voiceGender(v.name) === 'm'), any: pool.slice()};
    const taken = new Set(Object.keys(tts.voices).filter(n => !names.includes(n)).map(n => tts.voices[n]));
    if (tts.narrator) taken.add(tts.narrator);
    const take = list => { while (list.length) { const v = list.shift(); if (!taken.has(v.voiceURI)) return v; } return null; };
    for (const name of names) {
      const g = name === '???' ? 'any' : profileOf(name).g;
      const v = take(pools[g]) || take(pools.any) || pool[0];
      if (v) tts.voices[name] = v.voiceURI;
    }
  }
  function voicesReady() {
    voices = synth.getVoices().slice();
    if (!voices.length) return false;
    const valid = uri => voices.some(v => v.voiceURI === uri);
    if (!valid(tts.narrator)) {
      const pref = ['google us english', 'samantha', 'aria', 'jenny', 'guy', 'alex', 'daniel', 'zira', 'david'];
      const pool = bestVoices();
      tts.narrator = (pool.find(v => pref.some(p => v.name.toLowerCase().includes(p))) || pool[0] || {voiceURI: ''}).voiceURI;
    }
    const missing = [...cast, '???'].filter(n => !tts.voices[n] || !valid(tts.voices[n]));
    for (const n of missing) delete tts.voices[n];
    if (missing.length) autoAssign(missing);
    renderVoiceUI();
    persist();
    return true;
  }
  function renderVoiceUI() {
    const narr = q('narrator'), rows = q('voice-rows');
    if (!narr || !rows) return;
    rows.textContent = '';
    if (tts.engine === 'local') {
      narr.textContent = '';
      const pre = tts.local.presets || {};
      for (const name of list) {
        const row = document.createElement('div'); row.className = 'wcr-voice-row';
        const chip = document.createElement('span'); chip.className = 'wcr-cast-name'; chip.textContent = name; chip.style.setProperty('--h', hue(name));
        const status = document.createElement('span'); status.className = 'wcr-voice-status';
        const v = pre[name];
        status.textContent = v && v.gpt ? 'character pack' : v && (v.ref || v.model) ? (v.model ? v.model : 'own voice') : '\u2192 narrator';
        if (!(v && (v.ref || v.model))) status.classList.add('wcr-voice-fallback');
        row.append(chip, status); rows.append(row);
      }
      return;
    }
    const opts = bestVoices();
    narr.textContent = '';
    for (const v of opts) { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')'; if (v.voiceURI === tts.narrator) o.selected = true; narr.append(o); }
    for (const name of list) {
      const row = document.createElement('label'); row.className = 'wcr-voice-row';
      const chip = document.createElement('span'); chip.className = 'wcr-cast-name'; chip.textContent = name; chip.style.setProperty('--h', hue(name));
      const sel = document.createElement('select');
      for (const v of opts) { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = v.name; if (tts.voices[name] === v.voiceURI) o.selected = true; sel.append(o); }
      sel.onchange = () => { tts.voices[name] = sel.value; persist(); };
      row.append(chip, sel); rows.append(row);
    }
  }

  // Which paragraphs are actual prose (skip credits, scene-break glyphs, translator notes).
  function skipPara(p) {
    const t = p.textContent.trim();
    if (!t) return true;
    const bare = t.replace(/\s+/g, '');
    if (bare.length < 4) return true;
    if (/[\u203b\u25b3\u25bd\u2666\u2662]/.test(bare)) return true;
    if (/^(translated|proofread|art sources|source)\b/i.test(t)) return true;
    if (/^(all rights belong|japanese web novel source)/i.test(t)) return true;
    if (/^[A-Z0-9\s.,!'\u2019&:()\u2013-]+$/.test(t) && t.length > 25) return true;
    if (/^\[\d+\]/.test(t)) return true;
    if (p.querySelector('a') && t.length < 40) return true;
    return false;
  }
  // Most frequent speaker = likely POV; their voice reads the inner thoughts.
  const counts = {}; for (const p of paragraphs) { const s = p.dataset.speaker; if (s) counts[s] = (counts[s] || 0) + 1; }
  const pov = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;

  // Local AI server: a voice is a GPT-SoVITS reference clip or a Style-Bert-VITS2 model name.
  function localVoiceFor(p, speaker, isD) {
    const pre = tts.local.presets || {};
    if (!tts.play) return pre.narrator || null;
    if (isD && speaker && pre[speaker]) return pre[speaker];
    if (isD) return pre['???'] || pre.narrator || null;
    if (p.classList.contains('wcr-thought') && pov && pre[pov]) return pre[pov];
    return pre.narrator || null;
  }
  function localRequest(item) {
    const base = (tts.local.url || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('set the server address first');
    const v = item.lvoice || (tts.local.presets && tts.local.presets.narrator) || null;
    const rate = Math.min(2, Math.max(0.5, tts.rate));
    if ((tts.local.kind || 'gptsovits') === 'gptsovits') {
      if (!v || !v.ref) throw new Error('no narrator voice preset \u2014 fill the Voice presets JSON');
      return {url: base + '/tts', init: {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({text: item.text, text_lang: 'en', ref_audio_path: v.ref, prompt_text: v.prompt || '', prompt_lang: v.lang || 'ja', speed_factor: rate, media_type: 'wav', streaming_mode: false})}};
    }
    if (!v || !v.model) throw new Error('no narrator voice preset \u2014 fill the Voice presets JSON');
    const params = new URLSearchParams({model: v.model, text: item.text, language: 'EN', length: String(1 / rate)});
    if (v.style) params.set('style', v.style);
    return {url: base + '/voice?' + params.toString(), init: {method: 'POST'}};
  }
  // Optional trained character packs: {gpt, sovits} weight paths, loaded on speaker change.
  const weightKeyOf = v => v && ((v.gpt || '') + '|' + (v.sovits || ''));
  async function ensureWeights(v) {
    const key = weightKeyOf(v);
    if (!key || key === '|') return;
    if (speaking.weights === key) return;
    const base = (tts.local.url || '').trim().replace(/\/+$/, '');
    await proxyFetch(base + '/set_gpt_weights?weights_path=' + encodeURIComponent(v.gpt), {method: 'GET'});
    await proxyFetch(base + '/set_sovits_weights?weights_path=' + encodeURIComponent(v.sovits), {method: 'GET'});
    speaking.weights = key;
  }
  function proxyFetch(url, init) {
    return new Promise((resolve, reject) => {
      if (window.chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({type: 'wcr-proxy', url, init}, res => {
          if (!res) reject(new Error('extension proxy unavailable'));
          else if (!res.ok) reject(Object.assign(new Error(res.error || ('server HTTP ' + res.status)), {status: res.status}));
          else resolve(res);
        });
      } else {
        fetch(url, init).then(async r => {
          if (!r.ok) throw Object.assign(new Error('server HTTP ' + r.status), {status: r.status});
          const ctype = r.headers.get('content-type') || '';
          resolve({ok: true, status: r.status, contentType: ctype, body: await r.arrayBuffer()});
        }).catch(reject);
      }
    });
  }

  function chunksFor(p, push) {
    let text = p.textContent.trim();
    const speaker = p.dataset.speaker || null;
    const isD = p.classList.contains('wcr-dialogue');
    if (isD && tts.play) text = text.replace(/^\s*\?{2,6}\s*:\s*/, '').replace(/^\s*[^:\[\]\u2026!?]{1,45}?\s*:\s*(?=\[)/u, '');
    text = text.replace(/[[\]\u300c\u300d\u3010\u3011]/g, '').replace(/\u2026/g, '...').replace(/\s+/g, ' ').trim();
    if (!text) return;
    let uri = tts.narrator, pitch = 1, rate = 1, who = 'Narrator';
    if (tts.play) {
      if (isD && speaker && tts.voices[speaker]) { uri = tts.voices[speaker]; const pr = profileOf(speaker); pitch = pr.pitch; rate = pr.rate; who = speaker; }
      else if (isD) { pitch = 0.92; rate = 0.97; who = '???'; }
      else if (p.classList.contains('wcr-thought') && pov && tts.voices[pov]) { uri = tts.voices[pov]; pitch = profileOf(pov).pitch * 0.95; who = pov; }
    }
    // Sentence-sized utterances keep pauses natural and dodge long-utterance bugs.
    const lead = (text.match(/^[.!?]+["'\u201d\u2019)\]]*\s*/) || [''])[0];
    const parts = (lead ? text.slice(lead.length) : text).match(/[^.!?]+[.!?]+["'\u201d\u2019)\]]*\s*|[^.!?]+$/g) || [text];
    if (lead && parts.length) parts[0] = lead.trim() + parts[0];
    const chunks = [];
    for (const part of parts) {
      if (part.trim().length <= 200) { chunks.push(part.trim()); continue; }
      let buf = '';
      for (const seg of part.split(/(?<=[,;:\u2014])\s*/)) {
        if (buf && (buf + seg).length > 180) { chunks.push(buf.trim()); buf = seg; } else buf += seg;
      }
      if (buf.trim()) chunks.push(buf.trim());
    }
    for (const c of chunks) if (/[a-zA-Z0-9]/.test(c)) push({text: c, uri, pitch, rate, para: p, who, lvoice: tts.engine === 'local' ? localVoiceFor(p, speaker, isD) : null});
  }

  const player = document.createElement('div'); player.id = 'wcr-player'; player.hidden = true;
  player.innerHTML = '<button id="wcr-player-pause" type="button">\u23f8</button><span id="wcr-player-who"></span><button id="wcr-player-stop" type="button">\u23f9</button>';
  document.body.append(player);
  function setSpeakingPara(el, who) {
    if (speaking.para && speaking.para !== el) speaking.para.classList.remove('wcr-speaking');
    speaking.para = el;
    if (el) {
      el.classList.add('wcr-speaking');
      if (Date.now() - lastUserScroll > 2500) el.scrollIntoView({block: 'center', behavior: 'smooth'});
    }
    player.querySelector('#wcr-player-who').textContent = who || '';
  }
  function syncButtons() {
    q('pause').hidden = !speaking.on; q('stop').hidden = !speaking.on;
    q('pause').textContent = speaking.paused ? '\u25b6 Resume' : '\u23f8 Pause';
    player.querySelector('#wcr-player-pause').textContent = speaking.paused ? '\u25b6' : '\u23f8';
    player.hidden = !speaking.on;
  }
  function finishSpeaking() {
    speaking.on = false; speaking.paused = false; speaking.queue = []; speaking.busy = false;
    speaking.gen = (speaking.gen || 0) + 1; speaking.pre = null; speaking.weights = null;
    synth.cancel();
    if (speaking.audio) { try { speaking.audio.pause(); speaking.audio.src = ''; } catch {} speaking.audio = null; }
    if (speaking.para) speaking.para.classList.remove('wcr-speaking');
    speaking.para = null; player.hidden = true; syncButtons();
  }
  async function audioForItem(item) {
    if (speaking.pre && speaking.pre.item === item) { const p = speaking.pre.promise; speaking.pre = null; return p; }
    const req = localRequest(item);
    return proxyFetch(req.url, req.init);
  }
  function prefetchNext(currentVoice) {
    const next = speaking.queue[0];
    if (!next || (speaking.pre && speaking.pre.item === next)) return;
    const nextKey = weightKeyOf(next.lvoice), curKey = weightKeyOf(currentVoice) || null;
    if (nextKey && nextKey !== curKey) return; // needs a weight switch first; no prefetch
    try { const req = localRequest(next); speaking.pre = {item: next, promise: proxyFetch(req.url, req.init)}; }
    catch {}
  }
  async function speakLocal(item) {
    const gen = speaking.gen;
    speaking.busy = true;
    try {
      await ensureWeights(item.lvoice || (tts.local.presets && tts.local.presets.narrator));
      if (gen !== speaking.gen || !speaking.on || speaking.paused) { speaking.busy = false; return; }
      const resp = await audioForItem(item);
      if (gen !== speaking.gen || !speaking.on || speaking.paused) { speaking.busy = false; return; }
      const blob = new Blob([resp.body], {type: (resp.contentType || 'audio/wav').split(';')[0]});
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      speaking.audio = audio; speaking.busy = false;
      setSpeakingPara(item.para, item.who);
      audio.onended = () => { URL.revokeObjectURL(url); if (speaking.audio === audio) speaking.audio = null; if (speaking.on && !speaking.paused) speakNext(); };
      audio.onerror = () => { URL.revokeObjectURL(url); if (speaking.audio === audio) speaking.audio = null; };
      await audio.play();
      prefetchNext(item.lvoice || (tts.local.presets && tts.local.presets.narrator));
    } catch (err) {
      speaking.busy = false;
      if (gen !== speaking.gen) return;
      note('Read aloud error: ' + err.message);
      finishSpeaking();
    }
  }
  function pump() {
    if (!speaking.on || speaking.paused) return;
    while (speaking.queue.length < 2 && speaking.i < speaking.seq.length) {
      chunksFor(speaking.seq[speaking.i], item => speaking.queue.push(item));
      speaking.i++;
    }
    speakNext();
  }
  function speakNext() {
    if (!speaking.on || speaking.paused || speaking.busy) return;
    const item = speaking.queue.shift();
    if (!item) { if (speaking.i < speaking.seq.length) { pump(); return; } finishSpeaking(); return; }
    if (tts.engine === 'local') { speakLocal(item); return; }
    const u = new window.SpeechSynthesisUtterance(item.text);
    const v = voices.find(x => x.voiceURI === item.uri);
    if (v) u.voice = v;
    u.pitch = Math.min(2, Math.max(0.5, item.pitch));
    u.rate = Math.min(2, Math.max(0.5, item.rate * tts.rate));
    u.volume = 1;
    speaking.busy = true;
    setSpeakingPara(item.para, item.who);
    u.onend = () => {
      speaking.busy = false;
      if (!speaking.on || speaking.paused) return;
      const next = speaking.queue[0];
      if (next && next.para !== item.para) setTimeout(() => { if (speaking.on && !speaking.paused) pump(); }, 240);
      else pump();
    };
    u.onerror = e => { speaking.busy = false; if (e && (e.error === 'interrupted' || e.error === 'canceled')) return; if (speaking.on && !speaking.paused) pump(); };
    synth.speak(u);
  }
  function startSpeaking(fromEl) {
    synth.cancel();
    speaking.on = true; speaking.paused = false; speaking.busy = false; speaking.queue = []; speaking.i = 0;
    speaking.gen = (speaking.gen || 0) + 1; speaking.pre = null; speaking.audio = null;
    speaking.seq = paragraphs.filter(p => !skipPara(p));
    if (fromEl) { const idx = speaking.seq.indexOf(fromEl); if (idx > 0) speaking.i = idx; }
    syncButtons();
    setTimeout(pump, 80); // Chrome can drop an utterance spoken in the same tick as cancel()
  }
  q('speak').onclick = () => startSpeaking(null);
  q('stop').onclick = finishSpeaking;
  player.querySelector('#wcr-player-stop').onclick = finishSpeaking;
  const togglePause = () => {
    if (!speaking.on) return;
    speaking.paused = !speaking.paused;
    if (speaking.paused) { synth.pause(); if (speaking.audio) speaking.audio.pause(); }
    else { synth.resume(); if (speaking.audio) speaking.audio.play(); pump(); }
    syncButtons();
  };
  q('pause').onclick = togglePause;
  player.querySelector('#wcr-player-pause').onclick = togglePause;
  content.addEventListener('click', e => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const p = e.target.closest && e.target.closest('p');
    if (!p || !paragraphs.includes(p)) return;
    startSpeaking(p);
  });
  const rate = q('rate'); rate.value = tts.rate; q('rate-value').textContent = Number(tts.rate).toFixed(2).replace(/0$/, '') + '\u00d7';
  rate.addEventListener('input', () => { tts.rate = Number(rate.value); q('rate-value').textContent = Number(tts.rate).toFixed(2).replace(/0$/, '') + '\u00d7'; persist(); });
  const playmode = q('playmode'); playmode.checked = tts.play;
  playmode.addEventListener('input', () => { tts.play = playmode.checked; persist(); });
  q('narrator').addEventListener('change', e => { tts.narrator = e.target.value; persist(); });
  q('autovoice').onclick = () => { tts.voices = {}; autoAssign([...cast, '???']); renderVoiceUI(); persist(); note('Voices re-picked to match the cast.'); };

  // ---- local AI server wiring ----
  const engineSel = q('engine');
  engineSel.value = tts.engine;
  engineSel.addEventListener('input', () => { finishSpeaking(); tts.engine = engineSel.value; persist(); applyEngineUI(); renderVoiceUI(); });
  const serverIn = q('server'); serverIn.value = tts.local.url;
  serverIn.addEventListener('input', () => { tts.local.url = serverIn.value.trim(); persist(); });
  const kindSel = q('server-kind'); kindSel.value = tts.local.kind;
  kindSel.addEventListener('input', () => { tts.local.kind = kindSel.value; persist(); renderPresetCount(); });
  q('test-server').onclick = async () => {
    note('Testing server\u2026');
    try { const r = await proxyFetch(tts.local.url.trim().replace(/\/+$/, '') + '/', {method: 'GET'}); note('Server reachable (HTTP ' + r.status + ') \u2014 ready to read.'); }
    catch (err) { note('Cannot reach server: ' + err.message + ' \u2014 is it running? See the README setup guide.'); }
  };
  q('load-models').onclick = async () => {
    note('Loading models\u2026');
    try {
      const r = await proxyFetch(tts.local.url.trim().replace(/\/+$/, '') + '/models/info');
      const info = r.body || {};
      const names = Array.isArray(info) ? info.map(x => String((x && (x.name || x.model)) || x)) : Object.keys(info);
      const pre = Object.assign({}, tts.local.presets);
      for (const name of [...cast, '???']) {
        const key = name.toLowerCase();
        const hit = names.find(n => String(n).toLowerCase().includes(key)) || names.find(n => key.includes(String(n).toLowerCase().replace(/\.pth$/i, '')));
        if (hit && !pre[name]) pre[name] = {model: String(hit).replace(/\.pth$/i, ''), style: 'Neutral'};
      }
      tts.local.presets = pre; q('presets').value = JSON.stringify(pre, null, 2); renderPresetCount(); persist(); renderVoiceUI();
      note('Matched voices against ' + names.length + ' models \u2014 check the JSON, then Apply.');
    } catch (err) { note('Load failed: ' + err.message + ' (this button is for Style-Bert-VITS2 servers)'); }
  };
  q('preset-tpl').onclick = () => {
    const tpl = {narrator: {ref: 'C:/voices/narrator.wav', prompt: '', lang: 'ja'}, '???': {ref: 'C:/voices/mystery.wav', prompt: '', lang: 'ja'}};
    for (const n of cast) tpl[n] = {ref: 'C:/voices/' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.wav', prompt: '', lang: 'ja'};
    q('presets').value = JSON.stringify(tpl, null, 2);
    note('Template filled for this cast \u2014 point each ref at a clip of that character, then Apply.');
  };
  q('presets').value = Object.keys(tts.local.presets).length ? JSON.stringify(tts.local.presets, null, 2) : '';
  q('save-presets').onclick = () => {
    try {
      const parsed = JSON.parse(q('presets').value || '{}');
      delete parsed._readme;
      tts.local.presets = parsed; persist(); renderPresetCount(); renderVoiceUI();
      note('Presets applied \u2014 ' + Object.keys(parsed).length + ' voices set.');
    } catch (err) { note('Presets JSON is invalid: ' + err.message); }
  };
  function renderPresetCount() {
    const n = Object.keys(tts.local.presets || {}).filter(k => k !== '_readme').length;
    q('preset-count').textContent = n ? n + ' voice' + (n === 1 ? '' : 's') + ' set' : 'none set yet';
  }
  function applyEngineUI() {
    q('local-ui').hidden = tts.engine !== 'local';
    q('device-ui').hidden = tts.engine === 'local';
  }
  applyEngineUI(); renderPresetCount();
  if (!voicesReady() && typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', voicesReady);
  let tries = 0; const retry = setInterval(() => { if (voicesReady() || ++tries > 10) clearInterval(retry); }, 250);
}

let timer;
if (isChapter) {
  window.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(() => savePosition(), 800); }, {passive: true});
  window.addEventListener('pagehide', () => savePosition());
}
// Reopening a chapter jumps back to where you stopped (skipped when a #anchor is used).
const savedHere = state.pages[path];
if (isChapter && savedHere && !location.hash) {
  restore(savedHere, true);
  let interacted = false;
  const mark = () => { interacted = true; };
  window.addEventListener('wheel', mark, {passive: true}); window.addEventListener('touchstart', mark, {passive: true}); window.addEventListener('keydown', mark);
  window.addEventListener('load', () => { if (!interacted) restore(savedHere, true); });
  if ((savedHere.progress || 0) > 0.01) {
    const toast = document.createElement('div'); toast.id = 'wcr-toast';
    const text = document.createElement('span'); text.textContent = 'Resumed at ' + Math.round((savedHere.progress || 0) * 100) + '% through this chapter';
    const top = document.createElement('button'); top.type = 'button'; top.textContent = 'Back to top';
    top.onclick = () => { window.scrollTo({top: 0, behavior: 'smooth'}); toast.remove(); };
    toast.append(text, top); document.body.append(toast); setTimeout(() => toast.remove(), 7000);
  }
  note('Resumed your saved position. Save position updates it; Resume returns to it.');
} else if (savedHere) {
  note('Saved position available. Use Resume to return.');
}
// Any other page of the site offers a one-click jump back into the last chapter.
const last = state.last;
if (last && last.path !== path) {
  const pos = state.pages[last.path];
  if (pos && pos.progress > 0.01) {
    const card = document.createElement('aside'); card.id = 'wcr-continue';
    const link = document.createElement('a'); link.href = new URL(last.path, location.origin).href;
    const strong = document.createElement('strong'); strong.textContent = 'Continue reading';
    const span = document.createElement('span'); span.textContent = pos.title || last.title || last.path;
    const em = document.createElement('em'); em.textContent = Math.round(pos.progress * 100) + '% through \u2014 jump back in';
    link.append(strong, span, em);
    const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', 'Dismiss'); close.textContent = '\u00d7';
    close.onclick = () => card.remove();
    card.append(link, close); document.body.append(card);
  }
}
apply();
})();
