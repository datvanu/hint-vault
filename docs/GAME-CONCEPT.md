# Demo Game: "Lumen Locks" — own mini puzzle game for the Hint Vault demo

> Owner: Kilian Schieri · 2026-10-28 · Built in the **same Codex thread** as the bot (see SPEC.md §15).
> Purpose: provide reliable, legally clean moments where the streamer is stuck and chat has tiered hints. No third-party games, music or trademarks.

## 1. Pitch
A one-screen browser escape-room game of 3 short rooms, about 2–4 min each, played with mouse only. The art is minimal neon vector made of SVG/CSS shapes. Each room has **one clear puzzle** with an obvious "aha", so chat naturally produces hints at all 4 levels (nudge → solution).

## 2. Why it fits
- **Buildable in 3–5 h:** plain HTML/CSS/JS, one page `/game`, no engine, no physics, no asset pipeline.
- **Stuck moments by design:** each solution needs one piece of information that is visible but easy to overlook.
- **Tiered hints are natural:** "look around" → "the poster" → "the poster colors are the order" → "red-blue-red-green".
- **Vault integration:** the game emits `puzzle` and `solved` events over the local WS, and the vault switches context automatically. The `context` string feeds the AI rater, so it can tell a nudge from a solution.

## 3. Rooms

| # | Room | Puzzle | Hidden key info | Level 0 → 3 example hints |
|---|---|---|---|---|
| 1 | **Lever Hall** | Pull 4 colored levers in the right order. | A faded poster on the wall shows 4 colored dots. | "Look at the walls" → "That poster isn't decoration" → "Dot colors = lever order" → "Red, Blue, Red, Green" |
| 2 | **Clock Shelf** | Set a dial to the right number. | 3 clocks on a shelf; only the one with a crack is relevant; its hour = code. | "Something is broken in here" → "Check the clocks" → "Only the cracked clock counts" → "Set the dial to 7" |
| 3 | **Mirror Door** | Type a 4-letter word into the door. | A word written backwards on the floor, readable in a mirror. | "Don't forget the floor" → "The mirror helps" → "Read the floor text mirrored" → "The word is GLOW" |

- Each room randomizes its solution from a small seeded pool. This prevents spoiler memorization between demo takes, and the demo script keeps a fixed seed so the hints match.
- A wrong attempt plays a soft "bonk" and shakes the door. There is no fail state and no timer pressure, which keeps it calm on stream.
- An optional "stuck timer" in the game UI ("You've been here 90 s… chat may know something") helps the video pacing.

## 4. Game ↔ Vault events (interface)
```
→ vault  {type:'puzzle', id:'room1-lever', name:'Lever Hall',
          context:'Player must pull 4 colored levers in order; the order is shown by colored dots on a faded poster.'}
→ vault  {type:'attempt', id:'room1-lever', correct:false}      // optional, for overlay flavor
→ vault  {type:'solved',  id:'room1-lever'}                     // triggers !solved credit flow
```
The context strings are written by us. They never contain real viewer data.

## 5. Assets and audio (all self-made)
- **Graphics:**
  - Inline SVG shapes (levers, clocks, mirror), CSS gradients and glow, and a system font stack. No icon packs required.
  - An optional single original logo "Hint Vault" made as SVG by Codex.
  - If Kilian wants generated art, use self-generated images only, and note this in the README.
- **Sound:**
  - Generated at runtime with the **Web Audio API**: lever "clunk" (filtered noise burst), success chime (two sine notes), wrong "bonk" (low square blip), vault-door rumble (low-pass noise sweep).
  - Ambient music: a simple procedural 4-chord pad (oscillators) or none. **No external audio files and no stock music.**
- A license note in the README says: "All graphics and audio are original, created in code for this project."

## 6. Scope guardrails
- **Must:**
  - 3 rooms.
  - Mouse controls.
  - WS events.
  - Seeded solutions.
  - Generated sounds.
  - 1920×1080 layout that looks good under the overlay, with the overlay panel on the right third and the game on the left two thirds.
- **Nice:**
  - Room transition animation.
  - "Chat helped!" banner on solve.
  - Keyboard controls.
- **Won't:**
  - Save system.
  - Mobile layout.
  - Multiple languages.
  - Accounts.

## 7. Acceptance
1. All 3 rooms are solvable in under 30 s each if you know the solution, and plausibly take 1–3 min if you don't.
2. Each room emits `puzzle` on enter and `solved` on success, and the overlay switches context.
3. There are zero network requests besides localhost, and no external files besides the page's own JS/CSS.
4. It runs in the OBS Browser Source or in a normal browser window captured by OBS.
