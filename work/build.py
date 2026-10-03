from pathlib import Path
import json
p = Path('outputs/witch-cult-reader')
p.mkdir(parents=True, exist_ok=True)
p.joinpath('manifest.json').write_text(json.dumps({'manifest_version': 3, 'name': 'Witch Cult Reader', 'version': '1.5.0', 'description': 'Per-character dialogue colors, themes, saved position, and a play-style read-aloud reader with local AI character voices (GPT-SoVITS / Style-Bert-VITS2) for Witch Cult Translations.', 'background': {'service_worker': 'background.js'}, 'host_permissions': ['http://127.0.0.1/*', 'http://localhost/*'], 'content_scripts': [{'matches': ['https://witchculttranslation.com/*'], 'js': ['reader.js'], 'css': ['reader.css'], 'run_at': 'document_idle'}]}, indent=2))

p.joinpath('background.js').write_text(r'''// Witch Cult Reader - local TTS proxy. Content scripts on the https site cannot
// fetch a local http server directly; the service worker can, via host_permissions.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'wcr-proxy') return;
  (async () => {
    try {
      const target = new URL(msg.url);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
        sendResponse({ok: false, status: 0, error: 'blocked: only local servers are allowed'});
        return;
      }
      const r = await fetch(msg.url, msg.init || {});
      const ctype = r.headers.get('content-type') || '';
      let body;
      if (ctype.startsWith('audio/') || ctype.includes('octet-stream')) body = await r.arrayBuffer();
      else if (ctype.includes('json')) body = await r.json();
      else body = await r.text();
      sendResponse({ok: r.ok, status: r.status, contentType: ctype, body});
    } catch (e) { sendResponse({ok: false, status: 0, error: String(e)}); }
  })();
  return true;
});
''')

p.joinpath('local-voices-template.json').write_text('''{
  "_readme": "Voice presets for the Local AI server engine. GPT-SoVITS: each voice is {ref, prompt, lang} - a short clip of the character on your desktop plus what the clip says. Style-Bert-VITS2: each voice is {model, style} using model names from its models folder. narrator is required; any character left out falls back to narrator. ??? covers masked speakers.",
  "narrator": {"ref": "C:/voices/narrator.wav", "prompt": "what the narrator clip says", "lang": "ja"},
  "Subaru": {"ref": "C:/voices/subaru.wav", "prompt": "what the Subaru clip says", "lang": "ja"},
  "Emilia": {"ref": "C:/voices/emilia.wav", "prompt": "what the Emilia clip says", "lang": "ja"},
  "Rem": {"ref": "C:/voices/rem.wav", "prompt": "what the Rem clip says", "lang": "ja"},
  "Ram": {"ref": "C:/voices/ram.wav", "prompt": "what the Ram clip says", "lang": "ja"},
  "Beatrice": {"ref": "C:/voices/beatrice.wav", "prompt": "what the Beatrice clip says", "lang": "ja"},
  "???": {"ref": "C:/voices/mystery.wav", "prompt": "what the mystery clip says", "lang": "ja"}
}
''')

READER_JS = r'''(() => {
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
  const speaking = {seq: [], i: 0, queue: [], on: false, paused: false, busy: false, para: null, gen: 0, audio: null, pre: null};
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
        status.textContent = v && (v.ref || v.model) ? (v.model ? v.model : 'own voice') : '\u2192 narrator';
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
    speaking.gen = (speaking.gen || 0) + 1; speaking.pre = null;
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
  function prefetchNext() {
    const next = speaking.queue[0];
    if (!next || (speaking.pre && speaking.pre.item === next)) return;
    try { const req = localRequest(next); speaking.pre = {item: next, promise: proxyFetch(req.url, req.init)}; }
    catch {}
  }
  async function speakLocal(item) {
    const gen = speaking.gen;
    speaking.busy = true;
    try {
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
      prefetchNext();
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
'''

