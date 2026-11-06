// Fills every text in the chosen language, the price from config.js, the round types and the look tabs.
(function () {
  const C = window.QB_SITE, T = window.QB_TEXT, R = window.QB_ROUNDS;
  const LANGS = Object.keys(T);
  // The version stamp of this script (set by tools/build.js), also put on the film and its poster:
  // videos are cached for a week, so a new film needs a new address.
  const VER = ((document.currentScript && document.currentScript.src.match(/\?v=(\d+)/)) || [])[1];
  const V = VER ? `?v=${VER}` : '';
  // The quiz night guide has one static page per language (made by tools/guides.js).
  const GUIDES = { en: 'quiz-night.html', nl: 'quizavond.html', fr: 'soiree-quiz.html', de: 'quizabend.html', es: 'noche-de-quiz.html' };
  const LOCALE = { en: 'en-IE', nl: 'nl-BE', fr: 'fr-BE', de: 'de-DE', es: 'es-ES' };
  const store = {
    get() { try { return localStorage.getItem('qb.site.lang'); } catch { return null; } },
    set(v) { try { localStorage.setItem('qb.site.lang', v); } catch { /* private mode */ } },
  };
  // Language: ?lang= first, then the visitor's own earlier choice, then their country (with the browser language
  // deciding inside countries with more than one of our languages), then the browser language.
  const browser = () => (navigator.languages || [navigator.language || 'en']).map(l => String(l).slice(0, 2).toLowerCase()).filter(l => LANGS.includes(l));
  const chosen = () => {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) return q;
    const s = store.get();
    return LANGS.includes(s) ? s : null;
  };
  const SPANISH = 'ES MX AR CO CL PE VE EC GT CU BO DO HN PY SV NI CR PA UY PR GQ'.split(' ');
  const COUNTRY = { NL: ['nl'], SR: ['nl'], BE: ['nl', 'fr', 'de'], LU: ['fr', 'de'], FR: ['fr'], MC: ['fr'], CH: ['de', 'fr'],
    DE: ['de'], AT: ['de'], LI: ['de'], CA: ['en', 'fr'], ...Object.fromEntries(SPANISH.map(c => [c, ['es']])) };
  const byCountry = cc => {
    const spoken = COUNTRY[cc];
    if (!spoken) return null;
    return browser().find(l => spoken.includes(l)) || spoken[0];
  };
  const pick = () => chosen() || browser()[0] || 'en';
  // Cloudflare tells the page the visitor's country; without it (or offline) the browser language stays.
  function region() {
    if (chosen() || location.protocol !== 'https:') return;
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 2000);
    fetch('/cdn-cgi/trace', { signal: ctl.signal }).then(r => (r.ok ? r.text() : '')).then(txt => {
      const cc = (txt.match(/^loc=([A-Z]{2})$/m) || [])[1];
      const lang = cc && (byCountry(cc) || browser()[0] || 'en');
      if (lang && lang !== document.documentElement.lang && !chosen()) apply(lang);
    }).catch(() => {});
  }

  const price = lang => new Intl.NumberFormat(LOCALE[lang], {
    style: 'currency', currency: C.currency, minimumFractionDigits: C.price % 1 ? 2 : 0, maximumFractionDigits: 2,
  }).format(C.price);
  const fill = (lang, key) => (T[lang][key] ?? T.en[key] ?? '')
    .replace(/\{price\}/g, price(lang)).replace(/\{demo\}/g, C.demoTeams).replace(/\{max\}/g, C.maxTeams).replace(/\{compare\}/g, C.compare).replace(/\{rounds\}/g, R.reduce((n, f) => n + f.rounds.length, 0));

  function apply(lang) {
    document.documentElement.lang = lang;
    document.title = fill(lang, 'meta.title');
    const d = document.querySelector('meta[name="description"]');
    if (d) d.content = fill(lang, 'meta.desc');
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = fill(lang, el.dataset.t); });
    document.querySelectorAll('[data-list]').forEach(ul => {
      ul.replaceChildren(...fill(lang, ul.dataset.list).split('|').map(t => Object.assign(document.createElement('li'), { textContent: t })));
    });
    document.querySelectorAll('[data-price]').forEach(el => { el.textContent = price(lang); });
    document.querySelectorAll('[data-cta]').forEach(a => {
      const url = a.dataset.cta === 'buy' ? C.buyUrl : C.demoUrl;
      if (url) { a.href = url; a.removeAttribute('data-soon'); }
      else { a.href = '#price'; a.dataset.soon = fill(lang, 'cta.soon'); }
    });
    const guide = document.getElementById('guide');
    if (guide) guide.href = GUIDES[lang] || GUIDES.en;
    const mail = document.getElementById('mail');
    mail.href = 'mailto:' + C.email; mail.textContent = C.email;
    families(lang);
    shots(lang);
    film(lang);
    document.getElementById('lang').value = lang;
  }

  // Screenshots of the app in the page language: every picture under img/shots/<lang>/ and the film poster.
  function shots(lang) {
    document.querySelectorAll('img[src*="img/shots/"]').forEach(img => {
      const src = img.getAttribute('src').replace(/img\/shots\/[a-z]{2}\//, `img/shots/${lang}/`);
      if (src !== img.getAttribute('src')) img.setAttribute('src', src);
    });
    video.poster = `video/poster-${lang}.webp${V}`;
  }

  // On a phone the round families fold up, so the list stays short; on a big screen they are all open.
  const wide = matchMedia('(min-width: 761px)');
  wide.addEventListener('change', () => document.querySelectorAll('.family').forEach(d => { d.open = wide.matches; }));
  function families(lang) {
    const box = document.getElementById('families');
    box.replaceChildren(...R.map(f => {
      const card = document.createElement('details');
      card.className = 'family';
      card.open = wide.matches;
      const img = Object.assign(document.createElement('img'), { src: `img/icons/${f.id}.webp`, alt: '', width: 64, height: 64, loading: 'lazy' });
      const h = Object.assign(document.createElement('h3'), { textContent: f.name[lang] || f.name.en });
      const n = Object.assign(document.createElement('span'), { className: 'count', textContent: f.rounds.length });
      const ul = document.createElement('ul');
      ul.append(...f.rounds.map(r => {
        const li = document.createElement('li');
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'round-chip', textContent: r[lang] || r.en });
        b.addEventListener('click', () => showRound(r.id));
        li.append(b);
        return li;
      }));
      const head = document.createElement('summary');
      head.className = 'family-head';
      head.append(img, h, n);
      card.append(head, ul);
      return card;
    }));
  }

  // A round type up close: its screenshot on the big screen and what it is, with previous and next.
  const ALL = R.flatMap(f => f.rounds.map(r => ({ ...r, family: f.name })));
  const view = document.getElementById('round-view');
  let at = 0;
  function showRound(id) {
    at = Math.max(0, ALL.findIndex(r => r.id === id));
    const r = ALL[at], lang = document.documentElement.lang;
    document.getElementById('rv-img').src = `img/rounds/${lang}/${r.id}.webp`;
    document.getElementById('rv-family').textContent = r.family[lang] || r.family.en;
    document.getElementById('rv-name').textContent = r[lang] || r.en;
    document.getElementById('rv-desc').textContent = r.desc[lang] || r.desc.en;
    new Image().src = `img/rounds/${lang}/${ALL[(at + 1) % ALL.length].id}.webp`;
    if (!view.open) view.showModal();
  }
  const step = d => showRound(ALL[(at + d + ALL.length) % ALL.length].id);
  document.getElementById('rv-prev').addEventListener('click', () => step(-1));
  document.getElementById('rv-next').addEventListener('click', () => step(1));
  document.getElementById('rv-close').addEventListener('click', () => view.close());
  view.addEventListener('click', e => { if (e.target === view) view.close(); });
  view.addEventListener('keydown', e => { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); });

  // The promo film in the page language. It loads and plays only once it scrolls into view.
  const video = document.getElementById('promo');
  let filmLang = null, seen = false;
  function film(lang) {
    filmLang = lang;
    if (!seen) return;
    const src = `video/promo-${lang}-wide.mp4${V}`;
    if (!video.src.endsWith(src)) { video.src = src; video.play().catch(() => {}); }
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { seen = true; film(filmLang); if (reduced) video.controls = true; else video.play().catch(() => {}); }
      else if (seen) video.pause();
    }), { threshold: 0.35 }).observe(video);
  } else { seen = true; video.controls = true; }

  // Look tabs: swap the round intro screenshot.
  const tabs = [...document.querySelectorAll('.look-tabs [role=tab]')];
  const lookImg = document.getElementById('look-img');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    lookImg.src = `img/shots/${document.documentElement.lang}/${tab.dataset.look}-intro.webp`;
  }));
  // Warm the other looks once the page is idle, so switching is instant.
  addEventListener('load', () => setTimeout(() => tabs.forEach(t => { new Image().src = `img/shots/${document.documentElement.lang}/${t.dataset.look}-intro.webp`; }), 1500));

  // The bar with the price at the bottom of a phone: after the hero, and not over the price section itself.
  const bar = document.getElementById('buybar');
  const hero = document.querySelector('.hero'), priceBox = document.getElementById('price'), foot = document.querySelector('.foot');
  const vis = new Map();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => vis.set(e.target, e.isIntersecting));
      bar.classList.toggle('on', !vis.get(hero) && !vis.get(priceBox) && !vis.get(foot));
    });
    [hero, priceBox, foot].forEach(el => io.observe(el));
  }

  const select = document.getElementById('lang');
  select.addEventListener('change', () => { store.set(select.value); apply(select.value); });
  apply(pick());
  region();
})();
