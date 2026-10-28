import { readFile } from 'node:fs/promises';

/** Plays the scripted demo chat timeline against the real command router. */
export async function runSimulator(router, { speed = 1, onEvent = () => {} } = {}) {
  const events = JSON.parse(await readFile(new URL('./script.json', import.meta.url), 'utf8'));
  const startedAt = Date.now();
  await Promise.all(events.map(event => new Promise(resolve => {
    setTimeout(() => {
      if (event.event === 'stream.offline') {
        router.streamOffline();
      } else {
        router.handle({
          text: event.text,
          userId: event.user,
          userLogin: event.user,
          displayName: event.name,
          badges: event.role ? [{ set_id: event.role }] : [],
        });
      }
      onEvent(event);
      resolve();
    }, event.at / Math.max(0.1, speed));
  })));
  return { elapsedMs: Date.now() - startedAt };
}
