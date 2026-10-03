const {JSDOM}=require('jsdom');const fs=require('fs');const assert=require('node:assert/strict');
const source=fs.readFileSync('outputs/witch-cult-reader/reader.js','utf8');
const css=fs.readFileSync('outputs/witch-cult-reader/reader.css','utf8');
const CH_URL='https://witchculttranslation.com/2021/01/23/arc-7-chapter-1-initiation/';
const CH_PATH='/2021/01/23/arc-7-chapter-1-initiation/';
function boot(file,url=CH_URL,seed){
  const dom=new JSDOM(fs.readFileSync(file,'utf8'),{url,runScripts:'outside-only'});
  dom.window.scrollCalls=[];
  dom.window.scrollTo=o=>dom.window.scrollCalls.push(o);
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  if(seed)dom.window.localStorage.setItem('wcr:v2',JSON.stringify(seed));
  dom.window.eval(source);
  return dom;
}
const dom=boot('work/chapter.html'),d=dom.window.document;
const plain=new JSDOM(fs.readFileSync('work/chapter.html','utf8'),{url:'https://witchculttranslation.com/x/'}).window.document.querySelector('.entry-content').textContent;
assert(d.querySelector('#wcr-panel'));
// dialogue classification on the real chapter (186 labeled + 5 ??? lines)
const dialogue=d.querySelectorAll('.wcr-dialogue').length;
assert.equal(dialogue,191,'total dialogue lines: '+dialogue);
assert.equal(d.querySelectorAll('.wcr-dialogue[data-speaker="Subaru"]').length,63);
assert.equal(d.querySelectorAll('.wcr-dialogue[data-speaker="Rem"]').length,35);
assert.equal(d.querySelectorAll('.wcr-dialogue[data-speaker="Anastasia and the others"]').length,2);
assert.equal(d.querySelectorAll('.wcr-dialogue.wcr-unknown').length,5);
assert.equal(d.querySelectorAll('.wcr-thought').length,1,'inner-thought paragraphs');
assert.equal(d.querySelectorAll('.wcr-label').length,191,'label chip on every labeled line');
assert.equal(d.querySelectorAll('.wcr-narration').length>250,true);
// wrapping must not change the text
assert.equal(d.querySelector('.entry-content').textContent,plain);
// every dialogue line carries the same hue as its speaker's other lines
const subarus=[...d.querySelectorAll('.wcr-dialogue[data-speaker="Subaru"]')];
assert(new Set(subarus.map(p=>p.style.getPropertyValue('--h'))).size===1);
// name mentions still highlighted, never inside label chips
assert(d.querySelectorAll('.wcr-name').length>150);
assert(!d.querySelector('.wcr-label .wcr-name'));
// cast list includes ??? and jumps use dialogue lines
const labels=[...d.querySelectorAll('#wcr-cast button')].map(x=>x.textContent);
assert(labels.includes('Subaru')&&labels.includes('Rem')&&labels.includes('???'));
// panel interaction
d.querySelector('#wcr-toggle').click();assert(!d.querySelector('#wcr-controls').hidden);
// theme/size/width apply WITHOUT calm mode
const theme=d.querySelector('#wcr-theme');theme.value='night';theme.dispatchEvent(new dom.window.Event('input'));
assert.equal(d.body.dataset.wcrTheme,'night');assert.equal(d.documentElement.dataset.wcrTheme,'night');
assert(!d.body.classList.contains('wcr-focus'),'theme applied without focus mode');
const size=d.querySelector('#wcr-size');size.value=26;size.dispatchEvent(new dom.window.Event('input'));
assert.equal(d.documentElement.style.getPropertyValue('--wcr-size'),'26px');
const width=d.querySelector('#wcr-width');width.value=880;width.dispatchEvent(new dom.window.Event('input'));
assert.equal(d.documentElement.style.getPropertyValue('--wcr-width'),'880px');
assert(css.includes('body[data-wcr-theme=night] .wcr-content'),'night theme not scoped to calm mode');
assert(css.includes('.wcr-colors .wcr-dialogue'),'dialogue tint present');
assert(css.includes('.wcr-colors .wcr-thought'),'thought style present');
assert(css.includes('#wcr-continue'),'continue card style present');
assert(css.includes('#wcr-toast'),'resume toast style present');
// calm mode still toggles
d.querySelector('#wcr-focus').click();
assert(d.body.classList.contains('wcr-focus')&&d.documentElement.classList.contains('wcr-focus'));
// position under v2 key + panel Continue block; notes feature removed
assert(!d.querySelector('#wcr-notes'),'notes textarea removed');
const jump=d.querySelector('#wcr-jump');
assert(jump.hidden===true,'jump block hidden before any save');
d.querySelector('#wcr-bookmark').click();
const saved=JSON.parse(dom.window.localStorage.getItem('wcr:v2'));
assert.equal(saved.notes,undefined,'no notes in storage');
assert(saved.pages[dom.window.location.pathname]);
assert(saved.pages[dom.window.location.pathname].progress>=0,'position stores progress');
assert.equal(saved.last.path,dom.window.location.pathname,'manual save records the chapter');
assert.equal(dom.window.localStorage.getItem('wcr:v1'),null,'old key untouched');
assert(jump.hidden===false,'jump block appears after saving');
assert(jump.textContent.includes('Baptism'),'jump block names the chapter');
assert(jump.textContent.includes('% through this chapter'),'jump block shows progress');
d.querySelector('#wcr-resume').click();
d.querySelector('#wcr-cast button').click();
// duplicate injection is a no-op and does not rewrap
const textBefore=d.querySelector('.entry-content').textContent;
dom.window.eval(source);
assert.equal(d.querySelectorAll('#wcr-panel').length,1);
assert.equal(d.querySelector('.entry-content').textContent,textBefore);
console.log(`PASS: chapter — ${dialogue} dialogue lines (${d.querySelectorAll('.wcr-dialogue.wcr-unknown').length} unknown), 1 thought, ${d.querySelectorAll('.wcr-name').length} name mentions, ${labels.length} cast buttons; theme/size/width without calm mode; v2 storage; duplicate injection.`);
dom.window.close();