READER_CSS = '''/* ---------- floating panel ---------- */
#wcr-panel{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:14px/1.5 system-ui,sans-serif;color:#eee}
#wcr-panel *{box-sizing:border-box}
#wcr-panel button,#wcr-panel select,#wcr-panel textarea{font:inherit}
#wcr-panel button{cursor:pointer;border:1px solid #555;border-radius:8px;padding:7px 11px;background:#292631;color:#fff}
#wcr-controls{width:310px;max-width:calc(100vw - 36px);max-height:75vh;overflow:auto;background:#201e26;padding:18px;border:1px solid #555;border-radius:14px;box-shadow:0 12px 50px #0005;margin-bottom:10px}
#wcr-controls[hidden]{display:none}
#wcr-controls header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
#wcr-controls label{display:block;margin:13px 0}
#wcr-controls input[type=range],#wcr-controls textarea{width:100%}
#wcr-controls textarea,#wcr-controls select{background:#34313d;color:#fff;border:1px solid #777;border-radius:5px;padding:6px}
#wcr-controls a{color:#c9b5ff}
#wcr-controls details p,.wcr-small{font-size:12px;color:#c5becd}
.wcr-legend{font-size:12px;color:#d8d2e2;background:#2b2833;border-radius:6px;padding:6px 8px}
#wcr-jump{display:flex;flex-direction:column;gap:2px;background:#2b2833;border:1px solid #443f52;border-radius:8px;padding:9px 11px;margin-bottom:10px}
#wcr-jump[hidden]{display:none}
#wcr-jump a{display:flex;flex-direction:column;gap:2px;text-decoration:none}
#wcr-jump a:hover strong{color:#e6dcff}
#wcr-jump strong{color:#c9b5ff;font-size:12px;letter-spacing:.3px}
#wcr-jump span{color:#fff;font-weight:600}
#wcr-jump em,#wcr-jump small{color:#c5becd;font-style:normal;font-size:12px}
#wcr-cast{display:flex;flex-wrap:wrap;gap:5px}
#wcr-cast .wcr-cast-name{border-color:hsl(var(--h,258) 60% 65%)}
#wcr-panel :focus-visible{outline:3px solid #c7a7ff;outline-offset:3px}
@media(max-width:600px){#wcr-panel{right:10px;bottom:10px}}

/* ---------- reading typography: applies always, no calm mode needed ---------- */
.wcr-content{max-width:var(--wcr-width,740px)!important;margin-left:auto!important;margin-right:auto!important;font-family:Georgia,'Times New Roman',serif;font-size:var(--wcr-size,20px)!important;line-height:1.85!important;padding:24px 26px;border-radius:12px}
.wcr-content p{font-size:inherit!important;line-height:inherit!important}

/* ---------- themes restyle the reading card immediately ---------- */
body[data-wcr-theme=paper] .wcr-content{background:#f8f1e2;color:#37322a}
body[data-wcr-theme=light] .wcr-content{background:#fff;color:#242424}
body[data-wcr-theme=night] .wcr-content{background:#17181d;color:#dcd8cf}
body[data-wcr-theme=night] .wcr-content :is(p,span:not(.wcr-label),h1,h2,h3,h4,h5,h6,li,td,blockquote,b,strong,i,em){color:inherit!important}
.wcr-content a{color:#7351a8}
body[data-wcr-theme=night] .wcr-content a{color:#c4a7ef}
.wcr-content img{max-width:100%;height:auto}

/* ---------- dialogue / thought / narration ---------- */
.wcr-label{font-weight:700}
.wcr-colors .wcr-dialogue{background:hsl(var(--h,258) 60% 55% / .10);border-left:3px solid hsl(var(--h,258) 50% 42%);border-radius:4px;padding:2px 10px}
.wcr-colors .wcr-dialogue.wcr-unknown{background:hsla(258,12%,50%,.10);border-left-style:dashed;border-left-color:hsla(258,12%,55%,.65)}
.wcr-colors .wcr-label{color:hsl(var(--h,258) 55% 36%)!important}
.wcr-colors .wcr-thought{font-style:italic;background:hsla(0,0%,45%,.08);border-left:3px dashed hsla(0,0%,45%,.45);border-radius:4px;padding:2px 10px}
.wcr-colors .wcr-name{background:hsl(var(--h,258) 70% 75% / .30);border-bottom:2px solid hsl(var(--h,258) 65% 42%);border-radius:3px;padding:0 1px}
.wcr-colors .wcr-dialogue .wcr-name{background:transparent;border-bottom:2px dotted hsl(var(--h,258) 65% 40%)}
body[data-wcr-theme=night] .wcr-colors .wcr-dialogue{background:hsl(var(--h,258) 60% 60% / .16);border-left-color:hsl(var(--h,258) 55% 62%)}
body[data-wcr-theme=night] .wcr-colors .wcr-label{color:hsl(var(--h,258) 70% 74%)!important}
body[data-wcr-theme=night] .wcr-colors .wcr-name{background:hsl(var(--h,258) 60% 60% / .25);border-bottom-color:hsl(var(--h,258) 65% 68%)}


/* ---------- read aloud ---------- */
#wcr-controls .wcr-actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
#wcr-ttsbox summary{cursor:pointer;color:#c9b5ff;font-weight:600;margin:12px 0 6px}
#wcr-voice-rows{display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto;padding-right:4px}
.wcr-voice-row{display:flex;align-items:center;gap:6px;margin:0}
.wcr-voice-row .wcr-cast-name{flex:0 0 auto;font-size:12px;padding:4px 8px;border:1px solid hsl(var(--h,258) 60% 65%);border-radius:6px;background:transparent;cursor:default}
.wcr-voice-row select{flex:1;min-width:0;margin:0}
.wcr-voice-status{flex:1;min-width:0;font-size:12px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wcr-voice-fallback{color:#8f8899}
#wcr-local-ui label{margin:10px 0}
#wcr-local-ui input[type=url]{width:100%;background:#34313d;color:#fff;border:1px solid #777;border-radius:5px;padding:6px}
#wcr-presets{font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre;resize:vertical}
#wcr-local-ui .wcr-small{margin-top:8px}
#wcr-rate-value{color:#c5becd;font-size:12px}
#wcr-player{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:8px;align-items:center;background:#201e26;color:#eee;font:13px/1.4 system-ui,sans-serif;padding:8px 10px;border:1px solid #555;border-radius:999px;box-shadow:0 10px 40px #0006}
#wcr-player[hidden]{display:none}
#wcr-player button{cursor:pointer;border:1px solid #666;border-radius:999px;background:#34313d;color:#fff;padding:4px 10px;font:inherit}
#wcr-player span{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wcr-content .wcr-speaking{outline:2px solid #a88ff0;outline-offset:3px;border-radius:4px}
body[data-wcr-theme=night] .wcr-content .wcr-speaking{outline-color:#8f7bd6}

/* ---------- resume toast + continue card ---------- */
#wcr-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:10px;align-items:center;background:#201e26;color:#eee;font:13px/1.4 system-ui,sans-serif;padding:9px 12px;border:1px solid #555;border-radius:10px;box-shadow:0 10px 40px #0006}
#wcr-toast button{cursor:pointer;border:1px solid #666;border-radius:6px;background:#34313d;color:#fff;padding:4px 8px;font:inherit}
#wcr-continue{position:fixed;left:18px;bottom:18px;z-index:2147483647;font:13px/1.4 system-ui,sans-serif;max-width:300px}
#wcr-continue a{display:flex;flex-direction:column;gap:2px;background:#201e26;color:#eee;text-decoration:none;padding:11px 34px 11px 13px;border:1px solid #555;border-radius:12px;box-shadow:0 10px 40px #0006;position:relative}
#wcr-continue a:hover,#wcr-continue a:focus-visible{border-color:#c9b5ff}
#wcr-continue strong{color:#c9b5ff;font-size:12px;letter-spacing:.3px}
#wcr-continue span{color:#fff;font-weight:600}
#wcr-continue em{color:#c5becd;font-style:normal;font-size:12px}
#wcr-continue button{position:absolute;top:6px;right:6px;cursor:pointer;background:transparent;border:0;color:#c5becd;font-size:15px;padding:3px 5px}
#wcr-continue button:hover{color:#fff}
@media(max-width:600px){#wcr-continue{left:10px;bottom:10px;max-width:calc(100vw - 20px)}#wcr-toast{bottom:72px;max-width:calc(100vw - 24px)}}

/* ---------- calm reading mode: declutter the site, theme the whole page ---------- */
.wcr-focus{background:#f5efdf!important;color:#302b25!important}
.wcr-focus[data-wcr-theme=night]{background:#17181d!important;color:#dcd8cf!important}
.wcr-focus[data-wcr-theme=light]{background:#fff!important;color:#242424!important}
.wcr-focus #masthead,.wcr-focus #secondary,.wcr-focus footer,.wcr-focus #comments,.wcr-focus .sharedaddy,.wcr-focus .related-posts{display:none!important}
.wcr-focus #page,.wcr-focus #content,.wcr-focus #primary,.wcr-focus article,.wcr-focus main{background:transparent!important;color:inherit!important;float:none!important;width:auto!important;max-width:none!important;box-shadow:none!important}
.wcr-focus #primary{margin:0!important;padding:24px 16px!important}
.wcr-focus .wcr-content,.wcr-focus .entry-header{max-width:var(--wcr-width,740px)!important;margin:auto!important}
.wcr-focus .wcr-content{background:transparent!important;padding:0!important;border-radius:0!important;padding-bottom:20vh}
.wcr-focus .wcr-content p{margin:1.1em 0!important}
@media(max-width:600px){.wcr-focus #primary{padding:20px 12px!important}}
'''

