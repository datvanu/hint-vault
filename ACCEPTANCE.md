# SPEC §13 Acceptance Review

This review covers the offline build only. Live Twitch and OpenAI behavior is not enabled and is not claimed as verified.

| Criterion | Status | Evidence | Notes |
|---|---|---|---|
| 1. A Twitch `!hint` appears quickly while sealed | PENDING live Twitch | `test/core.test.js` — `filtered hints never enter the overlay state`; `test/ws.test.js` — real local WebSocket test | Local command and overlay state are implemented. Twitch chat ingest and the ≤3 s live-channel check remain unverified. |
| 2. Five paraphrases form one group ranked by distinct viewers | PASS offline | `test/core.test.js` — `five differently worded lever hints form one five-viewer group` | Includes the red lever / red switch acceptance paraphrase. |
| 3. Gentle-first release and level 3 double confirmation | PASS offline | `test/core.test.js` — `release ordering is gentle first and rank descending`; `level three requires a second !more within ten seconds`; `test/security.test.js` — game event shape | Verified against in-memory state and the documented WebSocket payload shape. |
| 4. Toxic text, links, and story spoilers never appear | PASS offline | `test/core.test.js` — `filter rules reject toxic words, links, story spoilers and spam`; `filtered hints never enter the overlay state` | Store rejects these before group or overlay state creation. |
| 5. `!forgetme` deletes hints and credits immediately | PASS offline | `test/core.test.js` — `forgetme removes hints, memberships and board entries` | Deletion and group rebuild are synchronous. |
| 6. Stream end, reset, process shutdown, and inactivity purge data | PASS offline | `test/core.test.js` — `stream.offline event purges session hints and helpers`, `inactivity purger expires old sessions and app close clears its timers`; `src/server.js` shutdown; `src/purger.js` | Also exercises `!vaultreset`. No persistent data directory is used. |
| 7. Outgoing chat is limited to one message per two seconds | PASS offline | `test/core.test.js` — `outgoing limiter caps a 200-message burst at one per two seconds` | Covers a compressed burst through the limiter. |
| 8. A one-cent cap engages fallback and reports paused AI | PASS offline | `test/core.test.js` — `CostGuard engages heuristic mode at a one-cent stream cap`; `public/overlay.js` | Cost brake state reaches the overlay label; OpenAI calls are disabled. |
| 9. Mock demo is deterministic and works offline | PASS offline | `test/core.test.js` — `demo timeline completes and filters content end to end`; `demo/script.json`; `src/aiProvider.js` | The demo uses only invented viewers and built-in modules. |
| 10. EventSub reconnect preserves subscriptions and backs off | PENDING live Twitch | No EventSub client exists in this offline build. | Requires Twitch EventSub implementation and Twitch/mock-server integration. |
| 11. No secrets in history; `.env` ignored | PARTIAL | `test/security.test.js` — `.env is ignored by git`; `test/security.test.js` — `Twitch and OpenAI adapters are offline-only stubs`; `.gitignore` | No credentials are included in the working files. Full repository history review is left to the operator. |
| 12. README has setup, OBS, demo, privacy, and Codex-use notes | PASS offline | `README.md` | Contains local setup, Browser Source guidance, adapter seams, privacy note, and build-process note. |

## Security and privacy self-check

- Overlay and stage hint text uses DOM text nodes; admin state uses `textContent`. No chat text is inserted as HTML.
- The app has no filesystem write path for hints. It reads static assets and preview fixtures only.
- `.env` is listed in `.gitignore`; `.env.example` contains empty placeholders.
- Twitch and OpenAI adapter methods throw `not enabled in offline build`; they make no network calls.
