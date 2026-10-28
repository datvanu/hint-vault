# Hint Vault — Build Spec (prompt basis for Codex)

> Project owner: Kilian Schieri · Hackathon: Codex x TwitchCon (https://twitchcon-codex.devpost.com/) · Spec version 1.0, 2026-10-28
> **This document is the input for ONE Codex thread.** Codex runs on the team box, logged in with Kilian's own ChatGPT account. **The team drives this thread on the box and reads the session ID (`/status`) itself.** Build everything (bot, overlay, demo mode, mini game) in that thread.
> All Twitch/OpenAI facts below were retrieved on **2026-10-28**; each fact has a source URL. Pseudocode and interfaces only. Codex writes the real code.

---

## 1. One-liner

Backseat gamers become a feature. Viewers drop tips with `!hint <text>` into a **sealed vault** instead of spoiling chat. When the streamer types `!stuck`, the vault opens. Hints arrive **gentlest first** (nudge → clue → solution), de-duplicated and ranked by how many viewers suggested the same thing. A **"Helped" board** credits the viewers whose hint actually got the streamer unstuck.

## 2. Goals / non-goals

**Goals (MVP, must ship by 2026-11-02):**
1. Read chat live via EventSub `channel.chat.message` over WebSocket.
2. Commands: `!hint`, `!stuck`, `!more`, `!solved [@user]`, `!forgetme`, `!vault`, plus streamer/mod-only `!vaultreset`.
3. Semantic grouping with embeddings. Group size becomes the rank ("12 people think…").
4. AI rating of each hint on a 0–3 scale from nudge to solution. Release order goes from vague to explicit.
5. Spoiler and abuse filter.
6. Vault overlay as an OBS Browser Source, updated over a local WebSocket.
7. "Helped" board.
8. Stream-scoped data retention: auto-purge at stream end, plus `!forgetme`.
9. **Demo mode** with simulated chat. It works without Twitch, and without OpenAI using the mock provider.
10. Rate limits plus a hard cost brake.

**Non-goals:**
- No Twitch Extension, because review takes days.
- No Channel Points, Bits or Predictions (these need Affiliate/Partner).
- No database server.
- No user accounts.
- No hosting. Everything runs locally on the streamer's PC.

## 3. Twitch integration (verified 2026-10-28)

### 3.1 Transport: EventSub WebSocket
- Endpoint: `wss://eventsub.wss.twitch.tv/ws`. Optional `?keepalive_timeout_seconds=10..600`.
- After `session_welcome` you **must subscribe within 10 s**, otherwise the connection closes with code 4003.
- `session_reconnect`: connect to the given `reconnect_url` and keep the old socket open until the new welcome arrives. You have 30 s, otherwise close code 4004.
- Close code 4002 means a ping/pong failure. Reconnect with backoff.
- Keepalive: if no message arrives within `keepalive_timeout_seconds`, treat the socket as dead and reconnect.
- WebSocket subscriptions **require a user access token**. App access tokens fail.
- Limits per user token:
  - At most 3 WebSocket connections with enabled subscriptions.
  - At most 300 enabled subscriptions per connection.
  - `max_total_cost` is 10.
  - We use 1 connection with 3–4 subscriptions.
- Sources:
  - https://dev.twitch.tv/docs/eventsub/handling-websocket-events/
  - https://dev.twitch.tv/docs/eventsub/manage-subscriptions/

Subscriptions are created via `POST https://api.twitch.tv/helix/eventsub/subscriptions` with `transport: {method: "websocket", session_id}`:

| Type | Version | Condition | Auth | Purpose |
|---|---|---|---|---|
| `channel.chat.message` | 1 | `{broadcaster_user_id, user_id}` | `user:read:chat` (from the chatting user = token owner) | read `!` commands |
| `stream.offline` | 1 | `{broadcaster_user_id}` | none | **auto-purge trigger** |
| `stream.online` | 1 | `{broadcaster_user_id}` | none | start a new session |
| `channel.chat.message_delete` | 1 | `{broadcaster_user_id, user_id}` | `user:read:chat` | drop a hint if a mod deletes its message (optional) |

Sources:
- https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage
- same page, `#streamoffline`, `#streamonline`, `#channelchatmessage_delete`

The following `channel.chat.message` event fields are used:
- `chatter_user_id`, `chatter_user_login`, `chatter_user_name`
- `message_id`
- `message.text`
- `badges[]` (broadcaster/moderator detection)
- `source_broadcaster_user_id`: ignore messages from other channels in Shared Chat, so only `null` or our own channel ID count

### 3.2 Auth model (recommended: "installed bot as broadcaster")
- Kilian registers one app on dev.twitch.tv (client type **Public**, so no secret is needed for the Device Code Flow). That requires a verified email and **2FA**. He passes the Client ID, and any secret, to the team only through Grok Bot's secure input, never via chat. Source: https://dev.twitch.tv/docs/authentication/register-app/
- The bot runs locally with a **user access token of the test channel itself** (broadcaster = sender = bot). Scopes:
  - `user:read:chat` to receive chat via EventSub.
  - `user:write:chat` to answer via Send Chat Message.
  - `moderator:manage:chat_messages` (optional) to delete the visible `!hint` message so the spoiler disappears from chat. The broadcaster is allowed to moderate.
- Why: no second bot account, no `channel:bot`/`user:bot` handshake, and the bot gets the higher broadcaster chat rate limit. Chatbot verification is "temporarily paused", but unverified bots work. Source: https://dev.twitch.tv/docs/chat/authenticating/
- Token flow: OAuth **Device Code Flow** or Authorization Code with `http://localhost:3000/callback`. Tokens are stored only in a local `.env`/token file, which goes in `.gitignore` and is **never committed** (Devpost rule).
- Dev shortcut: `twitch token --user-token --scopes "user:read:chat user:write:chat moderator:manage:chat_messages"` (Twitch CLI). Source: https://dev.twitch.tv/docs/chat/authenticating/

### 3.3 Sending chat
- Endpoint: `POST https://api.twitch.tv/helix/chat/messages`. Body: `{broadcaster_id, sender_id, message}`.
- `message` can be at most 500 characters. The response carries `is_sent` and `drop_reason`, which must be checked.
- Requires a user token with `user:write:chat`.
- Source: https://dev.twitch.tv/docs/api/reference/#send-chat-message
- Chat rate limits:
  - Normal user: 20 messages per 30 s.
  - Broadcaster/mod/VIP: 100 per 30 s.
  - Non-mod: 1 message per second per channel.
  - Exceeding the limit means bot messages are ignored for 1 h.
  - Source: https://dev.twitch.tv/docs/chat/ (section "Rate Limits")
- **Our cap: at most 1 message per 2 s, and replies are batched.** Never reply to every `!hint`. Acknowledgement happens in the overlay, and in chat only as a periodic summary ("🔒 Vault: 14 hints from 9 viewers").

### 3.4 Deleting the `!hint` message (spoiler hygiene, optional)
- Endpoint: `DELETE https://api.twitch.tv/helix/moderation/chat?broadcaster_id=&moderator_id=&message_id=` with scope `moderator:manage:chat_messages`.
- Limitations: it can't delete the broadcaster's own messages or a moderator's messages, and only messages from the last 6 h.
- Source: https://dev.twitch.tv/docs/api/reference/#delete-chat-messages
- It is off by default, with config `deleteHintMessages: true|false`. The video explains that the hint "vanishes into the vault".
- Honest limitation: viewers can see the message for about 1 s before it is deleted.

## 4. Commands

| Command | Who | Effect |
|---|---|---|
| `!hint <text>` | anyone | Stores the hint in the vault, unless it is filtered. The text has 3–300 characters. Per user: at most 3 hints per puzzle and 1 every 20 s. |
| `!stuck` | broadcaster/mod (config: `stuckRoles`) | Opens the vault for the current puzzle and releases **level-0** hints (nudges) from the top groups. |
| `!more` | broadcaster/mod | Releases the next level (0→1→2→3). Level 3 (solution) needs a second `!more` within 10 s, a "Are you sure? Type !more again" safety step. |
| `!solved [@user]` | broadcaster/mod | Closes the puzzle and records helpers. With `@user`, that user gets "Helped" credit. Without it, the authors of the released group the streamer last clicked or acted on get credit, or else everyone in the released top group. Then a new puzzle starts. |
| `!puzzle <name>` | broadcaster/mod | Starts a new puzzle context (also triggered automatically by the demo game, see GAME-CONCEPT). |
| `!vault` | anyone | Bot replies once per 30 s: count of hints and groups (never their content). |
| `!forgetme` | anyone | Deletes all hints and board entries of this user **immediately**. Bot confirms with "@user your data was deleted", rate-limited. |
| `!vaultreset` | broadcaster | Wipes the whole session. |

Parsing:
- A command is a case-insensitive prefix match on the trimmed `message.text`.
- Role detection: `badges[].set_id ∈ {broadcaster, moderator}`.

## 5. Processing pipeline

```
chat event ──► CommandRouter
                 │ !hint
                 ▼
           RateLimiter (per user, global) ──drop──► (silent)
                 ▼
           CostGuard.allow()? ──no──► store as "unrated" (heuristic fallback)
                 ▼
           Moderation (omni-moderation-latest, free) ──flagged──► reject (no storage)
                 ▼
           Embedding (text-embedding-3-small, batched every 2 s)
                 ▼
           Clusterer: cosine sim vs. group centroids ≥ τ (default 0.82) → join, else new group
                 ▼
           Rater (gpt-6-luna, reasoning effort none, JSON schema)
             → level 0..3, spoiler flag, short "gentle rewrite" for level 0/1
                 ▼
           VaultStore (in-memory) ──► OverlayHub.broadcast(state)
```

### 5.1 Semantic grouping
- Embed the normalized text: lowercase, strip `!hint`, collapse emotes and URLs.
- Online clustering: each group has a centroid (mean of its vectors). Compute the cosine similarity to all centroids of the current puzzle, which is at most a few hundred groups. If it is at least τ, the hint joins that group, otherwise it starts a new group.
- **Rank = number of distinct users** in the group, not number of messages, which is anti-spam.
- The representative text is the hint closest to the centroid, or the LLM "gentle rewrite".
- τ is configurable and tuned with the demo dataset. The acceptance test is: "pull the red lever" ≈ "try the red switch".

### 5.2 Rating (nudge → solution)
Each hint is rated once, and a group's level is the **minimum** level of its members, so the gentlest phrasing wins.

| Level | Name | Example (lever puzzle) |
|---|---|---|
| 0 | Nudge | "Look at the room again, something is colorful." |
| 1 | Pointer | "The levers matter." |
| 2 | Strong clue | "The color order is on the poster." |
| 3 | Solution | "Red, blue, red, green." |

LLM call interface (Responses API, `store: false`, structured output):
```
input:  { puzzle_context: string (≤ 300 chars, from the game / streamer), hint: string }
output: { level: 0|1|2|3, is_spoiler_for_other_content: bool, off_topic: bool,
          gentle_rewrite: string (≤ 120 chars, only for level ≤ 1) }
```
- `is_spoiler_for_other_content` catches story or plot spoilers ("the boss dies at the end").
- These are dropped and never shown.

### 5.3 Spoiler and safety filter (layers)
1. **Moderation API** `omni-moderation-latest`. It is free. Flagged harmful content is rejected and never stored. Source: https://developers.openai.com/api/docs/guides/moderation.md
2. **Heuristic pre-filter**, local and free:
   - Blocks links.
   - Blocks hints with more than 50 % caps.
   - Blocks repeated characters.
   - Blocks the streamer-configurable blocklist (`spoilerWords`).
3. **LLM flags**:
   - `off_topic` and `is_spoiler_for_other_content` cause the hint to be dropped.
   - Level 3 is held behind the double `!more`.
4. Overlay text is always escaped, so no HTML injection.

### 5.4 Release order on `!stuck`
- Take the groups of the current puzzle, sorted by `(level asc, rank desc)`.
- Show the top 3 groups of the lowest available level.
- Each `!more` raises the max level by 1.
- Within a level, higher rank comes first, with the badge "×12".

## 6. Overlay (OBS Browser Source)
- A local HTTP server serves `http://localhost:3000/overlay` with a transparent background, sized 1920×1080. The team adds it as a Browser Source in OBS (or captures it) on the box.
- Live updates come over a local WebSocket at `ws://localhost:3000/ws`. The server pushes the full `OverlayState` on every change, at most 10 per second.
- Visual states:
  - `sealed`: a vault door. The counter animates, and the lock glows when a new hint arrives. Only counts are shown, never hint text.
  - `opening`: a door animation of about 1.5 s.
  - `open`: cards with level color, representative text and a "×N viewers" badge.
  - `solved`: confetti, then the "Helped" board for 8 s.
- A corner widget, always visible and small, shows: 🔒 hint count, group count, and the top-3 helpers this stream.
- Accessibility: large font, high contrast, and no flashing above 3 Hz.

`OverlayState` (interface sketch):
```ts
type OverlayState = {
  mode: 'sealed'|'opening'|'open'|'solved';
  puzzle: { id: string; name: string };
  counts: { hints: number; groups: number; viewers: number };
  released: Array<{ groupId: string; level: 0|1|2|3; text: string; rank: number }>;
  helpedBoard: Array<{ displayName: string; helps: number }>;
  costMeter?: { usdSpent: number; usdCap: number };   // shown only in demo/dev
};
```

## 7. "Helped" board
- `!solved` credits users:
  - With `@user`, that user gets +1.
  - Otherwise, all distinct authors of the **lowest-level released group that was shown last** get +1 each.
- Board = top 10 by `helps`. It is stream-scoped and shown in the overlay and on `!solved`.
- Opt-out happens via `!forgetme`.

## 8. Data model (in-memory, stream-scoped)

```ts
Session   { id, broadcasterId, startedAt, demo: boolean, costUsd: number }
Puzzle    { id, sessionId, name, context: string, state: 'collecting'|'released'|'solved',
            maxReleasedLevel: -1..3 }
Hint      { id, puzzleId, userId, userLogin, displayName, text, createdAt,
            messageId, level?: 0..3, groupId?, flags: string[], embedding?: Float32Array }
Group     { id, puzzleId, centroid: Float32Array, memberHintIds: string[],
            distinctUsers: Set<userId>, level: 0..3, repText: string }
Helper    { userId, displayName, helps: number }
```
- Persistence: none by default. The optional crash-recovery file is `./data/session.json`. It is **deleted on purge** and contains no embeddings.
- No logs of message text. Logs contain only IDs, counts and costs. Debug text logging only happens in demo mode.

## 9. GDPR / privacy
- **Purpose limitation:** hints are used only to display them during the stream.
- **Storage limitation:** data lives only for the session. **Auto-purge** happens on:
  - the `stream.offline` event,
  - `!vaultreset`,
  - process exit,
  - and as a fallback, 12 h of inactivity.
- **`!forgetme`:** immediate deletion of all hints, group memberships and board entries of that `user_id`. Affected groups get recomputed.
- **Processors:** hint text is sent to OpenAI for moderation, embeddings and rating.
  - API data is not used for training by default.
  - Abuse-monitoring logs may be retained for up to 30 days.
  - Use `store: false`.
  - Source: https://developers.openai.com/api/docs/guides/your-data.md
  - **README must disclose this.** The bot posts a pinned/periodic chat notice: "Hints are processed by an AI service, deleted at stream end, !forgetme deletes yours."
- **Demo mode** uses only invented usernames. No real viewer data is shown in the video.
- No profiling, and no storage beyond the stream.

## 10. Rate limits and cost brake
- **Per user:** 1 `!hint` per 20 s, at most 3 per puzzle, and at most 30 per session.
- **Global:** at most 2 LLM rating calls per second, using a token bucket. Excess hints are queued with a queue cap of 500, and the oldest unrated hints are dropped.
- **Embeddings** are batched every 2 s; the endpoint accepts arrays.
- **Cost brake (`CostGuard`):**
  - Before each call, estimate the cost from the token counts in `usage` times the price table in config.
  - Hard cap `MAX_USD_PER_STREAM` (default **1.00**; covers about 5,000 hints with gpt-6-luna, see MODELS-COSTS.md).
  - At 80 %, the overlay shows a warning.
  - At 100 %, all AI calls stop and the bot falls back to heuristic mode: string-similarity grouping (trigram Jaccard), level estimated by length/keywords, and only the blocklist filter.
  - Also recommend a monthly budget limit in the OpenAI project settings, set up by the team only if Kilian approves the optional $5 credit.
- Prices are not hard-coded in the logic. They come from a `pricing` block in the config with the source URL and date (see MODELS-COSTS.md).
- OpenAI model rate limits are far above our needs:
  - gpt-6-luna Build tier: 5,000 RPM.
  - text-embedding-3-small Build tier: 5,000 RPM; Free tier: 100 RPM and 2,000 RPD.
  - Sources: the model pages, see MODELS-COSTS.md.

## 11. Demo mode (critical for the video)
- `npm run demo` (or equivalent) starts the server, the overlay and the **mini game**. It needs **no Twitch connection**.
- **Chat simulator:**
  - It plays a scripted JSON timeline (`demo/script.json`) of fake viewers (`pixel_pia`, `lever_larry`, ...).
  - Hints of all 4 levels arrive, plus duplicates in different wordings, 1 story spoiler, 1 toxic message and 1 link spam. The last three show the filter.
  - Speed factor `--speed 1..10`.
- **Hybrid mode** `--live --sim`: a real Twitch connection to the test channel plus simulated hints. The simulated hints are injected locally and not posted to Twitch, so the bot's real chat output stays visible.
- **Provider switch:**
  - `AI_PROVIDER=openai|mock`.
  - `mock` uses precomputed embeddings and levels from `demo/fixtures.json`, so the demo is deterministic, works offline and costs $0.
- A **debug panel** at `http://localhost:3000/admin`, not part of the overlay, has:
  - buttons for `!stuck`, `!more` and `!solved`,
  - a live list of groups,
  - a cost meter,
  - a "purge now" button.
- The demo must also run with **real Twitch chat** for the video proof: the team types `!hint`/`!stuck` in the twitch.tv web chat of the test channel on the box. Simulated viewers are labelled "simulated viewers (demo mode)" on screen.

## 12. Architecture

```
┌────────── streamer PC (localhost) ──────────┐
│  hint-vault (Node.js + TypeScript)          │
│   ├─ TwitchClient (EventSub WS, Helix REST) │◄── wss://eventsub.wss.twitch.tv
│   ├─ ChatSimulator (demo)                   │
│   ├─ CommandRouter / RateLimiter            │
│   ├─ AIProvider (openai | mock)             │──► api.openai.com (moderation, embeddings, responses)
│   ├─ Clusterer / Rater / CostGuard          │
│   ├─ VaultStore (in-memory) + Purger        │
│   ├─ HTTP: /overlay /admin /game            │
│   └─ WS hub  ws://localhost:3000/ws         │──► OBS Browser Source (overlay)
│                                             │──► mini game page (emits puzzle events)
└─────────────────────────────────────────────┘
```
- Suggested stack: Node.js LTS with TypeScript. The overlay, admin and game are plain HTML/CSS/JS or Vite with no framework requirement.
- Allowed dependencies: `ws`, the official `openai` SDK, and a tiny HTTP server. Licenses must be MIT/Apache-compatible.
- Config: `.env` holds `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` (only if Authorization Code flow is used), `OPENAI_API_KEY`, `AI_PROVIDER` and `MAX_USD_PER_STREAM`. Commit `.env.example`, not `.env`.
- The game ↔ vault link:
  - The game sends `{type:'puzzle', id, name, context}` over WS when a room starts.
  - It also sends `{type:'solved'}` when the puzzle is solved, which triggers the automatic `!puzzle` and `!solved`.

### Module interfaces (sketch)
```ts
interface ChatSource { onMessage(cb: (m: ChatMsg) => void): void; send(text: string): Promise<void> }
interface AIProvider {
  moderate(texts: string[]): Promise<boolean[]>;          // flagged?
  embed(texts: string[]): Promise<Float32Array[]>;
  rate(ctx: string, hint: string): Promise<Rating>;
}
interface CostGuard { allow(estUsd: number): boolean; record(usage: Usage, model: string): void }
```

## 13. Acceptance criteria
1. With the test channel live or offline, a `!hint …` typed in Twitch chat appears as +1 in the overlay counter in **≤ 3 s**, and its text is not shown while sealed.
2. 5 differently worded hints with the same meaning end up in **1 group with rank = number of distinct users**. In the demo fixture, at least 90 % of the scripted pairs are grouped correctly.
3. `!stuck` shows only level-0 hints. Each `!more` reveals exactly one further level. Level 3 needs a double `!more`.
4. The toxic message, the link spam and the story spoiler from the demo script are **never** shown in the overlay.
5. `!forgetme` removes all of the user's hints and board entries within 1 s. The overlay counts update, and a confirmation is posted.
6. A `stream.offline` event, simulated with `twitch event trigger stream.offline --transport=websocket` via the Twitch CLI WebSocket mock server or the real stream end, empties all session data, and `data/` holds no hint text afterwards.
7. The bot sends at most 1 chat message per 2 s, even under a burst of 200 `!hint` in 10 s.
8. With `MAX_USD_PER_STREAM=0.01`, the cost brake engages, the overlay shows "AI paused" and the system keeps working in heuristic mode.
9. `AI_PROVIDER=mock` with the demo runs end-to-end with no network and with identical output on every run.
10. EventSub reconnect: on `session_reconnect`, the bot switches sockets without losing subscriptions. On close code 4002 or 4003, it reconnects with backoff.
11. No secrets in the git history. `.env` is in `.gitignore`, and the README has setup steps for env vars.
12. The README contains setup, the OBS setup, the demo command, the privacy note and a description of how Codex was used.

## 14. Test plan
- **Unit:**
  - command parser,
  - rate limiter,
  - clusterer (fixture vectors),
  - release ordering,
  - CostGuard math,
  - purge/forgetme,
  - heuristic fallback.
- **Integration (no network):**
  - The demo script runs through the whole pipeline with the mock provider.
  - The overlay state is checked as snapshots.
- **Twitch integration:**
  - Twitch CLI `twitch event websocket start-server` (local EventSub WS mock) plus `twitch event trigger channel.chat.message --transport=websocket` and `stream.offline`. Source: https://dev.twitch.tv/docs/cli/websocket-event-command/ (beta, retrieved 2026-10-28).
  - Then a real test on Kilian's test channel, run by the team from the box: 10 hints, `!stuck`, `!more`, `!solved`, `!forgetme`, and ending the stream.
- **Load:** the simulator sends a burst of 5,000 hints in 2 h compressed to 5 min at speed 24. Check the queue cap, the cost meter and that the bot's chat output stays rate-limited.
- **OBS:** the Browser Source at 1920×1080 must show a transparent background and correct animations. Record 30 s as a test.
- **Privacy check:** after the session ends, grep the data dir and logs for the demo hint strings, and expect 0 hits.

## 15. Codex working agreement (for the single thread)
1. Order of work:
   1. scaffold + config,
   2. mock pipeline + demo script,
   3. overlay,
   4. mini game (see GAME-CONCEPT.md),
   5. Twitch EventSub,
   6. OpenAI provider,
   7. cost brake + purge,
   8. tests,
   9. README.
2. Keep the whole build in this one thread, which runs on the team box under Kilian's ChatGPT account. The team reads the session ID with `/status` and enters it in the Devpost draft. Never start a second thread for the project.
3. Commit after each step with meaningful messages, because the git history proves the build happened during the Submission Period.
4. All assets (graphics, sounds) are self-made or generated in code (SVG/CSS/WebAudio). No third-party games, music or trademarks.
