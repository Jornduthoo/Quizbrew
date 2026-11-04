// Shared by the layout tests; runs inside the big screen page (no Node in here).
// Runs in the page: every visible block of the current view stays inside the screen and inside its own zone,
// and the zones of the view never overlap each other.
function problems() {
  const out = [];
  const vw = innerWidth, vh = innerHeight, slack = 3;
  const view = [...document.querySelectorAll('.view')].find(v => !v.hidden);
  if (!view) return out;
  const shown = el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  const label = el => el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName;
  const box = el => el.getBoundingClientRect();
  // Corner notes on the end screen are placed on top of the view, but must not cover anything either.
  const zones = [...view.children].filter(el => shown(el) && (el.matches('.made-with, .end-sponsors') || !['absolute', 'fixed'].includes(getComputedStyle(el).position)) && box(el).height > 0);
  for (const z of zones) {
    const r = box(z);
    if (r.left < -slack || r.top < -slack || r.right > vw + slack || r.bottom > vh + slack) out.push(`${label(z)} sticks out of the screen`);
    for (const el of z.querySelectorAll('*')) {
      // Decoration that is meant to stick out a little: the crown on the leader, the scaled art in the medal,
      // the right answer that grows when it lights up.
      if (!shown(el) || el.closest('.crown-wrap, .ri-art, .answer.correct')) continue;
      const e = box(el);
      if (!e.width || !e.height || e.width > vw * 2) continue;
      if (e.left < r.left - slack * 4 || e.right > r.right + slack * 4 || e.top < r.top - slack * 4 || e.bottom > r.bottom + slack * 4) {
        out.push(`${label(el)} (${el.textContent.trim().slice(0, 30)}) sticks out of ${label(z)}`);
        break;
      }
    }
    // Text that does not fit its own box: a word wider than its line, or a list that is cut off.
    for (const el of [z, ...z.querySelectorAll('*')]) {
      if (!shown(el) || el.matches('.ta-name, .ta-answer, .name, .rb-name, .br-name, .team-chip, .ch, .w')) continue;
      if (el.scrollWidth > el.clientWidth + slack && el.clientWidth > 0 && getComputedStyle(el).overflowX !== 'visible') out.push(`${label(el)} is cut off on the side`);
      if (el.scrollHeight > el.clientHeight + slack && el.clientHeight > 0 && getComputedStyle(el).overflowY !== 'visible') out.push(`${label(el)} is cut off at the bottom`);
    }
  }
  // Vote cards: the text and the team name stay inside the card and clear of the letter.
  for (const card of view.querySelectorAll('.ballot-card')) {
    if (!shown(card)) continue;
    const c = box(card);
    const letter = card.querySelector('.letter');
    const l = letter && box(letter);
    for (const el of card.querySelectorAll('.bc-text, .bc-by')) {
      const e = box(el);
      if (!e.height) continue;
      if (e.top < c.top - slack || e.bottom > c.bottom + slack) out.push(`${label(el)} (${el.textContent.trim().slice(0, 30)}) sticks out of its card (${Math.round(e.top - c.top)}/${Math.round(c.bottom - e.bottom)})`);
      else if (l && el.matches('.bc-text') && e.top < l.bottom - slack && e.left < l.right - slack) out.push(`${label(el)} (${el.textContent.trim().slice(0, 30)}) runs under the card letter`);
    }
  }
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = box(zones[i]), b = box(zones[j]);
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > slack && y > slack) out.push(`${label(zones[i])} overlaps ${label(zones[j])}`);
    }
  }
  // A title never breaks in the middle of a word.
  for (const w of view.querySelectorAll('.w')) {
    if (!shown(w)) continue;
    const tops = new Set([...w.children].map(c => Math.round(c.getBoundingClientRect().top / 4)));
    if (tops.size > 1) out.push(`the word "${w.textContent}" breaks over two lines`);
    if (w.getBoundingClientRect().right > vw + slack) out.push(`the word "${w.textContent}" sticks out of the screen`);
  }
  return out;
}

module.exports = { problems };
