// Keep this phone's screen on (the quizmaster's remote). Two ways:
// 1. The Screen Wake Lock API: only in a secure context (https or localhost), so often not on http://10.x.x.x.
// 2. Fallback: a tiny silent video playing in a loop keeps phones awake too. It may only start after a tap.
(function () {
  let lock = null;
  let video = null;

  async function viaLock() {
    if (!('wakeLock' in navigator) || !window.isSecureContext) return false;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
      return true;
    } catch { return false; }
  }

  function viaVideo() {
    if (!video) {
      video = document.createElement('video');
      video.className = 'awake-video';
      video.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:-1';
      video.muted = true;
      video.loop = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-hidden', 'true');
      // Ten minutes of black at 1 frame a second (60 kB). No jumping back in time: every seek or loop restart
      // makes Android redraw the video layer, and that flickered the whole screen every two seconds.
      video.src = '/img/awake.mp4';
      document.body.append(video);
    }
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
  }

  async function keepAwake() {
    if (document.hidden || lock) return;
    if (!(await viaLock())) viaVideo();
  }

  keepAwake();
  // A tap may be needed before a video can play, and a lock is let go when the page is hidden.
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, keepAwake, { passive: true });
  document.addEventListener('visibilitychange', keepAwake);
  window.QBAwake = { keepAwake, state: () => (lock ? 'lock' : video && !video.paused ? 'video' : 'none') };
})();
