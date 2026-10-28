import { readFile } from 'node:fs/promises';

/** Plays timestamped demo events; `at` values in script.json are seconds. */
export async function runSimulator(router, { speed = 1, hold = false, signal, onEvent = () => {} } = {}) {
  const events = JSON.parse(await readFile(new URL('./script.json', import.meta.url), 'utf8'));
  let previousAt = 0;
  let played = 0;

  for (const event of events) {
    if (signal?.aborted) return { played, aborted: true };
    if (hold && event.text === '!solved') return { played, heldBeforeSolved: true };
    await delay(Math.max(0, event.at - previousAt) * 1000 / Math.max(0.1, speed), signal);
    if (signal?.aborted) return { played, aborted: true };

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
    previousAt = event.at;
    played++;
  }
  return { played, heldBeforeSolved: false };
}

/** Sleeps until the event time, but returns promptly when shutdown aborts. */
function delay(milliseconds, signal) {
  if (!signal) return new Promise(resolve => setTimeout(resolve, milliseconds));
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
