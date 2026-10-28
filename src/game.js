/** Seeded room solutions and validation for Lumen Locks. */
export function createSeededSolutions(seed = 'hintvault-demo') {
  if (seed === 'hintvault-demo') {
    return { levers: ['red', 'blue', 'red', 'green'], clock: 7, word: 'GLOW' };
  }
  let state = hashSeed(seed) || 1;
  const next = max => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % max;
  };
  const leverOrders = [
    ['red', 'blue', 'red', 'green'],
    ['blue', 'green', 'yellow', 'red'],
    ['green', 'red', 'blue', 'yellow'],
    ['yellow', 'red', 'green', 'blue'],
  ];
  const words = ['GLOW', 'LAMP', 'NOVA', 'BEAM'];
  return {
    levers: [...leverOrders[next(leverOrders.length)]],
    clock: [7, 4, 9, 6][next(4)],
    word: words[next(words.length)],
  };
}

/** Checks a submitted solution for the selected room. */
export function checkSolution(room, attempt, solutions) {
  if (room === 0 || room === 'lever') {
    const values = Array.isArray(attempt) ? attempt : attempt?.sequence;
    return Array.isArray(values) && values.length === 4 &&
      values.every((value, index) => value === solutions.levers[index]);
  }
  if (room === 1 || room === 'clock') {
    return Number(attempt?.value ?? attempt) === solutions.clock;
  }
  if (room === 2 || room === 'mirror') {
    return String(attempt?.value ?? attempt).trim().toUpperCase() === solutions.word;
  }
  return false;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const rooms = [
  {
    id: 'room1-lever', name: 'Lever Hall', type: 'lever',
    context: 'Pull four colored levers in order; the order is shown by colored dots on a faded poster.',
  },
  {
    id: 'room2-clock', name: 'Clock Shelf', type: 'clock',
    context: 'Set the dial to the hour shown by the cracked clock on the shelf.',
  },
  {
    id: 'room3-mirror', name: 'Mirror Door', type: 'mirror',
    context: 'Read the four-letter word written backwards on the floor using the mirror.',
  },
];

/** Builds the self-contained game page with original SVG/CSS and synthesized sound. */
export function renderGamePage({ seed = 'hintvault-demo', embedded = false } = {}) {
  seed = /^[\w.-]{1,64}$/u.test(seed) ? seed : 'hintvault-demo';
  const solutions = createSeededSolutions(seed);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lumen Locks</title><style>
:root{color-scheme:dark;--cyan:#8beeff;--ink:#07111d;--panel:#0b1b2bdc;--gold:#ffe7a0}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif;color:#f5fbff;background:radial-gradient(ellipse at 45% 35%,#172d46,#080f1a 72%);overflow:hidden}
body{display:grid;place-items:center;min-height:100vh}.frame{width:min(100vw,1920px);height:min(100vh,1080px);position:relative;padding:clamp(18px,3vw,56px);display:flex;flex-direction:column;gap:18px;background:radial-gradient(ellipse at 55% 45%,#18334c88,transparent 62%)}
.top{display:flex;align-items:center;justify-content:space-between}.brand{font-size:clamp(20px,2.1vw,38px);letter-spacing:.12em;text-transform:uppercase;color:var(--cyan);text-shadow:0 0 18px #32cfff}.meta{color:#bdd4e5;font-size:16px}.mute{border:1px solid #73dfffa0;color:#e8faff;background:#0a1e2dcc;border-radius:999px;padding:10px 16px;cursor:pointer}
.scene{flex:1;position:relative;min-height:0;border:1px solid #6bdcff70;border-radius:28px;background:linear-gradient(155deg,#13263bdb,#07111de8);box-shadow:0 0 60px #18b8ff1c,inset 0 0 50px #46cfff0e;overflow:hidden}.scene:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,#80eaff0c,transparent 40%);pointer-events:none}
.room{height:100%;display:grid;grid-template-columns:1fr 320px;align-items:center;gap:20px;padding:clamp(16px,3vw,48px)}.art{position:relative;height:100%;display:grid;place-items:center}.art svg{width:100%;height:100%;max-height:700px;filter:drop-shadow(0 0 18px #39caff45)}.side{z-index:1;background:var(--panel);border:1px solid #72ddff55;border-radius:20px;padding:24px;box-shadow:0 0 30px #24caff17}.side h1{font-size:26px;margin:0 0 8px}.side p{line-height:1.5;color:#c2d8e8;margin:0 0 20px}.controls{display:grid;gap:10px}.controls button,.controls input{font:inherit;color:#effaff;background:#102940;border:1px solid #72dcff70;border-radius:12px;padding:12px}.controls button{cursor:pointer}.controls button:hover{background:#194162}.notice{min-height:26px;color:var(--gold);margin-top:14px;font-size:14px}.steps{font-size:14px;color:#aad1e9;margin:4px 0 16px}.poster-dot{filter:drop-shadow(0 0 7px currentColor)}
.lever{cursor:pointer;transform-origin:50% 90%;transition:transform .14s}.lever:active{transform:rotate(-15deg)}.wrong{animation:shake .28s linear 2}@keyframes shake{25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}.glow{animation:glow 2.8s ease-in-out infinite alternate}@keyframes glow{to{filter:drop-shadow(0 0 24px #67eaff)}}
.footer{display:flex;justify-content:space-between;color:#a7c4d8;font-size:13px}.door-open{animation:door 1s ease-out forwards}@keyframes door{to{transform:translateX(100%);opacity:.1}}
${embedded ? '.frame{width:100%;height:100vh;padding:18px}.room{grid-template-columns:1fr 290px}.brand{font-size:24px}' : ''}
@media(max-width:850px){.room{grid-template-columns:1fr;grid-template-rows:1fr auto}.side{padding:14px}.side h1{font-size:20px}.art svg{max-height:48vh}.meta{display:none}}
</style></head><body><main class="frame"><header class="top"><div><div class="brand">Lumen Locks</div><div class="meta">Three rooms · one glowing way out</div></div><button class="mute" id="mute" aria-pressed="false">Sound: on</button></header><section class="scene" id="scene"></section><footer class="footer"><span>Mouse and keyboard controls</span><span id="seed-label"></span></footer></main>
<script>
const SEED=${JSON.stringify(seed)}, SOLUTIONS=${JSON.stringify(solutions)}, ROOMS=${JSON.stringify(rooms)};
let roomIndex=0, sequence=[], dial=3, audio=null, muted=false, socket;
const scene=document.querySelector('#scene'), noticeText='';
document.querySelector('#seed-label').textContent='Seed: '+SEED;
function send(event){if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(event));}
function enterRoom(){sequence=[];dial=3;drawRoom();send({type:'puzzle',...ROOMS[roomIndex]});}
function drawRoom(){const room=ROOMS[roomIndex];let art='',controls='';
 if(room.type==='lever'){art=leverArt();controls='<div class="steps" id="steps">Levers pulled: 0 / 4</div><div class="controls">'+['red','blue','green','yellow'].map(color=>'<button data-lever="'+color+'">Pull '+color+'</button>').join('')+'</div>';}
 if(room.type==='clock'){art=clockArt();controls='<div class="steps">The cracked clock is the clue</div><div class="controls"><button id="minus">−</button><div id="dial-value" style="text-align:center;font-size:32px">'+dial+'</div><button id="plus">+</button><button id="submit">Set dial</button></div>';}
 if(room.type==='mirror'){art=mirrorArt();controls='<div class="steps">The floor writing is backwards</div><div class="controls"><input id="word" maxlength="4" autocomplete="off" aria-label="Door word"><button id="submit">Unlock door</button></div>';}
 scene.innerHTML='<div class="room"><div class="art">'+art+'</div><aside class="side"><h1>'+room.name+'</h1><p>'+roomDescription(roomIndex)+'</p>'+controls+'<div class="notice" id="notice" aria-live="polite"></div></aside></div>';
 if(room.type==='lever')scene.querySelectorAll('[data-lever]').forEach(b=>b.onclick=()=>tryLever(b.dataset.lever));
 if(room.type==='clock'){document.querySelector('#minus').onclick=()=>setDial(-1);document.querySelector('#plus').onclick=()=>setDial(1);document.querySelector('#submit').onclick=()=>attempt({value:dial});}
 if(room.type==='mirror'){const input=document.querySelector('#word');input.onkeydown=e=>{if(e.key==='Enter')attempt({value:input.value});};document.querySelector('#submit').onclick=()=>attempt({value:input.value});}
}
function roomDescription(index){return ['A faded poster hangs above four colored levers. Pull them in the right order.','Three clocks sit on the shelf. One glass face is cracked. Set the nearby dial.','A word is etched backwards into the floor. The mirror may help you read it.'][index];}
function leverArt(){return '<svg viewBox="0 0 800 600" role="img" aria-label="Four colored levers and a poster showing four color dots"><rect x="95" y="55" width="610" height="490" rx="26" fill="#10233a" stroke="#73dfff" stroke-width="4"/><rect x="220" y="82" width="360" height="140" rx="14" fill="#27384b" stroke="#cbd9df" stroke-width="4"/><text x="400" y="116" text-anchor="middle" fill="#e7f5fb" font-size="20">FADED POSTER</text>'+SOLUTIONS.levers.map((c,i)=>'<circle class="poster-dot" cx="'+(322+i*52)+'" cy="166" r="17" fill="'+c+'"/>').join('')+['red','blue','green','yellow'].map((c,i)=>'<g class="lever" data-art="'+c+'"><rect x="'+(180+i*145)+'" y="420" width="72" height="45" rx="10" fill="#243a51" stroke="#a8eafa" stroke-width="3"/><path d="M'+(216+i*145)+' 425L'+(216+i*145)+' 332" stroke="'+c+'" stroke-width="18" stroke-linecap="round"/><circle cx="'+(216+i*145)+'" cy="326" r="27" fill="'+c+'" stroke="#fff" stroke-width="4"/></g>').join('')+'</svg>';}
function clockArt(){const angle=SOLUTIONS.clock*30;return '<svg viewBox="0 0 800 600" role="img" aria-label="Three clocks, one with a cracked face, and a dial"><rect x="90" y="80" width="620" height="430" rx="24" fill="#10243a" stroke="#75dfff" stroke-width="4"/><path d="M145 400h510M180 404v38m440-38v38" stroke="#9cd9ec" stroke-width="12"/><g fill="#102031" stroke="#8ee8ff" stroke-width="5"><circle cx="270" cy="260" r="83"/><circle cx="400" cy="260" r="83"/><circle cx="530" cy="260" r="83"/></g><path d="M270 260l-3-46m0 46 28 17M400 260v-53m0 53-30 18" stroke="#f4f8ff" stroke-width="8" stroke-linecap="round"/><path d="M530 260v-57" transform="rotate('+angle+' 530 260)" stroke="#ffe7a0" stroke-width="10" stroke-linecap="round"/><path d="M530 260h35" stroke="#f4f8ff" stroke-width="5" stroke-linecap="round"/><path d="M530 178l-12 35 23 18-20 29 25 22" stroke="#eaf9ff" stroke-width="5" fill="none"/><text x="530" y="150" text-anchor="middle" fill="#ffe7a0" font-size="18">CRACKED</text><circle cx="400" cy="485" r="45" fill="#153852" stroke="#83e7ff" stroke-width="5"/><path d="M400 485v-31m0 31 24 16" stroke="#fff" stroke-width="5"/></svg>';}
function mirrorArt(){return '<svg viewBox="0 0 800 600" role="img" aria-label="A glowing mirror above backwards writing on the floor"><rect x="110" y="65" width="580" height="470" rx="28" fill="#11243a" stroke="#76e3ff" stroke-width="4"/><path d="M400 102c-95 0-160 74-160 165s65 155 160 155 160-64 160-155-65-165-160-165z" fill="#397b97" stroke="#b7f5ff" stroke-width="9" class="glow"/><path d="M300 255q90-105 190 0" fill="none" stroke="#e0fbff" stroke-width="12" opacity=".7"/><path d="M200 475h400" stroke="#8de9ff" stroke-width="4"/><text x="400" y="510" text-anchor="middle" fill="#ffe7a0" font-family="monospace" font-size="42" transform="translate(800 0) scale(-1 1)">'+SOLUTIONS.word+'</text></svg>';}
function audioContext(){if(!audio)audio=new AudioContext();return audio;}
function tone(freq,duration,type='sine',gain=.06){if(muted)return;const ctx=audioContext(),osc=ctx.createOscillator(),vol=ctx.createGain();osc.type=type;osc.frequency.value=freq;vol.gain.setValueAtTime(gain,ctx.currentTime);vol.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+duration);osc.connect(vol).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+duration);}
function sound(name){if(name==='clunk')tone(130,.12,'triangle');if(name==='bonk')tone(95,.2,'square');if(name==='chime'){tone(660,.35);setTimeout(()=>tone(880,.42),100);}if(name==='rumble'){tone(70,.7,'sawtooth',.035);setTimeout(()=>tone(110,.5,'sine'),200);}}
function showNotice(text){const el=document.querySelector('#notice');if(el)el.textContent=text;}
function tryLever(color){sound('clunk');sequence.push(color);document.querySelector('#steps').textContent='Levers pulled: '+sequence.length+' / 4';if(sequence.length===4)attempt({sequence:[...sequence]});}
function setDial(delta){dial=((dial-1+delta+12)%12)+1;document.querySelector('#dial-value').textContent=dial;}
function attempt(value){const room=ROOMS[roomIndex],correct=check(room.type,value);send({type:'attempt',id:room.id,correct});if(!correct){sound('bonk');scene.classList.remove('wrong');void scene.offsetWidth;scene.classList.add('wrong');showNotice('A soft clunk. Try another idea.');if(room.type==='lever'){sequence=[];document.querySelector('#steps').textContent='Levers pulled: 0 / 4';}return;}sound('chime');showNotice('Lock released.');setTimeout(advance,500);}
function check(type,value){if(type==='lever')return value.sequence.length===4&&value.sequence.every((color,i)=>color===SOLUTIONS.levers[i]);if(type==='clock')return Number(value.value)===SOLUTIONS.clock;return String(value.value).trim().toUpperCase()===SOLUTIONS.word;}
function advance(){sound('rumble');scene.classList.add('door-open');send({type:'solved',id:ROOMS[roomIndex].id});if(roomIndex===2){showNotice('All three rooms are open. Well done!');document.querySelector('.side p').textContent='The light is yours. You escaped Lumen Locks.';return;}setTimeout(()=>{roomIndex++;enterRoom();},700);}
document.querySelector('#mute').onclick=()=>{muted=!muted;document.querySelector('#mute').textContent='Sound: '+(muted?'off':'on');document.querySelector('#mute').setAttribute('aria-pressed',String(muted));};
window.addEventListener('keydown',event=>{if(event.key==='Escape')document.activeElement.blur();if(event.target instanceof HTMLInputElement)return;const room=ROOMS[roomIndex];if(room.type==='lever'&&/^[1-4]$/.test(event.key)){event.preventDefault();tryLever(['red','blue','green','yellow'][Number(event.key)-1]);}if(room.type==='clock'&&event.key==='ArrowUp'){event.preventDefault();setDial(1);}if(room.type==='clock'&&event.key==='ArrowDown'){event.preventDefault();setDial(-1);}if(room.type==='clock'&&event.key==='Enter')attempt({value:dial});if(room.type==='mirror'&&event.key==='Enter'){const input=document.querySelector('#word');if(input)attempt({value:input.value});}});
socket=new WebSocket('ws://'+location.host+'/ws');socket.addEventListener('open',enterRoom);
</script></body></html>`;
}
