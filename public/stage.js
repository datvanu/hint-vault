const puzzle = document.querySelector('#puzzle');
const counts = document.querySelector('#counts');
const hints = document.querySelector('#hints');
const board = document.querySelector('#board');
const socket = new WebSocket(`ws://${location.host}/ws`);

import { plural, captionFor } from './labels.js';
fetch('/mode').then(r => r.json()).then(m => { document.querySelector('.caption').textContent = captionFor(m); }).catch(() => {});

function render(state) {
  puzzle.textContent = state.puzzle.name;
  counts.textContent = `🔒 ${plural(state.counts.hints, 'hint')} · ${plural(state.counts.groups, 'group')} · ${plural(state.counts.viewers, 'viewer')}`;
  hints.replaceChildren();
  if (!state.released?.length) {
    hints.textContent = 'Vault sealed. Chat hints stay hidden until the player gets stuck.';
  } else {
    for (const hint of state.released) {
      const card = document.createElement('div');
      card.className = 'hint';
      card.append(document.createTextNode(`${hint.text} `));
      const rank = document.createElement('b');
      rank.textContent = `×${hint.rank}`;
      card.append(rank);
      hints.append(card);
    }
  }
  board.textContent = `Helped: ${(state.helpedBoard || []).map(helper => `${helper.displayName} ×${helper.helps}`).join(' · ')}`;
}

socket.addEventListener('message', event => render(JSON.parse(event.data)));
