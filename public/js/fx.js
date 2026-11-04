// Quizbrew effects: ambient light particles and bursts made of light only (sparks, glints): nothing falls on two light canvases.
// Built for cheap laptops and old phones: one glow sprite drawn with drawImage, no shadowBlur,
// max 30 fps, fewer particles on weak devices, paused when the tab is hidden, off with reduced motion.
// Add ?fx=off|low|high to the URL to force a level.
(function () {
  const forced = (location.search.match(/[?&]fx=(off|low|high)/) || [])[1];
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;
  const quality = forced || (reduced ? 'off' : weak ? 'low' : 'high');
  document.documentElement.classList.add('fx-' + quality);

  const noop = () => {};
  const FX = { quality, ambient: noop, sparks: noop, sparksAt: noop, glints: noop, celebrate: noop, confetti: noop, rain: noop, swarm: noop, clear: noop };
  window.FX = FX;
  if (quality === 'off') return;

  const DPR = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
  const FRAME = 1000 / 30;

  function layer(cls) {
    const c = document.createElement('canvas');
    c.className = 'fx-canvas ' + cls;
    c.setAttribute('aria-hidden', 'true');
    document.body.prepend(c);
    return { c, ctx: c.getContext('2d') };
  }
  const back = layer('fx-back'); // ambient, behind the content
  const front = layer('fx-front'); // bursts, over the content
  let W = 0, H = 0;
  function resize() {
    W = innerWidth; H = innerHeight;
    for (const l of [back, front]) {
      l.c.width = Math.round(W * DPR); l.c.height = Math.round(H * DPR);
      l.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
  }
  addEventListener('resize', resize);
  resize();

  // A soft round glow, pre-rendered once per colour.
  const sprites = {};
  function glow(color) {
    if (sprites[color]) return sprites[color];
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, color);
    r.addColorStop(0.5, color + '55');
    r.addColorStop(1, color + '00');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return (sprites[color] = s);
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const scale = quality === 'high' ? 1 : 0.45;

  // Ambient modes. dust: warm motes floating up. lights: soft coloured bokeh. embers: gold sparkles.
  const MODES = {
    dust: { n: 46, colors: ['#ffb43c', '#f6d48c', '#ffcf8a'], size: [3, 9], vy: [-6, -18], vx: 6, alpha: [0.15, 0.5] },
    lights: { n: 50, colors: ['#ffb43c', '#f6d48c', '#ff9fd0', '#9feaff'], size: [4, 14], vy: [-5, -16], vx: 8, alpha: [0.15, 0.55] },
    embers: { n: 70, colors: ['#ffcf5a', '#ffb43c', '#fff0b0', '#ff4fa3'], size: [3, 10], vy: [-10, -30], vx: 10, alpha: [0.25, 0.8] },
    swarm: { n: 160, colors: ['#ffcf5a', '#ffb43c', '#fff0b0', '#f6d48c'], size: [3, 12], vy: [-25, -70], vx: 14, alpha: [0.3, 0.9] },
    stage: { n: 28, colors: ['#ffe2a8', '#f6d48c'], size: [2, 6], vy: [-3, -9], vx: 5, alpha: [0.15, 0.45] },
  };
  // Some looks tint the ambient light: snow glints, disco pink and gold, lantern light, floodlight white, gala gold.
  const TINTS = {
    winter: ['#ffffff', '#dfefff', '#ffcf8a', '#c9e4ff'],
    disco: ['#ff3ea5', '#ffcf3a', '#ff8c28', '#c86eff'],
    beach: ['#ffc46b', '#ff9a5a', '#fff0c0', '#2fe0d0'],
    stadium: ['#ffffff', '#fff3c0', '#ffc21a'],
    gala: ['#e2bd6b', '#f7e2aa', '#fff6dc'],
  };
  const tint = () => TINTS[document.documentElement.dataset.look];
  let mode = null;
  let motes = [];
  function spawnMote(m, anywhere) {
    return {
      x: rnd(0, W), y: anywhere ? rnd(0, H) : H + 20,
      s: rnd(m.size[0], m.size[1]), vy: rnd(m.vy[0], m.vy[1]), vx: rnd(-m.vx, m.vx),
      a: rnd(m.alpha[0], m.alpha[1]), c: pick(tint() || m.colors), ph: rnd(0, 6.28), tw: rnd(0.5, 1.6),
    };
  }
  FX.ambient = function (name) {
    if (name === mode) return;
    mode = name;
    const m = MODES[name];
    motes = m ? Array.from({ length: Math.round(m.n * scale) }, () => spawnMote(m, true)) : [];
    if (!m) back.ctx.clearRect(0, 0, W, H);
    wake();
  };

  // Bursts.
  let bits = [];
  const MAX_BITS = quality === 'high' ? 600 : 180;
  function add(p) { if (bits.length < MAX_BITS) bits.push(p); }

  // Light only, nothing falls: rising gold glints, and a burst of brass sparks.
  // Golden light motes welling up from a point (or a line of width w) and fading as they rise.
  FX.glints = function ({ x = W / 2, y = H / 2, width = 0, count = 50, colors = ['#ffcf5a', '#fff0b0', '#f6d48c'] } = {}) {
    for (let i = 0; i < count * scale; i++) {
      add({ k: 'glint', x: x + rnd(-width / 2, width / 2), y: y + rnd(-8, 8), vx: rnd(-50, 50), vy: rnd(-260, -70), g: -20, drag: 1.4, c: pick(colors), s: rnd(8, 22), ph: rnd(0, 6.28), life: rnd(1.2, 2.6) });
    }
    wake();
  };
  // A celebration made of light: a big spark burst plus glints rising. Kept under the old name too.
  FX.celebrate = FX.confetti = function ({ x = W / 2, y = H / 2, colors, count = 80 } = {}) {
    const c = colors && colors[0] ? colors[0] : '#ffcf5a';
    FX.sparks({ x, y, color: '#ffcf5a', count: count * 0.6, speed: 1.3 });
    FX.sparks({ x, y, color: c, count: count * 0.4, speed: 1 });
    FX.glints({ x, y, width: 160, count: count * 0.5 });
  };
  // For a while, the ambient particles turn into a thick swarm of embers.
  FX.rain = FX.swarm = function ({ seconds = 5 } = {}) {
    const before = mode;
    FX.ambient(null); FX.ambient('swarm');
    setTimeout(() => { if (mode === 'swarm') FX.ambient(before === 'swarm' ? 'embers' : before); }, seconds * 1000);
  };
  // Glowing sparks from a point, all directions.
  FX.sparks = function ({ x = W / 2, y = H / 2, color = '#ffb43c', count = 40, speed = 1 } = {}) {
    for (let i = 0; i < count * scale; i++) {
      const ang = rnd(0, 6.28);
      const sp = rnd(120, 520) * speed;
      add({ k: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 380, drag: 2.4, c: Math.random() < 0.3 ? '#fff0c8' : color, s: rnd(6, 16), life: rnd(0.6, 1.3) });
    }
    wake();
  };
  // Sparks from the centre of an element.
  FX.sparksAt = function (el, opts) {
    if (!el) return;
    const b = el.getBoundingClientRect();
    FX.sparks({ x: b.left + b.width / 2, y: b.top + b.height / 2, ...opts });
  };
  FX.clear = function () { bits = []; front.ctx.clearRect(0, 0, W, H); };

  // One loop for both layers. It stops itself when there is nothing to draw.
  let raf = 0, last = 0, acc = 0;
  function wake() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(loop); } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  function loop(now) {
    raf = 0;
    if (document.hidden) return;
    acc += now - last; last = now;
    if (acc >= FRAME) {
      const dt = Math.min(acc, 100) / 1000;
      acc = 0;
      drawAmbient(dt, now / 1000);
      drawBits(dt);
    }
    if (motes.length || bits.length) raf = requestAnimationFrame(loop);
  }

  function drawAmbient(dt, t) {
    const m = MODES[mode];
    if (!m) return;
    const g = back.ctx;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < motes.length; i++) {
      const p = motes[i];
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(t * p.tw + p.ph) * 8) * dt;
      if (p.y < -30) motes[i] = spawnMote(m, false);
      const a = p.a * (0.6 + 0.4 * Math.sin(t * p.tw * 2 + p.ph));
      g.globalAlpha = a;
      const d = p.s * 3;
      g.drawImage(glow(p.c), p.x - d / 2, p.y - d / 2, d, d);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function drawBits(dt) {
    const g = front.ctx;
    if (!bits.length) { g.clearRect(0, 0, W, H); return; }
    g.clearRect(0, 0, W, H);
    const keep = [];
    for (const p of bits) {
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 40 || p.y < -60) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'glint') {
        p.x += Math.sin(p.life * 6 + p.ph) * 20 * dt;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, p.life) * (0.6 + 0.4 * Math.sin(p.life * 14 + p.ph));
        g.drawImage(glow(p.c), p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        g.globalCompositeOperation = 'source-over';      } else {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, p.life * 1.8);
        const d = p.s * Math.min(1, p.life + 0.3);
        g.drawImage(glow(p.c), p.x - d / 2, p.y - d / 2, d, d);
        g.globalCompositeOperation = 'source-over';
      }
      keep.push(p);
    }
    g.globalAlpha = 1;
    bits = keep;
  }
})();
