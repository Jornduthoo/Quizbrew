# Quizbrew

**Brew a quiz in seconds.**

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

## Run sheet and remote

- **Run sheet**: *Run sheet* on a quiz card (or in the builder) opens a printable sheet with every round, question, answer, time and points, plus an empty score sheet. Untick *With answers* for a copy without answers.
- **Remote**: *Remote* in the top bar shows a QR code. Scan it with your phone or tablet on the same wifi to get the big Next button, the answers and the judge buttons in your hand. The secret link changes every time Quizbrew starts.

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
| `music` | buttons or typed, a sound fragment plays on the big screen | scoring mode |
| `introSprint` | type; the intro grows 1, 2, 4, 8 seconds | ladder by default |
| `rewind` | type; the fragment plays backwards | scoring mode |
| `soundCheck` | buttons or typed: what makes this sound? | scoring mode |
| `lyricGap` | type the missing word of a song line | scoring mode |
| `pixelFog` | buttons or typed; big pixels that get sharp | ladder by default |
| `silhouette` | buttons or typed; only the outline until the reveal | scoring mode |
| `oddOneOut` | 3-4 pictures, tap the letter of the odd one | scoring mode |
| `emoji` | type what the emoji tell | scoring mode |
| `orderUp` | tap the items in order (items are stored in the right order) | all right or nothing |
| `pairUp` | for each left item tap its partner | all right or nothing |
| `mapDrop` | tap a spot on a map or picture | closest pin, within 2% doubles |
| `buzzer` | one big button; the first team answers out loud, the quizmaster taps right or wrong | points (or risk) |
| `lastStanding` | buttons; a miss puts the team out for the rest of the round | points per question survived |
| `pushYourLuck` | buttons plus "bank"; every right answer doubles the pot | only banked points count |
| `steal` | type; right teams take the points from the leader | + points, leader pays |
| `pickYourLevel` | pick easy, medium or hard first, then your own question | 1x, 2x, 3x |
| `hotStreak` | buttons or typed; right answers in a row count up | 1x, 2x, 3x ... |
| `listRush` | type as many items as you can until time is up | points per item |
| `crowdMind` | type; no right answer | the most common answer scores |
| `drawGuess` | draw on the phone, then vote for the best drawing | points per vote |
| `captionThis` | write a caption for a picture, then vote | points per vote |
| `bluffBank` | write a fake answer, then find the truth between the bluffs | truth found + teams fooled |
| `actItOut` | one team acts the secret out (it is only on their phone), the others type | right guess; actors score when anyone gets it |
| `photoHunt` | take a photo for the task, then vote | points per vote |
| `whosWho` | answer about your team, then match answers to teams | points per right match |
| `stakeIt` | see the category, bet, then a multiple choice question | + or - your bet |
| `localLegend` | your own questions about the town, club or pub (picture optional) | any |
| `clueLadder` | who or what is it: clues from very hard to easy | ladder |
| `fiveFacts` | an open question with five keywords | point per keyword, all five x2 |
| `clipRecall` | watch a video clip, then type every detail you remember | point per detail |
| `opponentsPick` | the leader picks the category for everyone else | any |
| `headToHead` | finale: the top two race, the others predict the winner | winner and right predictions |
| `clockBank` | one team at a time answers out loud on its own 60 s clock | points, right adds seconds |
| `clockDuel` | finale: the top two take turns against their own clock | the last clock standing |

Party rounds add a vote phase after the question: drawings and photos are stored in the library media folder, and nobody can vote for their own entry.

Sound files (mp3, m4a, ogg, wav) are uploaded in the builder with a start and end second. Browsers only play sound after one click on the big screen; a button asks for it when needed.

Scoring modes: `points`, `speed` (up to double for fast answers), `race` (only the fastest right team), `risk` (wrong costs points), `time` (seconds left), `ladder` (earlier is worth more).
Twists per round: `double`, `lockdown` (leaving the page blocks the answer), `blackout` (question only on the TV), `underdog` (last team x1.5), `mysteryCategory` (round title hidden until the last answer), `suddenDeath` (first mistake ends the round for that team), `shrinkingOptions` (a wrong answer disappears every 5 s, points drop), `lifeline` (one 50/50 per team per round), `silentRound` (no sound, no countdown digits). A quiz with `"jokers": true` gives every team one joker (x2 on a round of its choice).
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

## Looks and effects

- The quizmaster picks a look in the top bar: Pub (default), Space disco, Jungle temple, Haunted manor or Retro arcade. The big screen and the phones follow live.
- Each look is one block in `public/css/base.css` (`:root[data-look="..."]`): colour channels, a display font and six painted backgrounds in `public/img/look/` (lobby, stage, play, board, finale, phone). Add a look by adding that block, its six images and a `look.<name>` label, and the name in `LOOKS` in `src/app.js`.
- Painted icons for the round families and the home tiles live in `public/img/icons/`.
- `public/js/fx.js` draws light effects only (sparks, glints, embers). It turns itself down on weak devices and off with reduced motion. Force a level with `?fx=off`, `?fx=low` or `?fx=high` in the URL.
- Every round type has a neon colour and icon in `QB.ROUND_THEMES` (`public/js/common.js`) and a label `round.<type>` in the language files; the round intro uses both.

The fonts are Bricolage Grotesque, Alfa Slab One, Audiowide, Lilita One, Creepster and Bungee, all under the SIL Open Font License (see `public/fonts/`).
