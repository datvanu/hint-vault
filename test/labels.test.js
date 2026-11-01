import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plural, captionFor } from '../public/labels.js';
import { createApp } from '../src/server.js';

test('plural labels use singular for one', () => {
  assert.equal(plural(1, 'viewer'), '1 viewer');
  assert.equal(plural(0, 'hint'), '0 hints');
  assert.equal(plural(2, 'group'), '2 groups');
});

test('caption reflects live / sim mode', () => {
  assert.equal(captionFor({ live: false }), 'Simulated viewers · offline demo');
  assert.equal(captionFor({ live: true }), 'Live Twitch chat');
  assert.match(captionFor({ live: true, sim: true }), /Live Twitch chat \+ simulated viewers/);
});

test('pages build count labels through plural()', () => {
  for (const file of ['stage.js', 'overlay.js', 'admin.js']) {
    const source = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.match(source, /from '\.\/labels\.js'/, file);
    assert.doesNotMatch(source, /\} (hints|groups|viewers)\b|\+ ' (hints|groups)/, file);
  }
});

test('/mode reports live and sim flags', async () => {
  const app = createApp({ live: false });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const mode = await (await fetch(`http://127.0.0.1:${port}/mode`)).json();
  assert.deepEqual(mode, { live: false, sim: false });
  await app.close();
});

test('!vault reply uses singular/plural', () => {
  const source = readFileSync(new URL('../src/commandRouter.js', import.meta.url), 'utf8');
  assert.match(source, /viewer\$\{.*=== 1 \? '' : 's'\}/);
});
