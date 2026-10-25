/* Backseat site: respect prefers-reduced-motion for the looping clips, and
   only play loops that are on screen. Everything works without this file. */
(function () {
  var loops = Array.prototype.slice.call(document.querySelectorAll('video[autoplay]'));
  if (!loops.length) return;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function safePlay(v) {
    try {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  var observer = null;

  function apply() {
    var reduce = !!(mq && mq.matches);
    loops.forEach(function (v) {
      if (reduce) {
        v.removeAttribute('autoplay');
        v.pause();
        v.controls = true; // visitor can start a clip by hand
      } else {
        v.controls = false;
      }
    });
    if (observer) { observer.disconnect(); observer = null; }
    if (!reduce && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) safePlay(e.target); else e.target.pause();
        });
      }, { threshold: 0.25 });
      loops.forEach(function (v) { observer.observe(v); });
    }
  }

  apply();
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }
})();
