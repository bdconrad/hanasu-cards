# Hanasu Cards

Speaking-first Japanese flash cards for Ben and friends. Static site: `index.html`, `styles.css`, `app.js`, `kana.js`, `kanji-data.js`, `decks/*.json`. No build step, no dependencies, no framework.

## Run

    python3 -m http.server 8787

Open http://localhost:8787. `file://` does not work because the decks load with fetch.

## Design rules (do not undo these)

- Production only. Typed romaji, never multiple choice or word banks. The one exception is kana Hear mode, where distractors come from the same row or column.
- Confidence (Sure / Kinda / No idea) must be chosen before the check. "Sure" and wrong is logged as an overconfident miss.
- Cards are interleaved across decks. A session is every selected card at the chosen level; there is no spaced-repetition scheduling. Ben removed it on purpose.
- Romaji grading: spelling systems unify (Hepburn, Kunrei, macrons, ou/oo, wo/o, final nn). Vowel length is forgiven both ways and the verdict says "read as X". Everything else is strict, including a dropped n. Near misses count as wrong.
- Display romaji through `fmtRomaji()` so the macron setting applies. Deck files stay in ou/uu style.
- Audio: prefer the Google Japanese voice (honours rate); Kyoko barely does. Every place audio plays gets Play, Slow and Syllables (Syllables only for multi-mora text). Tap-to-hear surfaces use `tapSpeak()`.
- Ben's priority is speaking and listening, not reading or writing. Romaji input, Japanese and romaji both displayed.

## Data

- Card fields: id, level (1 words, 2 phrases, 3 sentences), ja, romaji, en, accept, accept_en, notes, tip, kana, examples. See README.md.
- Every card has a `tip` (parts, register, polite or casual counterpart). Add one for any new card.
- `kanji-data.js` must contain every kanji used in `decks/*.json`. Check with the snippet in README.md after adding cards.
- Progress is localStorage only: `hanasu.progress.v1` (cards), `hanasu.kana.v1`, `hanasu.kanji.v1`, prefs under `hanasu.*`. Those hold this device's own counters. `hanasu.others.v1` holds synced copies from other devices keyed by device id; `hanasu.device.v1` is this device's id.
- Always read progress through `viewProg(kind, id)` (kind c, k, j), which merges own + others. Write only to the own stores, and stamp `last: Date.now()` on every write; the merge uses it to pick the latest answer.
- Sync links: `#sync=<z|p><base64url>`; `encodeSync` / `decodeSync` / `applySync` in app.js. Merge is per-device, per-field max, so it must stay idempotent.

## Verify

Serve, open in Chrome, and click through the changed mode. Check console for errors. Phone width (400px) must have no horizontal scroll.
