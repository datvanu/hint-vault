const stateOutput = document.querySelector('#state');
const meter = document.querySelector('#meter');
const socket = new WebSocket(`ws://${location.host}/ws`);

async function refresh() {
  const response = await fetch('/admin-state');
  const state = await response.json();
  meter.textContent = `${state.counts.hints} hints · ${state.counts.groups} groups · $${state.costMeter.usdSpent.toFixed(4)} / $${state.costMeter.usdCap.toFixed(2)}${state.costMeter.aiPaused ? ' · AI paused' : ''}`;
  stateOutput.textContent = JSON.stringify(state, null, 2);
}

socket.addEventListener('message', refresh);

for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => {
    fetch('/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: button.dataset.command }),
    });
  });
}

document.querySelector('#purge').addEventListener('click', () => fetch('/purge', { method: 'POST' }));
