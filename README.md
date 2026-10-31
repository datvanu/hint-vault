# Hint Vault

Hint Vault turns viewer tips into a sealed, gradually revealed vault. The offline demo includes **Lumen Locks**, an original three-room browser puzzle game. It uses Node.js built-ins only. Twitch connects only when explicitly started with `--live`; OpenAI remains disabled.

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

## Twitch live mode

The default `npm start` and `npm run demo` modes remain offline. Live mode uses Twitch EventSub and Helix through Node's built-in `fetch` and `WebSocket`:

```sh
HINTVAULT_TWITCH_TOKEN_FILE=/absolute/path/to/twitch-token.json \
TWITCH_CLIENT_ID=your-public-client-id \
node src/server.js --live
```

The token JSON file contains `access_token`, `refresh_token`, `expires_in`, `scope`, and `token_type`. Keep it outside the repository; refreshes are written atomically with mode `0600`. Token values and the client ID are never logged. `npm run live-check` validates the token, connects EventSub, creates and lists subscriptions, deletes those it created, and never sends chat.

Required live variables are `HINTVAULT_TWITCH_TOKEN_FILE` and `TWITCH_CLIENT_ID`. `HINTVAULT_ALLOW_SEND=1` enables status replies; sending is dry-run by default and logs `would send: [Hint Vault] ...`. `--dry-run-send` forces dry-run. `HINTVAULT_OWN_MESSAGES=demo-tag-only` (default) processes own-account messages only when tagged `[Hint Vault demo]`; `all-except-status` permits other own messages. `HINTVAULT_DELETE_HINT_MESSAGES=1` enables optional deletion of `!hint` messages. `TWITCH_ID_BASE`, `TWITCH_HELIX_BASE`, and `TWITCH_EVENTSUB_WS` support local fake endpoints. Runtime settings also include `PORT`, `AI_PROVIDER`, and `MAX_USD_PER_STREAM`. The future OpenAI provider uses `OPENAI_API_KEY`; it remains a stub.

## Architecture and adapter seams

`src/commandRouter.js` routes commands and local game events. Puzzle ids are canonical across chat and game events; repeated same-id puzzle events preserve current hints. The embedded stage game follows server puzzle snapshots, so the simulator can advance rooms without manual play. `vaultStore.js`, `clusterer.js`, `rater.js`, `rateLimiter.js`, `costGuard.js`, and `spoilerFilter.js` implement the in-memory pipeline. `src/server.js` serves static pages from `public/`, the seeded game config route, preview fixtures, and a small RFC 6455 WebSocket server. `demo/script.json` drives invented viewers through all three puzzle contexts. Graphics are original inline SVG/CSS; sound is synthesized with Web Audio.

The Twitch EventSub adapter's methods are:

```js
connect(): Promise<{ sessionId: string, subscription: object }>
send(text: string): Promise<object>
stop(): Promise<void>
```

Its constructor accepts `onMessage(ChatMsg)`, `onStreamOffline()`, and `onStreamOnline()` callbacks. `TwitchAuth` exposes `validate()`, `refresh()`, and authenticated `helix(path, options)`. It requires the token-file path and client ID above.

The future AI provider should implement:

```js
moderate(texts: string[]): Promise<boolean[]> // flagged for each input
embed(texts: string[]): Promise<Float32Array[]>
rate(context: string, hint: string): Promise<Rating> // level, flags, gentle rewrite
```

The OpenAI provider seam is `moderate(texts)`, `embed(texts)`, and `rate(context, hint)`, using `OPENAI_API_KEY` when implemented. `AI_PROVIDER` selects the provider and `MAX_USD_PER_STREAM` sets the cost cap. The `OpenAIAdapter` remains an offline-only stub that throws `not enabled in offline build`.

## Privacy and security

Hint data lives in memory only. `!forgetme`, `!vaultreset`, stream-offline events, shutdown, or 12 hours without activity purge data. No chat text is logged or written to disk. The offline build sends no hint text to any processor. A future connected build must tell viewers that AI services process hints, use `store: false`, and explain that provider abuse-monitoring logs may be retained up to 30 days.

Overlay and stage text is rendered with text nodes; admin state uses `textContent`. `.env` is Git-ignored and `.env.example` contains no credentials. Hint content is never written to disk; only token refresh writes the configured OAuth token file. Offline modes make no Twitch calls; the Twitch adapter makes requests only in explicit live mode. The OpenAI adapter makes no network calls. All graphics and audio are original and created in code.

## Acceptance status

The acceptance review is in [ACCEPTANCE.md](ACCEPTANCE.md): **10 PASS offline, 1 PARTIAL, 1 PENDING live Twitch**. Run `npm test` for offline and local-fake tests. Fakes cover token refresh, EventSub subscription payloads and reconnect, message filtering, and dry-run sending; real Twitch authorization and delivery still need operator verification.

Codex was used in this single build thread to implement the app, game, adapter stubs, and offline tests. The operator runs live integrations and commits each build step.
