const root = document.querySelector('#overlay-root');
const previewBanner = document.querySelector('#preview-banner');

/** Adds text nodes so chat and preview text cannot become markup. */
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function render(state) {
  root.replaceChildren();

  const helpers = state.helpedBoard || [];
  const widgetNames = helpers.slice(0, 3).map(helper => helper.displayName).join(', ');
  const aiStatus = state.costMeter?.aiPaused ? ' · AI paused' : '';
  root.append(element('div', 'widget', `🔒 ${state.counts.hints} hints · ${state.counts.groups} groups · ${widgetNames}${aiStatus}`));

  const vault = element('div', `vault mode-${state.mode}`);
  const title = state.mode === 'sealed' ? '🔒 Vault sealed' :
    state.mode === 'opening' ? 'Vault opening…' :
      state.mode === 'solved' ? 'Solved!' : 'Vault open';
  vault.append(element('h1', '', title), element('div', '', state.puzzle.name));
  root.append(vault);

  const cards = element('section', 'cards');
  for (const hint of state.released || []) {
    const card = element('div', `card level-${hint.level}`);
    card.append(document.createTextNode(`${hint.text} `), element('b', '', `×${hint.rank}`));
    cards.append(card);
  }
  root.append(cards);
  root.append(element('div', 'board', `Helped ${helpers.map(helper => `${helper.displayName} ×${helper.helps}`).join(' · ')}`));
}

async function start() {
  const preview = new URLSearchParams(location.search).get('preview');
  if (preview) {
    if (!['sealed', 'opening', 'open', 'solved'].includes(preview)) {
      previewBanner.hidden = false;
      previewBanner.textContent = 'PREVIEW · UNKNOWN STATE';
      return;
    }
    const response = await fetch(`/preview-state?mode=${encodeURIComponent(preview)}`);
    const state = await response.json();
    previewBanner.hidden = false;
    previewBanner.textContent = `PREVIEW · ${preview.toUpperCase()}`;
    render(state);
    return;
  }

  const socket = new WebSocket(`ws://${location.host}/ws`);
  socket.addEventListener('message', event => render(JSON.parse(event.data)));
  render({ mode: 'sealed', puzzle: { name: 'Hint Vault' }, counts: { hints: 0, groups: 0 }, released: [], helpedBoard: [] });
}

start();
