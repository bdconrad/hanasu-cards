# Hanasu Cards

Speaking-first Japanese flash cards, built to resist test-taking shortcuts.

## Run

Static site. Serve the folder over http (fetch of the deck JSON is blocked on file://):

    python3 -m http.server 8787

Then open http://localhost:8787. Speak or Listen runs every card in the selected decks at the chosen level, shuffled and interleaved, with the ones you missed last time first. Results live in the browser's localStorage. Export and import them from Settings.

## Why it is shaped this way

- Typed romaji production only. No multiple choice, no word bank, nothing to eliminate.
- You rate your confidence before the check. "Sure" and wrong is tracked as an overconfident miss and spaced harder.
- Cards from the selected decks are interleaved round-robin, so topic never narrows the answer.
- A random example sentence is shown on reveal, so the same word appears in different contexts over time.
- Near misses count as wrong.
- No spaced-repetition scheduling. Every session is the whole selection; start one whenever you like.
- Listen mode plays Japanese audio with no text. Play, Slow, and Syllables (one mora at a time, then the whole phrase slowly).
- Group mode makes one phone the host. Everyone answers out loud, host grades.

## Offline and home screen

`sw.js` is a service worker: network first, cache fallback. After one online visit the whole app, decks included, works offline. `manifest.webmanifest` and `icon.svg` let it be added to a phone home screen as an app. Bump `CACHE` in `sw.js` when you want old cached files cleared.

## Sync between devices

Settings → Make sync link. The link carries this device's progress, compressed, in the URL fragment; nothing goes to a server. Open it on another device (scan the QR with the camera, or Copy / Share) and the two merge. Each device keeps its own counters plus a copy of every other device's, and merging is a per-field max per device, so syncing in either direction or repeating a link never double-counts. When progress outgrows what a QR can hold (~2.9 KB of link), the screen offers the link only. The QR generator is the one outside dependency, loaded from cdnjs only when the sync screen is opened.

## Kana and kanji

The Kana tab has hiragana and katakana charts (basic, dakuten, combinations) with audio on tap and a toggle to hide romaji. Practice modes: Read (see the kana, type the romaji) and Hear (listen, pick the kana from look-alikes in the same row or column). The Kanji tab lists every kanji used in the decks with meaning, on and kun readings, and the deck words it appears in; its practice shows a word in kanji and asks for the romaji. Kanji entries live in `kanji-data.js`; add one there when a new deck word introduces a kanji.

## Levels

Every card has a `level`: 1 for single words and one or two word phrases, 2 for short phrases, 3 for full sentences. The Level picker on Study and Group includes everything at or below the chosen level. A card without a level is bucketed by word count.

## Decks

Plain JSON in `decks/`. List files in `decks/index.json`. Card fields:

    {
      "id": "unique-id",
      "ja": "すみません",
      "romaji": "sumimasen",
      "en": "Excuse me",
      "level": 1,
      "accept": ["optional alternate romaji"],
      "accept_en": ["optional alternate English meanings for Listen mode"],
      "notes": "optional, card-specific remark",
      "tip": "how the phrase is built: parts, register, casual or polite counterpart",
      "kana": "optional reading used for Syllables playback; derived from romaji when absent",
      "examples": [{ "ja": "...", "romaji": "...", "en": "..." }]
    }

Romaji is compared after normalising spelling systems (Hepburn vs Kunrei, macrons vs ou/oo, wo vs o, n' vs nn), so friends can type however they learned. Vowel length is forgiven in both directions: sayonara for sayounara passes, and the verdict shows it read as sayōnara. Everything else, including a dropped n (konichiwa), is strict. A Settings toggle displays romaji with macrons (ō, ū) instead of ou/uu; deck files stay in ou/uu style.

Audio uses the browser's speech synthesis. Chrome's Google Japanese voice honours the speed setting; Apple's Kyoko barely does, so Chrome is the better browser for Listen mode.
