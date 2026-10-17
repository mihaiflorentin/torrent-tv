// Harness probe (--init tools/tv_perf/probes/landing-scans.js): how often the landing-focus watcher
// (clients/tv/src/landing.ts) wakes and rescans the page. It wraps the one MutationObserver the TV bundle creates and
// counts its callbacks, and counts the focusable-element scans (querySelectorAll with the navigation selector) made
// outside a keydown, which are the watcher's attempts. Multiply the scans by the per-scan cost the key-scan probe
// prints to price the watcher. (Stubbing the observer out instead changes where focus lands and so the whole journey,
// which makes the runs incomparable.)
(function () {
  var selector = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var probe = window.__tvprobe = { observerCallbacks: 0, landingScans: 0, keyScans: 0, landingScanMs: 0 };
  var inKey = false;
  window.addEventListener('keydown', function () { inKey = true; }, true);
  window.addEventListener('keydown', function () { inKey = false; }, false);
  var NativeObserver = window.MutationObserver;
  window.MutationObserver = function (callback) {
    return new NativeObserver(function (records, observer) { probe.observerCallbacks++; return callback(records, observer); });
  };
  var nativeAll = Document.prototype.querySelectorAll;
  Document.prototype.querySelectorAll = function (query) {
    if (query !== selector) return nativeAll.apply(this, arguments);
    var start = performance.now();
    var result = nativeAll.apply(this, arguments);
    if (inKey) probe.keyScans++; else { probe.landingScans++; probe.landingScanMs += performance.now() - start; }
    return result;
  };
})();