README = '''# Witch Cult Reader - Chrome / Edge

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
4. Open or refresh a Witch Cult Translations chapter. Click **\u2726 Reader** in the bottom-right corner.

## How highlighting works

Every `Name: [line]` paragraph is spoken dialogue and is tinted with that character's color - label, brackets, and all - and the color stays the same for the whole chapter. A bracketed line without a name continues the previous speaker. A dashed, slanted block is a character's inner thoughts (the translation renders thoughts in italics). Plain text with no tint is narration. Lines labeled `???` keep a shared "unknown speaker" look instead of guessing. Name mentions inside narration get the same color as the speaker's dialogue.

## Read aloud (a play, not a robot)

Open **Read aloud** in the panel and press **\u25b6 Read from top**, or just **click any line** to start reading from there. Text is read sentence by sentence with natural pauses, skipping credits and scene-break glyphs.

- **A voice per character**: dialogue is spoken with that character's own voice, kept for every chapter and session. Inner thoughts are read by the chapter's point-of-view character (its most frequent speaker). Narration uses the narrator voice, and `???` lines get a slightly lowered, unattributed read.
- **Voices are auto-cast to match the cast**: the extension knows the recurring Re:Zero characters (Subaru, Emilia, the twins, Beatrice, Anastasia, Julius, and many more) and picks distinct, gender-matched, natural-sounding device voices \u2014 preferring "Natural/Premium/Google" voices over robotic ones and never using novelty voices. Unknown names still get a distinct voice. Re-cast anytime with **\u2728 Auto-pick**, or choose any voice manually per character; your picks persist.
- **Speed** slider (0.5\u20132\u00d7) applies live. Uncheck "Give each character their own voice" for a single-voice reading that announces `Name:` labels instead.
- While reading, the current line is highlighted and followed; a small player pill offers pause/stop and shows who is speaking.

## Local AI character voices (the good ones)

The Device-voices engine is free and instant but robotic. The **Local AI server** engine reads the novel with AI voices generated on your own desktop \u2014 no cloud, no API key, no cost \u2014 and can genuinely sound like the Re:Zero cast. It works with two free, open-source engines that already have Re:Zero character voices available:

- **GPT-SoVITS** (recommended) \u2014 a voice is defined by a short clip of a character (5\u201310 seconds of Rem, Subaru, etc.) plus what that clip says. It reads your English text in that character's voice. No per-character training needed: any clean clip works, so grabbing lines from the anime is enough. Runs comfortably on a 6\u20138 GB GPU (an RTX 3050 is fine).
- **Style-Bert-VITS2** \u2014 per-character model files you download; lighter (~2 GB VRAM). "Load character models" in the panel auto-matches downloaded model names to the chapter's cast.

### One-time setup on the desktop (Windows, NVIDIA GPU)

1. Install **GPT-SoVITS** \u2014 easiest is the official Windows integrated package from the GitHub releases page (`RVC-Boss/GPT-SoVITS`). Unzip it somewhere like `C:\\GPT-SoVITS`.
2. Collect one short, clean, dialogue-only clip per character (WAV, 5\u201310 s, no music/effects). Name them `rem.wav`, `subaru.wav`, \u2026 in e.g. `C:\\voices`, and note what each clip says (the transcript must match the audio).
3. Start its API server from the package's folder:
   `python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml`
   (the integrated package includes a `go-api.bat`/API toggle that does the same). First launch loads the default model \u2014 about 4 GB of VRAM; it stays on the GPU between lines.
4. In the reader panel: **Voice engine \u2192 Local AI server**, address `http://127.0.0.1:9880`, type **GPT-SoVITS (api_v2)**. Press **Cast template**, edit the paths/prompts to match your clips (or start from `local-voices-template.json` shipped next to this README), then **Apply presets**. Press **Test** \u2014 "Server reachable" means you're done.
5. Click any line \u2014 the novel is now read as a radio play, each character in their own voice. Speed works via the slider (server-side, no pitch artifacts).

Notes: the extension talks to the server only on `127.0.0.1`/`localhost`, routed through the extension's own background worker (the site itself cannot reach your server). All text and audio stay on your machine. If the desktop sleeps mid-read, press Stop, wake it, press Read again. For Style-Bert-VITS2 instead: run `python server.py --api` (default `http://127.0.0.1:5000`), set server type accordingly, and use **Load character models** to auto-fill the cast; presets use `{model, style}` instead of `{ref, prompt, lang}`.

VRAM guidance: GPT-SoVITS v2 default config ~4 GB (fits the 3050 with headroom); v3/v4 sound better but want 6\u20138 GB \u2014 close other GPU apps or stay on v2. Style-Bert-VITS2 ~2 GB. With CPU-only fallback it still runs but each sentence takes seconds \u2014 the GPU is what makes it flow.

## Controls

- **Color dialogue by character** turns the tinting above on/off.
- **Theme** (warm paper / night / light), **text size**, and **column width** restyle the chapter immediately.
- **Calm reading mode** additionally hides the site's menus, sidebar, and comments and themes the whole page.
- Click a speaker in "Speakers in this chapter" to jump to their next line.
- **Where you were is saved automatically** as you scroll (on chapter pages). Reopen that chapter and it jumps straight back to your spot, with a short "Resumed at N%" note. The **Resume** button goes back to it, and **Save position** bookmarks explicitly.
- **The arc and chapter you were reading are remembered**: open the reader panel anywhere and the top of it shows your last chapter, its title, and how far you got \u2014 click it to jump back in. On any other page of the site (home, arc index, another chapter) a "Continue reading" card in the bottom-left corner does the same, dismissable with the \u00d7.
- Everything is stored only in this browser on this site.

Speaker detection uses only the open page and does not infer secret identities or connect aliases. Expanding the speaker list can reveal names appearing later in the current chapter. Unknown speakers remain unknown. A shared color does not imply a relationship.

Settings and positions are stored in this site's local browser storage. They are accessible to scripts on that site, do not sync between browsers, and disappear if you clear site data. The extension requests no privileged permissions and runs only on witchculttranslation.com. It does not fetch biographies or send data anywhere.

To delete saved data, open the site's DevTools console and run `localStorage.removeItem('wcr:v2')` (and `localStorage.removeItem('wcr:v1')` for data saved by version 1.0), then refresh. Turn off calm reading mode to restore the normal site layout; to remove all visual changes, disable the extension and refresh.

Unpacked extensions are installed locally; this is not a Chrome Web Store listing. Source code is included. Site redesigns may require updating the content selector; saved positions use paragraph indices and may shift if a chapter is revised.
'''

p.joinpath('reader.js').write_text(READER_JS)
p.joinpath('reader.css').write_text(READER_CSS)
p.joinpath('README.md').write_text(README)
print('wrote', *(f.name for f in sorted(p.iterdir())))
