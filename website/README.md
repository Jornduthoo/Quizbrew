# Quizbrew website

The promo site: plain HTML, CSS and a little JavaScript. No build step, no libraries. Open `index.html` through any web server.

- **Price, demo, links, contact**: `js/config.js` (one place).
- **Texts in 5 languages**: `js/i18n.js`. The page picks `?lang=`, then the visitor's earlier choice, then their country (Cloudflare's `/cdn-cgi/trace`; in Belgium, Switzerland, Luxembourg and Canada the browser language picks among the local languages), then the browser language.
- **Round types and version stamp**: `node website/tools/build.js` makes `js/rounds.js` from the app's own `lang/*.json` and gives the CSS and JS links in `index.html` a new `?v=` stamp. Run it after every change to the CSS or JS, or visitors keep the old files for up to an hour.
- **Screenshots**: `node website/tools/shots.js [look|all] [lang|all]` plays the sample night of each language with Playwright and saves webp files in `img/shots/<lang>/`. The page swaps every screenshot to the visitor's language, so each language needs the same files (the test checks it). Team names, quiz title and translated round samples live in `tools/shot-lang.js`.
- **Builder screenshots**: `node website/tools/builder-shots.js [lang|all]` opens the real quiz builder (with a stand-in for the AI, so no key) and saves `img/shots/<lang>/builder-*.webp`.
- **Round screenshots**: `node website/tools/round-shots.js [lang|all] [type ...]` plays one question of every round type and saves `img/rounds/<lang>/<type>.webp` for the round viewer.

## Hosting on Cloudflare Pages

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick `Jornduthoo/Quizbrew`, then:

- Production branch: `main`
- Framework preset: None
- Build command: (empty)
- Build output directory: `website`

Every merge to `main` then updates the site. Add the domain under the project's Custom domains tab.
`_headers` sets caching; `preview.html` is local only (gitignored).