// reopening a chapter with a saved spot auto-resumes + shows the toast
const dom2=boot('work/chapter.html',CH_URL,{theme:'paper',pages:{[CH_PATH]:{index:150,offset:-500,progress:0.75,title:'Arc 7, Chapter 1 – “Baptism”'}},notes:{}});
const d2=dom2.window.document;
assert(dom2.window.scrollCalls.some(c=>c.top===500&&c.behavior==='auto'),'auto-resume scrolled to the saved offset instantly: '+JSON.stringify(dom2.window.scrollCalls));
assert(d2.querySelector('#wcr-toast'),'resume toast shown');
assert(d2.querySelector('#wcr-toast span').textContent.includes('75%'),'toast shows progress percent');
d2.querySelector('#wcr-toast button').click();
assert(!d2.querySelector('#wcr-toast'),'toast Back to top dismisses it');
console.log('PASS: auto-resume — instant scroll to saved offset, toast with 75%, dismissible.');
dom2.window.close();

// any other site page shows the Continue reading card for the last chapter
const dom3=boot('work/index.html','https://witchculttranslation.com/arc-7/',{theme:'paper',last:{path:CH_PATH,title:'Arc 7, Chapter 1 – “Baptism”'},pages:{[CH_PATH]:{index:80,offset:-300,progress:0.42,title:'Arc 7, Chapter 1 – “Baptism”'}},notes:{}});
const d3=dom3.window.document;
const card=d3.querySelector('#wcr-continue');
assert(card,'continue card on non-chapter page');
assert.equal(card.querySelector('a').href,CH_URL,'card links back to the chapter');
assert(card.textContent.includes('42%'),'card shows chapter progress');
assert(card.textContent.includes('Baptism'),'card shows chapter title');
// an index page must never steal the last-read pointer
dom3.window.dispatchEvent(new dom3.window.Event('pagehide'));
const s3=JSON.parse(dom3.window.localStorage.getItem('wcr:v2'));
assert.equal(s3.last.path,CH_PATH,'index page does not steal last-read chapter');
card.querySelector('button').click();
assert(!d3.querySelector('#wcr-continue'),'card dismissible');
// the panel's Continue block also names the chapter and links back to it
const jump3=d3.querySelector('#wcr-jump');
assert(jump3 && jump3.hidden===false,'panel jump block shown');
assert.equal(jump3.querySelector('a').href,CH_URL,'panel jump links to the chapter');
assert(jump3.textContent.includes('Baptism')&&jump3.textContent.includes('42%'),'panel jump shows title and progress');
console.log('PASS: continue card + panel jump — last chapter with 42% progress, dismissible, index cannot steal last-read.');
dom3.window.close();

