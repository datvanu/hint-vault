# Hint Vault

Hint Vault turns viewer tips into a sealed, gradually revealed vault. The demo has an offline mock provider and no connection to Twitch or OpenAI.

## Run

Requires Node.js 20 or later.

```sh
npm run demo -- --speed 10
```

Open `http://localhost:3000/overlay` as a transparent 1920×1080 OBS Browser Source, or use `http://localhost:3000/admin` for controls and state. `npm start` starts the server without the simulator. `npm test` runs the built-in Node test suite.

## Architecture

`src/commandRouter.js` parses commands and role badges. `vaultStore.js`, `clusterer.js`, `rater.js`, `rateLimiter.js`, `costGuard.js`, and `spoilerFilter.js` implement the in-memory offline pipeline. `server.js` serves the overlay and admin pages and implements a small RFC 6455 WebSocket endpoint on Node's HTTP upgrade. `demo/script.json` drives invented viewers through the same command path. `MockAIProvider` is deterministic; `TwitchAdapter` and `OpenAIAdapter` are interface stubs that throw `not enabled in offline build`.

## Privacy

No hint text is logged or written to disk. Data is held in memory, `!forgetme` removes a viewer's hints and credits, and reset, simulated stream end, process exit, or 12 hours of inactivity purges session state. This offline build does not send data to a processor. In a future connected build, hint text would be processed by an AI service; disclose that to viewers, use `store: false`, and explain that service abuse-monitoring logs may be retained up to 30 days.

All graphics are original CSS/SVG/code. **Offline build — Twitch/OpenAI adapters not yet enabled.**
