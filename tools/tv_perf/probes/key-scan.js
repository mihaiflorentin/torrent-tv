// Harness probe (--init tools/tv_perf/probes/key-scan.js): what one D-pad press costs in the app's own keydown handler,
// and how much of that is the per-key scan of focusable elements (clients/tv/src/navigation.ts visibleFocusables).
// A capture listener on window runs before the app's document listener and a bubble listener on window after it, so
// their difference is the whole handler. The scan is then replayed on its own to price it.
(function () {
  var selector = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var probe = window.__tvprobe = { handlerMs: [], scanMs: [], scanned: [] };
  var start = 0;
  window.addEventListener('keydown', function (event) {
    if (!event.isTrusted) return;
    start = performance.now();
  }, true);
  window.addEventListener('keydown', function (event) {
    if (!event.isTrusted) return;
    probe.handlerMs.push(performance.now() - start);
    var scanStart = performance.now();
    var found = Array.prototype.slice.call(document.querySelectorAll(selector)).filter(function (element) { return element.offsetWidth > 0 && element.offsetHeight > 0; });
    probe.scanMs.push(performance.now() - scanStart);
    probe.scanned.push(found.length);
  }, false);
})();