// ---- read aloud: fake speechSynthesis, verify casting + playback ----
const FAKE_VOICES=[
  {voiceURI:'urn:gus',name:'Google US English',lang:'en-US',localService:false},
  {voiceURI:'urn:gukf',name:'Google UK English Female',lang:'en-GB',localService:false},
  {voiceURI:'urn:gukm',name:'Google UK English Male',lang:'en-GB',localService:false},
  {voiceURI:'urn:sam',name:'Samantha',lang:'en-US',localService:true},
  {voiceURI:'urn:alex',name:'Alex',lang:'en-US',localService:true},
  {voiceURI:'urn:dan',name:'Daniel',lang:'en-GB',localService:true},
  {voiceURI:'urn:karen',name:'Karen',lang:'en-AU',localService:true},
  {voiceURI:'urn:moira',name:'Moira',lang:'en-IE',localService:true},
  {voiceURI:'urn:tessa',name:'Tessa',lang:'en-ZA',localService:true},
  {voiceURI:'urn:zira',name:'Microsoft Zira',lang:'en-US',localService:true},
  {voiceURI:'urn:david',name:'Microsoft David',lang:'en-US',localService:true},
  {voiceURI:'urn:zar',name:'Zarvox',lang:'en-US',localService:true},
  {voiceURI:'urn:kyoko',name:'Kyoko',lang:'ja-JP',localService:true}
];
function bootTTS(){
  const dom=new JSDOM(fs.readFileSync('work/chapter.html','utf8'),{url:CH_URL,runScripts:'outside-only'});
  dom.window.scrollTo=()=>{};
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  dom.window.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};
  dom.window.spoken=[];
  dom.window.speechSynthesis={
    getVoices:()=>FAKE_VOICES,
    speak:u=>{dom.window.spoken.push(u);setTimeout(()=>u.onend&&u.onend(),5)},
    cancel(){},pause(){},resume(){},speaking:false
  };
  dom.window.eval(source);
  return dom;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const dom=bootTTS(),w=dom.window,d=w.document;
  // auto-casting: narrator + gender-matched, distinct voices for known cast members
  const stored=()=>JSON.parse(w.localStorage.getItem('wcr:v2')).tts;
  let tts=stored();
  assert.equal(tts.narrator,'urn:gus','narrator defaults to Google US English');
  assert(['urn:gukm','urn:alex','urn:dan','urn:david'].includes(tts.voices['Subaru']),'Subaru gets a male voice');
  assert.notEqual(tts.voices['Subaru'],tts.voices['Julius'],'Subaru and Julius get distinct voices');
  assert(['urn:gukm','urn:alex','urn:dan','urn:david'].includes(tts.voices['Julius']),'Julius gets a male voice');
  assert(['urn:gukf','urn:sam','urn:karen','urn:moira','urn:tessa','urn:zira'].includes(tts.voices['Emilia']),'Emilia gets a female voice');
  assert(['urn:gukf','urn:sam','urn:karen','urn:moira','urn:tessa','urn:zira'].includes(tts.voices['Anastasia']),'Anastasia gets a female voice');
  assert.notEqual(tts.voices['Emilia'],tts.voices['Anastasia'],'two female leads get distinct voices');
  assert(tts.voices['???'],'??? gets a voice');
  // voice table rows for whole cast
  const rows=[...d.querySelectorAll('#wcr-voice-rows .wcr-voice-row')];
  assert.equal(rows.length,13,'one row per cast member incl ???');
  assert(rows.some(r=>r.textContent.includes('Julius')&&r.querySelector('select').value===tts.voices['Julius']),'Julius row shows his assigned voice');
  // playback: click Read from top
  d.querySelector('#wcr-speak').click();
  await sleep(80+50);
  assert(w.spoken.length>=1,'speaking started');
  const first=w.spoken[0];
  assert(first.text.startsWith('...As soon as'),'credits/scene breaks skipped, starts at first narration: '+first.text.slice(0,30));
  assert.equal(first.voice&&first.voice.voiceURI,'urn:gus','narration uses narrator voice');
  // ??? line read flat by narrator, label stripped in play mode
  d.querySelector('#wcr-stop').click();
  const qLine=[...d.querySelectorAll('.wcr-dialogue.wcr-unknown')][0];
  qLine.click();
  await sleep(80+60);
  const afterClick=w.spoken.filter(u=>u.text.includes('Ram!'));
  assert(afterClick.length===1&&afterClick[0].text.startsWith('...Ram!'),'click-to-read starts at clicked ??? line with label stripped');
  assert(afterClick[0].pitch<1,'??? read slightly lowered');
  assert.equal(afterClick[0].voice.voiceURI,'urn:gus','??? uses narrator');
  // labelled dialogue: own voice, label stripped in play mode
  d.querySelector('#wcr-stop').click();
  const ramLine=[...d.querySelectorAll('.wcr-dialogue[data-speaker="Ram"]')].find(p=>p.textContent.includes('sama'));
  const before=w.spoken.length;
  ramLine.click();
  await sleep(80+60);
  const ramUtter=w.spoken.slice(before).find(u=>u.text.includes('Emilia'));
  assert(ramUtter,'Ram line spoken');
  assert(ramUtter.text.startsWith('Emilia'),'label stripped in play mode');
  assert(w.spoken.slice(before).some(u=>u.text.includes('sama')),'whole line spoken across sentence chunks');
  assert(ramUtter.voice&&ramUtter.voice.voiceURI===tts.voices['Ram'],'Ram dialogue uses her cast voice');
  assert(ramUtter.pitch>1.05,'read at her pitch');
  // single-voice mode keeps the label
  const pm=d.querySelector('#wcr-playmode');pm.checked=false;pm.dispatchEvent(new w.Event('input'));
  const before2=w.spoken.length;
  d.querySelector('#wcr-stop').click();
  ramLine.click();
  await sleep(80+60);
  assert(w.spoken.slice(before2).some(u=>u.text.startsWith('Ram:')),'single-voice mode announces the label');
  pm.checked=true;pm.dispatchEvent(new w.Event('input'));
  // player pill + highlight + stop
  assert(!d.getElementById('wcr-player').hidden,'player pill visible while speaking');
  assert(d.querySelector('.wcr-speaking'),'current line highlighted');
  d.querySelector('#wcr-stop').click();
  await sleep(20);
  assert(d.getElementById('wcr-player').hidden&&d.querySelector('.wcr-speaking')===null,'stop hides pill and clears highlight');
  // rate persists
  const rate=d.querySelector('#wcr-rate');rate.value='1.5';rate.dispatchEvent(new w.Event('input'));
  assert.equal(stored().rate,1.5,'speed saved');
  console.log('PASS: read aloud — auto-cast '+Object.keys(stored().voices).length+' voices (gender-matched, distinct), click-to-read, label handling per mode, ??? lowered, player pill, speed persistence.');
  dom.window.close();
})().catch(e=>{console.error(e);process.exit(1)});

