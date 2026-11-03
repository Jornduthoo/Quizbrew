// Sound and picture effects for the big screen: music fragments (also growing bursts and backwards),
// the pixel fog that sharpens over time, and the "click to turn on sound" gate that browsers need once.
(function () {
  let audio = null;     // HTMLAudioElement for normal play
  let ctx = null;       // AudioContext, only for backwards play
  let source = null;
  let timers = [];
  let current = null;   // { src, start, end, effect }
  let lastStep = -1;
  let onBlocked = () => {};

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { while (timers.length) clearTimeout(timers.pop()); };

  function stop() {
    clearTimers();
    if (audio) { audio.pause(); }
    if (source) { try { source.stop(); } catch { /* already stopped */ } source = null; }
  }

  function element(src) {
    if (!audio) audio = new Audio();
    if (audio.dataset.src !== src) { audio.src = src; audio.dataset.src = src; audio.preload = 'auto'; }
    return audio;
  }

  // Play from `from` seconds for `seconds` (or until the clip end).
  function playClip(from, seconds) {
    stop();
    const a = element(current.src);
    const go = () => {
      a.currentTime = from;
      const p = a.play();
      if (p && p.catch) p.catch(() => onBlocked());
    };
    if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true });
    const until = current.end ? Math.min(seconds || Infinity, current.end - from) : seconds;
    if (until && Number.isFinite(until)) later(() => a.pause(), until * 1000);
  }

  async function playBackwards() {
    stop();
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      if (ctx.state === 'suspended') return onBlocked();
      const data = await fetch(current.src).then(r => r.arrayBuffer());
      const buf = await ctx.decodeAudioData(data);
      const startAt = current.start || 0;
      const endAt = current.end || buf.duration;
      const len = Math.max(1, Math.floor((endAt - startAt) * buf.sampleRate));
      const rev = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const src = buf.getChannelData(c).subarray(Math.floor(startAt * buf.sampleRate), Math.floor(startAt * buf.sampleRate) + len);
        const dst = rev.getChannelData(c);
        for (let i = 0; i < len; i++) dst[i] = src[len - 1 - i] || 0;
      }
      source = ctx.createBufferSource();
      source.buffer = rev;
      source.connect(ctx.destination);
      source.start();
    } catch (err) {
      console.warn('Backwards play failed, playing normally', err);
      playClip(current.start, null);
    }
  }

  // Bursts that grow: 1, 2, 4 and 8 seconds, one per step of the question.
  const BURSTS = [1, 2, 4, 8];

  const Media = {
    // A new question (or a reload during one). elapsedMs tells where the question is.
    start(q, elapsedMs) {
      stop();
      lastStep = -1;
      if (!q.audio) { current = null; return; }
      current = { src: q.audio, start: q.start || 0, end: q.end || null, effect: q.effect, steps: q.steps || 4, total: q.time * 1000 };
      if (q.effect === 'grow') return Media.tick(elapsedMs);
      if (q.effect === 'reverse') return playBackwards();
      playClip(current.start, null);
    },
    // Called while the clock runs; plays the next burst when a new step starts.
    tick(elapsedMs) {
      if (!current || current.effect !== 'grow') return;
      const step = Math.min(current.steps - 1, Math.floor(elapsedMs / (current.total / current.steps)));
      if (step !== lastStep) {
        lastStep = step;
        playClip(current.start, BURSTS[Math.min(step, BURSTS.length - 1)]);
      }
    },
    // After the reveal everyone hears the real thing, forwards and longer.
    reveal() {
      if (!current) return;
      if (current.effect === 'grow' || current.effect === 'reverse') playClip(current.start, 15);
    },
    replay() {
      if (!current) return;
      if (current.effect === 'reverse') playBackwards();
      else playClip(current.start, current.effect === 'grow' ? BURSTS[Math.max(0, lastStep)] : null);
    },
    stop,
    onBlocked(fn) { onBlocked = fn; },
    // A click on the page lets the browser play sound from now on.
    async unlock() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
      } catch { /* no web audio */ }
      if (audio) { audio.muted = false; }
    },
  };

  // Pixel fog: draw the picture in big blocks that get smaller until it is sharp.
  function pixelate(canvas, img, frac) {
    if (!img.complete || !img.naturalWidth) return;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    if (canvas.width !== w) { canvas.width = w; canvas.height = hgt; }
    const g = canvas.getContext('2d');
    // From 6 blocks across to the full picture; the last 15% of the time is sharp.
    const k = Math.min(1, frac / 0.85);
    const across = Math.round(6 * Math.pow(w / 6, k));
    const scale = Math.min(w / img.naturalWidth, hgt / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const sw = Math.max(1, Math.round(across * (dw / w)));
    const sh = Math.max(1, Math.round(sw * dh / dw));
    const tmp = pixelate.tmp || (pixelate.tmp = document.createElement('canvas'));
    tmp.width = sw;
    tmp.height = sh;
    tmp.getContext('2d').drawImage(img, 0, 0, sw, sh);
    g.clearRect(0, 0, w, hgt);
    g.imageSmoothingEnabled = k >= 1;
    g.drawImage(tmp, 0, 0, sw, sh, (w - dw) / 2, (hgt - dh) / 2, dw, dh);
    if (k >= 1) g.drawImage(img, (w - dw) / 2, (hgt - dh) / 2, dw, dh);
  }

  window.QBMedia = { Media, pixelate };
})();
