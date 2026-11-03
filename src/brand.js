'use strict';

// The venue and its sponsors: a name and logo for the night, and up to eight sponsors with a logo and a line.
// The big screen shows them in the lobby, on round intros, during the break and at the end.

const MAX_SPONSORS = 8;
const MEDIA = /^\/media\/[\w.-]{1,120}$/;

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const logo = v => (typeof v === 'string' && MEDIA.test(v) ? v : '');

function clean(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const sponsors = (Array.isArray(b.sponsors) ? b.sponsors : [])
    .map(s => ({ name: text(s && s.name, 40), line: text(s && s.line, 80), logo: logo(s && s.logo) }))
    .filter(s => s.name || s.logo)
    .slice(0, MAX_SPONSORS);
  return { venue: text(b.venue, 60), logo: logo(b.logo), sponsors };
}

// The sponsor of a round: they take turns, round after round.
function sponsorFor(brand, roundIndex) {
  const list = brand && brand.sponsors;
  if (!list || !list.length || !(roundIndex >= 0)) return null;
  return list[roundIndex % list.length];
}

module.exports = { clean, sponsorFor, MAX_SPONSORS };
