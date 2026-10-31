import { controlDescriptions, roomDescriptions } from './game-copy.js';

let settings;
let roomIndex = 0;
let leverSequence = [];
let dialValue = 3;
let audioContext;
let muted = false;
let socket;
let embeddedMode = false;

const scene = document.querySelector('#scene');

function send(event) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function roomEvent() {
  const room = settings.rooms[roomIndex];
  send({ type: 'puzzle', id: room.id, name: room.name, context: room.context });
}

function followVaultState(state) {
  const nextRoom = settings.rooms.findIndex(room => room.id === state.puzzle?.id);
  if (nextRoom >= 0 && nextRoom !== roomIndex) {
    roomIndex = nextRoom;
    leverSequence = [];
    dialValue = 3;
    scene.classList.remove('solved');
    drawRoom();
  }
  scene.classList.toggle('solved', state.mode === 'solved');
  if (state.mode === 'solved') showNotice('Room solved. The next lock is ready.');
}

function enterRoom() {
  leverSequence = [];
  dialValue = 3;
  drawRoom();
  roomEvent();
}

function drawRoom() {
  const room = settings.rooms[roomIndex];
  let art;
  let controls;
  if (room.type === 'lever') {
    art = leverArt();
    controls = `<div class="steps" id="steps">Levers pulled: 0 / 4</div>
      <div class="controls">${['red', 'blue', 'green', 'yellow'].map(color =>
        `<button data-lever="${color}">Pull ${color}</button>`).join('')}</div>`;
  } else if (room.type === 'clock') {
    art = clockArt();
    controls = `<div class="steps">${controlDescriptions.clock}</div>
      <div class="controls"><button id="minus">−</button><div id="dial-value" class="dial-value">${dialValue}</div>
      <button id="plus">+</button><button id="submit">Set dial</button></div>`;
  } else {
    art = mirrorArt();
    controls = `<div class="steps">${controlDescriptions.mirror}</div>
      <div class="controls"><input id="word" maxlength="4" autocomplete="off" aria-label="Door word">
      <button id="submit">Unlock door</button></div>`;
  }

  scene.innerHTML = `<div class="room"><div class="art">${art}</div><aside class="side-panel">
    <h1>${room.name}</h1><p>${roomDescription(roomIndex)}</p>${controls}
    <div class="notice" id="notice" aria-live="polite"></div></aside></div>`;
  bindControls(room.type);
}

function bindControls(type) {
  if (type === 'lever') {
    scene.querySelectorAll('[data-lever]').forEach(button => {
      button.addEventListener('click', () => tryLever(button.dataset.lever));
    });
  } else if (type === 'clock') {
    document.querySelector('#minus').addEventListener('click', () => changeDial(-1));
    document.querySelector('#plus').addEventListener('click', () => changeDial(1));
    document.querySelector('#submit').addEventListener('click', () => attempt({ value: dialValue }));
  } else {
    const input = document.querySelector('#word');
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') attempt({ value: input.value });
    });
    document.querySelector('#submit').addEventListener('click', () => attempt({ value: input.value }));
  }
}

function roomDescription(index) {
  return roomDescriptions[index];
}

