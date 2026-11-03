# Quizbrew

Quiz nights on your own network. One laptop runs the quiz, the TV shows it, teams play on their phones. No accounts, no app to install, no internet needed.

## Start

```
npm install
npm start
```

Then open on the laptop:

| What | Address |
| --- | --- |
| Quizmaster | http://localhost:3000/host |
| Big screen (drag to the TV) | http://localhost:3000/screen |
| Players | scan the QR code on the big screen |

The laptop and the phones must be on the same wifi (or the laptop's hotspot). Use another port with `PORT=4000 npm start`.

## Languages

All screen text lives in `lang/en.json`, `lang/nl.json` and `lang/fr.json`. English is the default and the fallback. The quizmaster picks the language in the top bar; phones use their own language when Quizbrew has it. `npm test` fails when a key is missing in a language or when text is hardcoded in the HTML.

## Quiz builder

Open http://localhost:3000/builder (or "Open quiz builder" on the quizmaster screen) to prepare a whole quiz night on this laptop:

- A library with folders in `data/library/`; pictures are shrunk to webp in the browser and stored once in `data/media/`.
- Rounds of any type in any order (drag the round cards), each with its own scoring mode and twists.
- Import and export: `.quizbrew.json` (pictures inside the file) and spreadsheets (`.csv`, comma or semicolon).
- AI help per round or for the whole evening: with your own Gemini, Claude or ChatGPT key (kept in `data/settings.json`), or by copying the prompt into any AI chat and pasting the answer back.

## Round types

| Type | Phones | How it scores |
| --- | --- | --- |
| `classic` | 2-4 buttons | scoring mode of the round |
| `trueFalse` | true / false | scoring mode |
| `open` | type an answer; small typos and `accept` spellings count, the quizmaster can overrule | scoring mode |
| `closest` | type a number | closest team, spot on doubles |
| `picture` | buttons or typed, with a picture | scoring mode |
| `zoomOut` | like picture, the picture zooms out during the question | ladder by default |
| `speed` | buttons, 10 s | speed by default |
| `scramble` | type the word from shuffled letters | speed by default |
| `commonThread` | clues appear one by one, type the link | ladder by default |
| `jackpot` | bet points after seeing the category, then type | + or - the bet |

Scoring modes: `points`, `speed` (up to double for fast answers), `race` (only the fastest right team), `risk` (wrong costs points), `time` (seconds left), `ladder` (earlier is worth more).
Twists per round: `double`, `lockdown` (leaving the page blocks the answer), `blackout` (question only on the TV), `underdog` (last team x1.5). A quiz with `"jokers": true` gives every team one joker (x2 on a round of its choice).
A phone that leaves the page during a question is always shown to the quizmaster.

The definitions live in `src/rounds.js`; each type needs `round.<type>` and `round.<type>.desc` in the language files, a theme in `QB.ROUND_THEMES` and an AI hint in `src/ai.js`. Tests check all three.

## Quiz files

Bundled samples are JSON files in `quizzes/` (see `round-tour.json` for every round type):

```json
{
  "title": "Pub Warm-up",
  "jokers": true,
  "rounds": [
    { "type": "classic", "title": "General Knowledge", "scoring": "speed", "twists": ["double"], "questions": [
      { "question": "Which planet is known as the Red Planet?", "answers": ["Venus", "Mars", "Jupiter", "Mercury"], "correct": 1, "time": 20 }
    ] },
    { "type": "open", "questions": [{ "question": "Capital of Australia?", "answer": "Canberra", "accept": ["Canbera"] }] }
  ]
}
```

## Code

- `server.js` starts the app; `src/app.js` has the routes and sockets (`/api/host/*` only works on this laptop).
- `src/game.js` is the quiz engine (lobby, round intro, bets, question, reveal, scoreboard, end); `src/rounds.js` describes the round types.
- `src/library.js` (quizzes and media on disk), `src/csv.js` (spreadsheets), `src/ai.js` (prompts, reading AI answers, calling the AI).
- `public/` holds the screens: `host`, `screen`, `play` and `builder`. Plain HTML, CSS and JS, no build step.
- Tests: `npm test` (node --test).

## Look and effects

- Backgrounds per phase live in `public/img/` (webp, under 150 KB each) and cross-fade on the big screen.
- `public/js/fx.js` draws ambient particles and bursts (`FX.confetti`, `FX.sparks`, `FX.rain`, `FX.ambient`). It turns itself down on weak devices and off with reduced motion. Force a level with `?fx=off`, `?fx=low` or `?fx=high` in the URL.
- Every round type has a neon colour and icon in `QB.ROUND_THEMES` (`public/js/common.js`) and a label `round.<type>` in the language files; the round intro uses both.

The font is Bricolage Grotesque (SIL Open Font License, see `public/fonts/`).
