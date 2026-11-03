// Small sound effects for the big screen, made on the fly with Web Audio (no sound files, nothing to load).
// A clock tick in the last seconds, a chime at the reveal, a drum roll before the standings,
// a pluck when a team joins and a brass fanfare for the winner and the prizes.
// The quizmaster turns them off on the host page; the silent round twist and ?mute keep them quiet.
(function () {
  let ctx = null;
  let master = null;
  let on = true;
  let onBlocked = () => {};

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); if (ctx.state === 'suspended') { onBlocked(); return null; } }
    return ctx;
  }

  // One note: a wave with a quick attack and a soft tail.
  function note(freq, { at = 0, len = 0.25, type = 'triangle', vol = 0.35, slide = 0 } = {}) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  // A burst of noise through a filter: drum hits and cymbals.
  let noiseBuf = null;
  function noise({ at = 0, len = 0.12, vol = 0.3, freq = 1800, type = 'bandpass', q = 0.8 } = {}) {
    const c = audio();
    if (!c) return;
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = c.currentTime + at;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + len + 0.05);
  }

  const SFX = {
    set enabled(v) { on = !!v; },
    get enabled() { return on; },
    onBlocked(fn) { onBlocked = fn; },
    unlock() { return audio() ? ctx.resume() : Promise.resolve(); },

    // The last seconds of a question: a wooden tick, a bit higher on the final three.
    tick(secondsLeft) {
      if (!on) return;
      note(secondsLeft <= 3 ? 1320 : 990, { len: 0.06, type: 'square', vol: 0.12 });
      noise({ len: 0.03, vol: 0.12, freq: 3500 });
    },
    // The answer comes out: a bright two-note chime.
    reveal() {
      if (!on) return;
      note(659, { len: 0.35, vol: 0.3 });
      note(988, { at: 0.11, len: 0.6, vol: 0.3 });
      note(1976, { at: 0.11, len: 0.5, type: 'sine', vol: 0.08 });
    },
    // A drum roll that speeds up, then a cymbal: before the standings.
    roll(seconds = 1.6) {
      if (!on) return;
      let at = 0;
      let gap = 0.09;
      while (at < seconds) { noise({ at, len: 0.07, vol: 0.18 + at * 0.08, freq: 900, q: 1.2 }); at += gap; gap = Math.max(0.035, gap * 0.94); }
      noise({ at: seconds, len: 1.4, vol: 0.32, freq: 6000, type: 'highpass', q: 0.3 });
      note(98, { at: seconds, len: 0.5, type: 'sine', vol: 0.4, slide: 0.6 });
    },
    // A team joins: a soft pluck, a little higher for every team.
    join(n = 0) {
      if (!on) return;
      const scale = [523, 587, 659, 784, 880, 1047, 1175, 1319];
      note(scale[n % scale.length], { len: 0.3, type: 'triangle', vol: 0.22 });
    },
    // The winner: a short brass fanfare.
    fanfare() {
      if (!on) return;
      [[392, 0], [523, 0.14], [659, 0.28], [784, 0.42], [1047, 0.62]].forEach(([f, at], i) => {
        note(f, { at, len: i === 4 ? 1.2 : 0.22, type: 'sawtooth', vol: 0.13 });
        note(f / 2, { at, len: i === 4 ? 1.2 : 0.22, type: 'triangle', vol: 0.12 });
      });
      noise({ at: 0.62, len: 1.2, vol: 0.2, freq: 7000, type: 'highpass', q: 0.3 });
    },
    // A prize lands.
    award() {
      if (!on) return;
      note(784, { len: 0.18, vol: 0.22 });
      note(1175, { at: 0.09, len: 0.5, vol: 0.22 });
      note(1568, { at: 0.18, len: 0.6, type: 'sine', vol: 0.1 });
    },
  };

  window.SFX = SFX;
})();