function leverArt() {
  const faded = { red: '#785c60', blue: '#5a7080', green: '#617568', yellow: '#827b60' };
  const dots = settings.solutions.levers.map((color, index) =>
    `<circle class="poster-dot" cx="${326 + index * 48}" cy="${157 + (index % 2) * 5}" r="12" fill="${faded[color]}"/>`).join('');
  const levers = ['red', 'blue', 'green', 'yellow'].map((color, index) => {
    const x = 216 + index * 145;
    return `<g class="lever"><rect x="${x - 36}" y="420" width="72" height="45" rx="10" fill="#243a51" stroke="#a8eafa" stroke-width="3"/>
      <path d="M${x} 425V332" stroke="${color}" stroke-width="18" stroke-linecap="round"/>
      <circle cx="${x}" cy="326" r="27" fill="${color}" stroke="#fff" stroke-width="4"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 800 600" role="img" aria-label="Four colored levers below a worn decorative wall poster">
    <rect x="95" y="55" width="610" height="490" rx="26" fill="#10233a" stroke="#73dfff" stroke-width="4"/>
    <path d="M215 92q180-26 370 0v132q-190 17-370-2z" fill="#a29d84" opacity=".12"/>
    <path d="M245 112h310M260 126q110 22 240-1M282 194q90-24 190 0M300 165h198" stroke="#d9d5c1" opacity=".15" stroke-width="4"/>
    ${dots}${levers}</svg>`;
}

function clockArt() {
  const angle = settings.solutions.clock * 30;
  return `<svg viewBox="0 0 800 600" role="img" aria-label="Three old clocks, one with a fine crack">
    <rect x="90" y="80" width="620" height="430" rx="24" fill="#10243a" stroke="#75dfff" stroke-width="4"/>
    <path d="M145 400h510M180 404v38m440-38v38" stroke="#9cd9ec" stroke-width="12"/>
    <g fill="#102031" stroke="#8ee8ff" stroke-width="5"><circle cx="270" cy="260" r="83"/><circle cx="400" cy="260" r="83"/><circle cx="530" cy="260" r="83"/></g>
    <path d="M270 260l-3-46m0 46 28 17M400 260v-53m0 53-30 18" stroke="#f4f8ff" stroke-width="8" stroke-linecap="round"/>
    <path d="M530 260v-57" transform="rotate(${angle} 530 260)" stroke="#b7c7ca" stroke-width="8" stroke-linecap="round"/>
    <path d="M530 260h35" stroke="#f4f8ff" stroke-width="5" stroke-linecap="round"/>
    <path d="M530 178l-8 28 17 19-12 22 17 23" stroke="#c5d1d0" stroke-width="3" opacity=".45" fill="none"/>
    <circle cx="400" cy="485" r="45" fill="#153852" stroke="#83e7ff" stroke-width="5"/>
    <path d="M400 485v-31m0 31 24 16" stroke="#fff" stroke-width="5"/></svg>`;
}

function mirrorArt() {
  return `<svg viewBox="0 0 800 600" role="img" aria-label="A softly lit mirror above faint floor markings">
    <rect x="110" y="65" width="580" height="470" rx="28" fill="#11243a" stroke="#76e3ff" stroke-width="4"/>
    <path d="M400 102c-95 0-160 74-160 165s65 155 160 155 160-64 160-155-65-165-160-165z" fill="#315c6c" stroke="#9abfc5" stroke-width="7" class="glow"/>
    <path d="M300 255q90-105 190 0" fill="none" stroke="#c6d8d8" stroke-width="9" opacity=".45"/>
    <path d="M200 475h400" stroke="#8de9ff" stroke-width="3" opacity=".5"/>
    <text x="400" y="510" text-anchor="middle" fill="#9bb7bc" opacity=".42" font-family="monospace" font-size="34" transform="translate(800 0) scale(-1 1)">${settings.solutions.word}</text>
  </svg>`;
}

function changeDial(delta) {
  dialValue = ((dialValue - 1 + delta + 12) % 12) + 1;
  document.querySelector('#dial-value').textContent = String(dialValue);
}

function tryLever(color) {
  playSound('clunk');
  leverSequence.push(color);
  document.querySelector('#steps').textContent = `Levers pulled: ${leverSequence.length} / 4`;
  if (leverSequence.length === 4) attempt({ sequence: [...leverSequence] });
}

function check(room, attemptValue) {
  if (room.type === 'lever') {
    return attemptValue.sequence.length === 4 && attemptValue.sequence.every(
      (color, index) => color === settings.solutions.levers[index],
    );
  }
  if (room.type === 'clock') return Number(attemptValue.value) === settings.solutions.clock;
  return String(attemptValue.value).trim().toUpperCase() === settings.solutions.word;
}

function attempt(value) {
  const room = settings.rooms[roomIndex];
  const correct = check(room, value);
  send({ type: 'attempt', id: room.id, correct });
  if (!correct) {
    playSound('bonk');
    scene.classList.remove('wrong');
    void scene.offsetWidth;
    scene.classList.add('wrong');
    showNotice('A soft clunk. Try another idea.');
    if (room.type === 'lever') {
      leverSequence = [];
      document.querySelector('#steps').textContent = 'Levers pulled: 0 / 4';
    }
    return;
  }
  playSound('chime');
  showNotice('Lock released.');
  setTimeout(advance, 500);
}

function advance() {
  playSound('rumble');
  scene.classList.add('solved');
  send({ type: 'solved', id: settings.rooms[roomIndex].id });
  if (roomIndex === settings.rooms.length - 1) {
    showNotice('All three rooms are open. Well done!');
    document.querySelector('.side-panel p').textContent = 'The light is yours. You escaped Lumen Locks.';
    return;
  }
  setTimeout(() => { roomIndex++; enterRoom(); }, 700);
}

function showNotice(message) {
  const notice = document.querySelector('#notice');
  if (notice) notice.textContent = message;
}

function soundContext() {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

function tone(frequency, duration, type = 'sine', volume = 0.06) {
  if (muted) return;
  const context = soundContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
}

function playSound(name) {
  if (name === 'clunk') tone(130, 0.12, 'triangle');
  if (name === 'bonk') tone(95, 0.2, 'square');
  if (name === 'chime') {
    tone(660, 0.35);
    setTimeout(() => tone(880, 0.42), 100);
  }
  if (name === 'rumble') {
    tone(70, 0.7, 'sawtooth', 0.035);
    setTimeout(() => tone(110, 0.5), 200);
  }
}

document.querySelector('#mute').addEventListener('click', event => {
  muted = !muted;
  event.currentTarget.textContent = `Sound: ${muted ? 'off' : 'on'}`;
  event.currentTarget.setAttribute('aria-pressed', String(muted));
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.activeElement.blur();
  if (event.target instanceof HTMLInputElement) return;
  const room = settings?.rooms[roomIndex];
  if (!room) return;
  if (room.type === 'lever' && /^[1-4]$/.test(event.key)) {
    event.preventDefault();
    tryLever(['red', 'blue', 'green', 'yellow'][Number(event.key) - 1]);
  }
  if (room.type === 'clock' && event.key === 'ArrowUp') { event.preventDefault(); changeDial(1); }
  if (room.type === 'clock' && event.key === 'ArrowDown') { event.preventDefault(); changeDial(-1); }
  if (room.type === 'clock' && event.key === 'Enter') attempt({ value: dialValue });
  if (room.type === 'mirror' && event.key === 'Enter') {
    const input = document.querySelector('#word');
    if (input) attempt({ value: input.value });
  }
});

async function startGame() {
  embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';
  document.body.classList.toggle('embedded', embeddedMode);
  const response = await fetch(`/game-config${location.search}`);
  if (!response.ok) throw new Error('Could not load the puzzle configuration');
  settings = await response.json();
  document.querySelector('#seed-label').textContent = `Seed: ${settings.seed}`;
  enterRoom();
  socket = new WebSocket(`ws://${location.host}/ws`);
  socket.addEventListener('open', () => {
    if (!embeddedMode) roomEvent();
  });
  socket.addEventListener('message', event => {
    if (embeddedMode) followVaultState(JSON.parse(event.data));
  });
}

startGame().catch(error => {
  scene.replaceChildren(Object.assign(document.createElement('p'), { textContent: error.message }));
});
