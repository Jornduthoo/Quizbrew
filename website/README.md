# Quizbrew website

The promo site: plain HTML, CSS and a little JavaScript. No build step, no libraries. Open `index.html` through any web server.

- **Price, demo, links, contact**: `js/config.js` (one place).
- **Texts in 5 languages**: `js/i18n.js`. The page picks `?lang=`, then the visitor's earlier choice, then the browser language.
- **Round types**: `js/rounds.js` is made from the app's own `lang/*.json`: `node website/tools/build.js`.
- **Screenshots**: `node website/tools/shots.js [pub|space|jungle|spooky|arcade]` plays an English sample night with Playwright and saves webp files in `img/shots`.

Hosting: the folder works as-is on GitHub Pages, Netlify or Cloudflare Pages.
