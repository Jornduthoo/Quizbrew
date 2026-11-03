// Quizbrew effects: ambient light particles and bursts (confetti, sparks) on two light canvases.
// Built for cheap laptops and old phones: one glow sprite drawn with drawImage, no shadowBlur,
// max 30 fps, fewer particles on weak devices, paused when the tab is hidden, off with reduced motion.
// Add ?fx=off|low|high to the URL to force a level.
(function () {
  const forced = (location.search.match(/[?&]fx=(off|low|high)/) || [])[1];
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weak = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory || 4) <= 2;
  const quality = forced || (reduced ? 'off' : weak ? 'low' : 'high');
  document.documentElement.classList.add('fx-' + quality);

  const FX = { quality, ambient() {}, confetti() {}, sparks() {}, rain() {}, clear() {} };
  window.FX = FX;
  if (quality === 'off') return;

  const DPR = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
  const FRAME = 1000 / 30;
  const PALETTE = ['#ffb43c', '#ff4fa3', '#3ee6ff', '#a8ff3e', '#f6d48c', '#b07cff'];

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

  // Ambient modes. dust: warm motes floating up. bubbles: beer bubbles rising. embers: gold sparkles.
  const MODES = {
    dust: { n: 46, colors: ['#ffb43c', '#f6d48c', '#ffcf8a'], size: [3, 9], vy: [-6, -18], vx: 6, alpha: [0.15, 0.5] },
    bubbles: { n: 46, colors: ['#ffd27a', '#f6d48c', '#ff9fd0', '#9feaff'], size: [5, 18], vy: [-18, -50], vx: 4, alpha: [0.3, 0.7], ring: true },
    embers: { n: 70, colors: ['#ffcf5a', '#ffb43c', '#fff0b0', '#ff4fa3'], size: [3, 10], vy: [-10, -30], vx: 10, alpha: [0.25, 0.8] },
    stage: { n: 28, colors: ['#ffe2a8', '#f6d48c'], size: [2, 6], vy: [-3, -9], vx: 5, alpha: [0.15, 0.45] },
  };
  let mode = null;
  let motes = [];
  function spawnMote(m, anywhere) {
    return {
      x: rnd(0, W), y: anywhere ? rnd(0, H) : H + 20,
      s: rnd(m.size[0], m.size[1]), vy: rnd(m.vy[0], m.vy[1]), vx: rnd(-m.vx, m.vx),
      a: rnd(m.alpha[0], m.alpha[1]), c: pick(m.colors), ph: rnd(0, 6.28), tw: rnd(0.5, 1.6),
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

  // Paper confetti from a point (x, y in px), shot upwards.
  FX.confetti = function ({ x = W / 2, y = H / 2, colors = PALETTE, count = 120, spread = 1, dir = -Math.PI / 2, cone = Math.PI * 0.4 } = {}) {
    for (let i = 0; i < count * scale; i++) {
      const ang = dir + rnd(-cone, cone);
      const sp = rnd(250, 750) * spread;
      add({ k: 'paper', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 900, drag: 1.6, c: pick(colors), w: rnd(6, 12), h: rnd(4, 8), r: rnd(0, 6.28), vr: rnd(-12, 12), life: rnd(2.2, 3.6) });
    }
    wake();
  };
  // Confetti falling from the top of the screen for a while.
  FX.rain = function ({ colors = PALETTE, seconds = 4, perSecond = 90 } = {}) {
    rainLeft = seconds; rainRate = perSecond * scale; rainColors = colors;
    wake();
  };
  let rainLeft = 0, rainRate = 0, rainColors = PALETTE;
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
  FX.clear = function () { bits = []; rainLeft = 0; front.ctx.clearRect(0, 0, W, H); };

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
    if (motes.length || bits.length || rainLeft > 0) raf = requestAnimationFrame(loop);
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
      if (m.ring) {
        // A bubble: thin ring with a small highlight.
        const r = p.s * 0.6;
        g.strokeStyle = p.c; g.lineWidth = 1.6;
        g.beginPath(); g.arc(p.x, p.y, r, 0, 6.28); g.stroke();
        g.drawImage(glow(p.c), p.x - r * 0.9, p.y - r * 0.9, r * 0.9, r * 0.9);
      } else {
        const d = p.s * 3;
        g.drawImage(glow(p.c), p.x - d / 2, p.y - d / 2, d, d);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function drawBits(dt) {
    const g = front.ctx;
    if (rainLeft > 0) {
      rainLeft -= dt;
      for (let i = 0; i < rainRate * dt; i++) {
        add({ k: 'paper', x: rnd(0, W), y: -20, vx: rnd(-60, 60), vy: rnd(80, 260), g: 260, drag: 0.6, c: pick(rainColors), w: rnd(7, 13), h: rnd(4, 8), r: rnd(0, 6.28), vr: rnd(-8, 8), life: 6 });
      }
    }
    if (!bits.length) { g.clearRect(0, 0, W, H); return; }
    g.clearRect(0, 0, W, H);
    const keep = [];
    for (const p of bits) {
      p.life -= dt;
      if (p.life <= 0 || p.y > H + 40) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'paper') {
        p.r += p.vr * dt;
        g.globalAlpha = Math.min(1, p.life * 1.5);
        g.fillStyle = p.c;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r);
        g.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.r * 1.7)), p.w, p.h * Math.abs(Math.cos(p.r * 1.7)) + 0.5);
        g.restore();
      } else {
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
