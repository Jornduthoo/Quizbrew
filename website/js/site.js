// Fills every text in the chosen language, the price from config.js, the round types and the look tabs.
(function () {
  const C = window.QB_SITE, T = window.QB_TEXT, R = window.QB_ROUNDS;
  const LANGS = Object.keys(T);
  const LOCALE = { en: 'en-IE', nl: 'nl-BE', fr: 'fr-BE', de: 'de-DE', es: 'es-ES' };
  const store = {
    get() { try { return localStorage.getItem('qb.site.lang'); } catch { return null; } },
    set(v) { try { localStorage.setItem('qb.site.lang', v); } catch { /* private mode */ } },
  };
  const pick = () => {
    const q = new URLSearchParams(location.search).get('lang');
    if (LANGS.includes(q)) return q;
    const s = store.get();
    if (LANGS.includes(s)) return s;
    const nav = (navigator.languages || [navigator.language || 'en']).map(l => String(l).slice(0, 2).toLowerCase());
    return nav.find(l => LANGS.includes(l)) || 'en';
  };

  const price = lang => new Intl.NumberFormat(LOCALE[lang], {
    style: 'currency', currency: C.currency, minimumFractionDigits: C.price % 1 ? 2 : 0, maximumFractionDigits: 2,
  }).format(C.price);
  const fill = (lang, key) => (T[lang][key] ?? T.en[key] ?? '')
    .replace(/\{price\}/g, price(lang)).replace(/\{demo\}/g, C.demoTeams).replace(/\{max\}/g, C.maxTeams).replace(/\{compare\}/g, C.compare);

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
    const mail = document.getElementById('mail');
    mail.href = 'mailto:' + C.email; mail.textContent = C.email;
    families(lang);
    document.getElementById('lang').value = lang;
  }

  function families(lang) {
    const box = document.getElementById('families');
    box.replaceChildren(...R.map(f => {
      const card = document.createElement('article');
      card.className = 'family';
      const img = Object.assign(document.createElement('img'), { src: `img/icons/${f.id}.webp`, alt: '', width: 64, height: 64, loading: 'lazy' });
      const h = Object.assign(document.createElement('h3'), { textContent: f.name[lang] || f.name.en });
      const n = Object.assign(document.createElement('span'), { className: 'count', textContent: f.rounds.length });
      const ul = document.createElement('ul');
      ul.append(...f.rounds.map(r => Object.assign(document.createElement('li'), { textContent: r[lang] || r.en })));
      const head = document.createElement('div');
      head.className = 'family-head';
      head.append(img, h, n);
      card.append(head, ul);
      return card;
    }));
  }

  // Look tabs: swap the round intro screenshot.
  const tabs = [...document.querySelectorAll('.look-tabs [role=tab]')];
  const lookImg = document.getElementById('look-img');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    lookImg.src = `img/shots/${tab.dataset.look}-intro.webp`;
  }));
  // Warm the other looks once the page is idle, so switching is instant.
  addEventListener('load', () => setTimeout(() => tabs.forEach(t => { new Image().src = `img/shots/${t.dataset.look}-intro.webp`; }), 1500));

  const select = document.getElementById('lang');
  select.addEventListener('change', () => { store.set(select.value); apply(select.value); });
  apply(pick());
})();
