# Hint Vault

Hint Vault turns viewer tips into a sealed, gradually revealed vault. The offline demo includes **Lumen Locks**, an original three-room browser puzzle game. The build uses Node.js built-ins only and does not connect to Twitch or OpenAI.

## Run

Requires Node.js 20 or later.

```sh
npm test
npm run demo
```

The full demo timeline takes about three minutes at speed 1. For a faster run, use `npm run demo -- --speed 10`. To stop the simulator before its first `!solved` event while leaving the server running, use `npm run demo -- --hold`.

The server prints these local URLs when it starts:

- `http://localhost:3000/stage` — 1920×1080 recording view, game at left and Hint Vault at right.
- `http://localhost:3000/game` — standalone game; `?seed=your-seed` selects a repeatable puzzle set.
- `http://localhost:3000/overlay` — transparent OBS Browser Source.
- `http://localhost:3000/admin` — controls, state, groups, and cost meter.

For OBS, add a **Browser Source** with URL `http://localhost:3000/overlay`, width `1920`, and height `1080`. Use `/stage` in a browser or capture it as the combined demo view.

Overlay screenshot previews use fixture data: `/overlay?preview=sealed`, `/overlay?preview=opening`, `/overlay?preview=open`, and `/overlay?preview=solved`. Each preview is visibly marked. `npm start` runs the server without the simulator.

## Configuration

Copy `.env.example` to `.env` and fill in values only when preparing a future connected build. This offline version does not load or use Twitch/OpenAI credentials. To make environment values available to Node in a shell:

```sh
set -a
. ./.env
set +a
npm start
```

The expected variables are `PORT`, `AI_PROVIDER`, `MAX_USD_PER_STREAM`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (optional for a public client), `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_ID`, `TWITCH_USER_ID`, and `OPENAI_API_KEY`. Keep `.env` private; it is ignored by Git.

## Architecture and adapter seams

`src/commandRouter.js` routes commands and local game events. `vaultStore.js`, `clusterer.js`, `rater.js`, `rateLimiter.js`, `costGuard.js`, and `spoilerFilter.js` implement the in-memory pipeline. `src/server.js` serves static pages from `public/`, the seeded game route, preview fixtures, and a small RFC 6455 WebSocket server. `demo/script.json` drives invented viewers through all three puzzle contexts. Graphics are original inline SVG/CSS; sound is synthesized with Web Audio.

The future Twitch EventSub chat source should implement:

```js
connect(): Promise<void>
onMessage(callback: (message: ChatMsg) => void): void
onStreamOffline(callback: () => void): void
onStreamOnline(callback: () => void): void
send(text: string): Promise<void>
close(): Promise<void>
```

The future AI provider should implement:

```js
moderate(texts: string[]): Promise<boolean[]> // flagged for each input
embed(texts: string[]): Promise<Float32Array[]>
rate(context: string, hint: string): Promise<Rating> // level, flags, gentle rewrite
```

The Twitch adapter will use the `TWITCH_CLIENT_ID`, optional `TWITCH_CLIENT_SECRET`, `TWITCH_ACCESS_TOKEN`, `TWITCH_BROADCASTER_ID`, and `TWITCH_USER_ID` values. The OpenAI adapter will use `OPENAI_API_KEY`; it must send `store: false` for Responses API requests. `AI_PROVIDER` selects the adapter and `MAX_USD_PER_STREAM` sets the cost cap. The current `TwitchAdapter` and `OpenAIAdapter` are offline-only stubs that throw `not enabled in offline build`.

## Privacy and security

Hint data lives in memory only. `!forgetme`, `!vaultreset`, stream-offline events, shutdown, or 12 hours without activity purge data. No chat text is logged or written to disk. The offline build sends no hint text to any processor. A future connected build must tell viewers that AI services process hints, use `store: false`, and explain that provider abuse-monitoring logs may be retained up to 30 days.

Overlay and stage text is rendered with text nodes; admin state uses `textContent`. `.env` is Git-ignored and `.env.example` contains empty placeholders. Adapters contain no network calls. All graphics and audio are original and created in code.

## Acceptance status

The offline acceptance review is in [ACCEPTANCE.md](ACCEPTANCE.md): **9 PASS offline, 1 PARTIAL, 2 PENDING live Twitch/OpenAI integration**. Live Twitch ingest and EventSub reconnect behavior remain unimplemented and unverified.

Codex was used in this single build thread to implement the app, game, adapter stubs, and offline tests. The operator runs live integrations and commits each build step.
