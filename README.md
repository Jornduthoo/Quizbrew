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

## Quiz files

Quizzes are JSON files in `quizzes/`:

```json
{
  "title": "Pub Warm-up",
  "rounds": [
    { "type": "classic", "title": "General Knowledge", "questions": [
      { "question": "Which planet is known as the Red Planet?", "answers": ["Venus", "Mars", "Jupiter", "Mercury"], "correct": 1, "time": 20 }
    ] }
  ]
}
```

## Code

- `server.js` starts the app; `src/app.js` has the routes and sockets.
- `src/game.js` is the quiz engine (lobby, round intro, question, reveal, scoreboard, end).
- `public/` holds the three screens: `host`, `screen`, `play`. Plain HTML, CSS and JS, no build step.
- Tests: `npm test` (node --test).

## Look and effects

- Backgrounds per phase live in `public/img/` (webp, under 150 KB each) and cross-fade on the big screen.
- `public/js/fx.js` draws ambient particles and bursts (`FX.confetti`, `FX.sparks`, `FX.rain`, `FX.ambient`). It turns itself down on weak devices and off with reduced motion. Force a level with `?fx=off`, `?fx=low` or `?fx=high` in the URL.
- Every round type has a neon colour and icon in `QB.ROUND_THEMES` (`public/js/common.js`) and a label `round.<type>` in the language files; the round intro uses both.

The font is Bricolage Grotesque (SIL Open Font License, see `public/fonts/`).
