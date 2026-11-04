# Quizbrew website

The promo site: plain HTML, CSS and a little JavaScript. No build step, no libraries. Open `index.html` through any web server.

- **Price, demo, links, contact**: `js/config.js` (one place).
- **Texts in 5 languages**: `js/i18n.js`. The page picks `?lang=`, then the visitor's earlier choice, then their country (Cloudflare's `/cdn-cgi/trace`; in Belgium, Switzerland, Luxembourg and Canada the browser language picks among the local languages), then the browser language.
- **Round types and version stamp**: `node website/tools/build.js` makes `js/rounds.js` from the app's own `lang/*.json` and gives the CSS and JS links in `index.html` a new `?v=` stamp. Run it after every change to the CSS or JS, or visitors keep the old files for up to an hour.
- **Screenshots**: `node website/tools/shots.js [pub|space|jungle|spooky|arcade]` plays an English sample night with Playwright and saves webp files in `img/shots`.
- **Builder screenshots**: `node website/tools/builder-shots.js` opens the real quiz builder (with a stand-in for the AI, so no key) and saves `img/shots/builder-*.webp`.

## Hosting on Cloudflare Pages

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick `Jornduthoo/Quizbrew`, then:

- Production branch: `main`
- Framework preset: None
- Build command: (empty)
- Build output directory: `website`

Every merge to `main` then updates the site. Add the domain under the project's Custom domains tab.
`_headers` sets caching; `preview.html` is local only (gitignored).
