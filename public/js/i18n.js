// Screen text by key. Mark elements with data-i18n="key" (text) or data-i18n-attr="placeholder:key,title:key".
// t('key', { n: 3 }) fills {n}. English is always the fallback (the server merges it in).
(function () {
  const I18n = { lang: 'en', dict: {}, listeners: [] };

  I18n.t = function (key, vars) {
    let s = I18n.dict[key];
    if (s === undefined) { console.warn('Missing text:', key); s = key; }
    // "one|other" plural forms, picked by vars.n. French also uses the singular for 0.
    if (s.includes('|') && vars && typeof vars.n === 'number') {
      const [one, other] = s.split('|');
      s = (vars.n === 1 || (I18n.lang === 'fr' && vars.n === 0)) ? one : other;
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return s;
  };

  I18n.apply = function (root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => { el.textContent = I18n.t(el.dataset.i18n); });
    (root || document).querySelectorAll('[data-i18n-attr]').forEach(el => {
      el.dataset.i18nAttr.split(',').forEach(pair => {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr.trim(), I18n.t(key.trim()));
      });
    });
  };

  I18n.load = async function (lang) {
    const res = await fetch('/lang/' + encodeURIComponent(lang) + '.json');
    I18n.dict = await res.json();
    I18n.lang = lang;
    document.documentElement.lang = lang;
    I18n.apply();
    I18n.listeners.forEach(fn => fn(lang));
  };

  I18n.onChange = fn => I18n.listeners.push(fn);

  // The phone's own language when Quizbrew speaks it, otherwise null.
  I18n.deviceLanguage = function (supported) {
    const list = navigator.languages || [navigator.language || ''];
    for (const l of list) {
      const code = String(l).slice(0, 2).toLowerCase();
      if (supported.includes(code)) return code;
    }
    return null;
  };

  // A price the way this language writes it: €48.99, 48,99 €, € 48,99.
  I18n.money = function (amount, currency = 'EUR') {
    const n = Number(amount);
    if (!Number.isFinite(n)) return String(amount || '');
    try {
      return new Intl.NumberFormat(I18n.lang, { style: 'currency', currency, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
    } catch { return `€${n}`; }
  };

  window.I18n = I18n;
  window.t = I18n.t;
})();
