/* Backseat site video behaviour. Everything works without this file (videos then show native controls).
   One rule for every <video> on the page: when one starts, every other one pauses.
   Plays and pauses the page makes itself (on-screen autoplay, hover, off-screen pause, the one-at-a-time rule) are
   "automatic"; anything else (the Play/Pause button, native controls, the demo button, Enlarge) is the visitor's.
   - An automatic start never interrupts a video the visitor started, so scrolling past the summary video on the way
     to the full demo does not stop the demo.
   - A visitor's pause sticks, whichever control they used: scrolling away and back does not restart the video.
   - video[data-play="auto"]: muted loop that plays while on screen; reduced motion → starts paused.
   - video[data-play="hover"]: plays on hover or with its button.
   - any other video (the full demo): plays only when asked, and pauses when it scrolls out of view.
   - a[data-sound-target]: jumps to that video and plays it with sound.
   Touch screens keep the native controls (scrub, fullscreen); with a mouse each clip gets Play/Pause and Enlarge. */
(function () {
  document.documentElement.classList.add('js');
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = function () { return !!(mq && mq.matches); };
  var touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  var videos = Array.prototype.slice.call(document.querySelectorAll('video'));
  var userVideo = null; // the video the visitor started last

  // Automatic play/pause: counted, so the play/pause listeners can tell them apart from the visitor's.
  function autoPlay(v) {
    if (!v.paused) return;
    if (userVideo && userVideo !== v && !userVideo.paused) return; // never interrupt the visitor's choice
    v._autoPlays = (v._autoPlays || 0) + 1;
    try {
      var p = v.play();
      // a refused autoplay is not the visitor pausing
      if (p && p.catch) p.catch(function () { v._userPaused = false; });
    } catch (e) {}
  }
  function autoPause(v) {
    if (v.paused) return;
    v._autoPauses = (v._autoPauses || 0) + 1;
    v.pause();
  }
  function userPlay(v) {
    try {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  videos.forEach(function (v) {
    v._userPaused = false;
    v.addEventListener('play', function () {
      if (v._autoPlays > 0) v._autoPlays--;
      else { userVideo = v; v._userPaused = false; }
      videos.forEach(function (o) { if (o !== v) autoPause(o); });
    });
    v.addEventListener('pause', function () {
      if (v._autoPauses > 0) v._autoPauses--;
      else if (!v.ended) v._userPaused = true;
      setTimeout(resumeAuto, 0);
    });
  });

  // When nothing plays any more (the demo scrolled away, say), an on-screen autoplay video starts again. Its own
  // start may have been refused a moment earlier while the visitor's video was still playing.
  function resumeAuto() {
    if (reduced() || videos.some(function (o) { return !o.paused; })) return;
    videos.forEach(function (o) {
      if (o.getAttribute('data-play') === 'auto' && o._onScreen && !o._userPaused) autoPlay(o);
    });
  }

  function enterFullscreen(v) {
    if (v.requestFullscreen) v.requestFullscreen().catch(function () {});
    else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
  }
  document.addEventListener('fullscreenchange', function () {
    // native controls while enlarged, so the visitor can scrub and leave fullscreen
    videos.forEach(function (v) { if (v.hasAttribute('data-play')) v.controls = touch || document.fullscreenElement === v; });
  });

  videos.forEach(function (v) {
    var mode = v.getAttribute('data-play');
    var btn = v.parentNode.querySelector('.vid-toggle');

    if (!mode) {
      // the full demo: keeps its controls; stop it once it leaves the screen so it never plays unseen
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { if (!e.isIntersecting) autoPause(v); });
        }, { threshold: 0 }).observe(v);
      }
      return;
    }

    v.removeAttribute('autoplay');
    v.controls = touch;
    if (touch) {
      if (btn) btn.hidden = true;
    } else {
      var big = document.createElement('button');
      big.type = 'button';
      big.className = 'vid-enlarge';
      big.textContent = document.documentElement.getAttribute('data-enlarge-label') || 'Enlarge';
      big.addEventListener('click', function () { enterFullscreen(v); userPlay(v); });
      v.parentNode.appendChild(big);
    }

    function label() {
      if (!btn) return;
      var playing = !v.paused;
      btn.textContent = playing ? btn.getAttribute('data-pause-label') : btn.getAttribute('data-play-label');
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    }
    v.addEventListener('play', label);
    v.addEventListener('pause', label);

    if (btn) {
      btn.addEventListener('click', function () { if (v.paused) userPlay(v); else v.pause(); });
    }
    if (mode === 'hover' && !touch) {
      var fig = v.parentNode;
      fig.addEventListener('mouseenter', function () { if (!reduced() && !v._userPaused) autoPlay(v); });
      // a clip the visitor started keeps playing after the mouse leaves
      fig.addEventListener('mouseleave', function () { if (userVideo !== v && document.fullscreenElement !== v) autoPause(v); });
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          v._onScreen = e.isIntersecting;
          if (!e.isIntersecting) { if (document.fullscreenElement !== v) autoPause(v); return; }
          if (mode === 'auto' && !reduced() && !v._userPaused) autoPlay(v);
        });
      }, { threshold: 0.2 }).observe(v);
    } else if (mode === 'auto' && !reduced()) {
      autoPlay(v);
    }
    label();
  });

  Array.prototype.slice.call(document.querySelectorAll('a[data-sound-target]')).forEach(function (a) {
    a.addEventListener('click', function () {
      var v = document.getElementById(a.getAttribute('data-sound-target'));
      if (!v) return;
      v.muted = false;
      userPlay(v); // the visitor's choice: automatic starts on the way down cannot stop it
    });
  });

  if (mq) {
    var onChange = function () { if (reduced()) videos.forEach(function (v) { autoPause(v); }); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();
