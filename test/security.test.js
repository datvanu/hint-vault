import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { OpenAIAdapter, TwitchAdapter } from '../src/aiProvider.js';

const root = new URL('../', import.meta.url);

test('overlay, stage, and admin render dynamic viewer text as text nodes', async () => {
  const assets = ['public/overlay.js', 'public/stage.js', 'public/admin.js'];
  for (const asset of assets) {
    const source = await readFile(new URL(asset, root), 'utf8');
    assert.match(source, /textContent|createTextNode/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/);
  }
});

test('application source contains no file-writing path for hint content', async () => {
  const sourceFiles = await readdir(new URL('../src/', import.meta.url));
  for (const file of sourceFiles.filter(name => name.endsWith('.js') && name !== 'twitchAuth.js')) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:writeFile|appendFile|createWriteStream)\s*\(/);
  }
  const authSource = await readFile(new URL('../src/twitchAuth.js', import.meta.url), 'utf8');
  assert.match(authSource, /writeTokenAtomically\(token\)/);
  assert.match(authSource, /open\(temporary, 'wx', 0o600\)/);
  assert.doesNotMatch(authSource, /hint\.text|message\.text|displayName/u);
});

test('.env is ignored by git', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(ignore.split(/\r?\n/).includes('.env'));
});

test('offline TwitchAdapter and OpenAI provider stubs remain inert', async () => {
  const twitch = new TwitchAdapter();
  const openai = new OpenAIAdapter();
  await assert.rejects(twitch.connect(), /not enabled in offline build/);
  await assert.rejects(twitch.send('test'), /not enabled in offline build/);
  await assert.rejects(openai.moderate(['test']), /not enabled in offline build/);
  await assert.rejects(openai.embed(['test']), /not enabled in offline build/);
  await assert.rejects(openai.rate('context', 'hint'), /not enabled in offline build/);
  const source = await readFile(new URL('../src/aiProvider.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|node:https|node:http/);
});

test('preview fixture data covers all overlay modes and is clearly labelable', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../demo/overlay-previews.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(fixtures).sort(), ['open', 'opening', 'sealed', 'solved']);
  for (const [mode, state] of Object.entries(fixtures)) assert.equal(state.mode, mode);
  const script = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
  assert.match(script, /PREVIEW/);
  assert.match(script, /AI paused/);
});

test('game emits the documented puzzle event without overwriting its event type', async () => {
  const source = await readFile(new URL('../public/game.js', import.meta.url), 'utf8');
  assert.match(source, /type: 'puzzle', id: room\.id, name: room\.name, context: room\.context/);
  assert.match(source, /type: 'attempt', id: room\.id, correct/);
  assert.match(source, /type: 'solved', id: settings\.rooms\[roomIndex\]\.id/);
  assert.match(source, /function followVaultState\(state\)/);
  assert.match(source, /if \(embeddedMode\) followVaultState/);
  assert.match(source, /state\.mode === 'solved'/);
});

test('overlay has a state fallback and a wrapping corner widget', async () => {
  const script = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/overlay.css', import.meta.url), 'utf8');
  assert.match(script, /fetch\('\/state'\)/);
  assert.match(script, /socketSnapshotReceived/);
  assert.match(css, /max-width: min\(740px/);
  assert.match(css, /white-space: normal/);
});