// ---- local AI server engine: chrome proxy + Audio stubs ----
function bootLocal(){
  const dom=new JSDOM(fs.readFileSync('work/chapter.html','utf8'),{url:CH_URL,runScripts:'outside-only'});
  dom.window.scrollTo=()=>{};
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  dom.window.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};
  dom.window.spoken=[];
  dom.window.speechSynthesis={getVoices:()=>FAKE_VOICES,speak:u=>{},cancel(){},pause(){},resume(){}};
  dom.window.proxyCalls=[];
  dom.window.proxyFail=false;
  dom.window.chrome={runtime:{sendMessage:(msg,cb)=>{
    dom.window.proxyCalls.push(msg);
    if(msg.type!=='wcr-proxy'){cb(null);return;}
    if(dom.window.proxyFail){cb({ok:false,status:0,error:'TypeError: Failed to fetch'});return;}
    cb({ok:true,status:200,contentType:'audio/wav',body:new ArrayBuffer(16)});
  }}};
  dom.window.audios=[];
  let blobSeq=0;
  dom.window.URL.createObjectURL=()=>'blob:fake-'+(++blobSeq);
  dom.window.URL.revokeObjectURL=()=>{};
  dom.window.Audio=class{constructor(src){this.src=src;dom.window.audios.push(this)}play(){this.onended&&setTimeout(()=>this.onended(),5);return Promise.resolve()}pause(){}};
  dom.window.eval(source);
  return dom;
}
(async()=>{
  const dom=bootLocal(),w=dom.window,d=w.document;
  // switch engine to local, apply presets
  const eng=d.querySelector('#wcr-engine');eng.value='local';eng.dispatchEvent(new w.Event('input'));
  assert(!d.querySelector('#wcr-local-ui').hidden&&d.querySelector('#wcr-device-ui').hidden,'engine toggle swaps UI');
  const savedEng=()=>JSON.parse(w.localStorage.getItem('wcr:v2')).tts;
  assert.equal(savedEng().engine,'local','engine choice saved');
  const presets={narrator:{ref:'C:/voices/narrator.wav',prompt:'once upon a time',lang:'ja'},Rem:{ref:'C:/voices/rem.wav',prompt:'rem desu',lang:'ja'},'???':{ref:'C:/voices/myst.wav',prompt:'who',lang:'ja'}};
  const ta=d.querySelector('#wcr-presets');ta.value=JSON.stringify(presets);
  d.querySelector('#wcr-save-presets').click();
  assert.deepEqual(savedEng().local.presets,presets,'presets saved');
  assert(d.querySelector('#wcr-preset-count').textContent.includes('3'),'preset count shown');
  assert([...d.querySelectorAll('.wcr-voice-status')].some(s=>s.textContent==='own voice'),'voice rows show preset status in local mode');
  // read from top: first request goes to /tts with narrator ref, English text, speed 1
  d.querySelector('#wcr-speak').click();
  await sleep(80+80);
  assert(w.proxyCalls.length>=1,'request sent through chrome proxy');
  const first=w.proxyCalls[0];
  assert(first.url==='http://127.0.0.1:9880/tts','hits GPT-SoVITS endpoint');
  const body=JSON.parse(first.init.body);
  assert(body.text.startsWith('...As soon as'),'sends first narration sentence');
  assert.equal(body.ref_audio_path,'C:/voices/narrator.wav','narration uses narrator preset');
  assert.equal(body.prompt_text,'once upon a time','prompt transcript sent');
  assert.equal(body.text_lang,'en','English text language');
  assert.equal(body.speed_factor,1,'default speed 1');
  assert(w.audios.length>=1,'audio element plays returned wav');
  // labelled dialogue uses that character's clip; ??? line uses ??? preset
  d.querySelector('#wcr-stop').click();
  const remLine=[...d.querySelectorAll('.wcr-dialogue[data-speaker="Rem"]')].find(p=>p.textContent.length>30);
  remLine.click();
  await sleep(80+80);
  const remReq=w.proxyCalls.map(c=>{try{return JSON.parse(c.init.body)}catch{return null}}).filter(b=>b&&b.ref_audio_path==='C:/voices/rem.wav');
  assert(remReq.length>=1,'Rem dialogue uses her clip');
  assert(remReq[0].prompt_text==='rem desu','with her clip transcript');
  d.querySelector('#wcr-stop').click();
  const qLine=[...d.querySelectorAll('.wcr-dialogue.wcr-unknown')][0];
  qLine.click();
  await sleep(80+80);
  assert(w.proxyCalls.some(c=>{try{return JSON.parse(c.init.body).ref_audio_path==='C:/voices/myst.wav'}catch{return false}}),'??? lines use the ??? preset');
  // speed slider reaches the server
  d.querySelector('#wcr-stop').click();
  const rate=d.querySelector('#wcr-rate');rate.value='1.5';rate.dispatchEvent(new w.Event('input'));
  const before=w.proxyCalls.length;
  remLine.click();
  await sleep(80+80);
  const fast=w.proxyCalls.slice(before).map(c=>{try{return JSON.parse(c.init.body).speed_factor}catch{return null}});
  assert(fast.includes(1.5),'speed slider applied server-side');
  // server down: error surfaced, playback stops cleanly
  d.querySelector('#wcr-stop').click();
  w.proxyFail=true;
  d.querySelector('#wcr-speak').click();
  await sleep(80+120);
  assert(d.getElementById('wcr-player').hidden,'player hidden after server error');
  assert(d.getElementById('wcr-status').textContent.includes('error'),'error message surfaced');
  w.proxyFail=false;
  // Style-Bert-VITS2 kind: request shape switches to /voice query params
  d.querySelector('#wcr-stop').click();
  const kind=d.querySelector('#wcr-server-kind');kind.value='sbvits2';kind.dispatchEvent(new w.Event('input'));
  const ta2=d.querySelector('#wcr-presets');ta2.value=JSON.stringify({narrator:{model:'aqua',style:'Neutral'}});
  d.querySelector('#wcr-save-presets').click();
  d.querySelector('#wcr-speak').click();
  await sleep(80+80);
  const sb=w.proxyCalls.filter(c=>c.url.includes('/voice?')).pop();
  assert(sb&&sb.url.includes('model=aqua')&&sb.url.includes('language=EN'),'Style-Bert-VITS2 request shape');
  assert(sb.url.includes('length=0.66'),'length maps current speed 1.5x to ~0.67');
  console.log('PASS: local AI engine — proxy routing, per-character refs (Rem/???/narrator), server-side speed, error surfacing, SBV2 shape.');
  dom.window.close();
})().catch(e=>{console.error(e);process.exit(1)});
