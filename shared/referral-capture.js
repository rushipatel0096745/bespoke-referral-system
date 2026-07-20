// ============================================================================
// REFERRAL CAPTURE (client-side) - keeps the referral alive across the visit.
// ----------------------------------------------------------------------------
// Loaded on EVERY page (add to shared <head> include), not just referral pages,
// because the buyer may land on /memory-catcher/dixit then browse to /our-kit
// before buying. This module makes sure the ref survives that journey.
//
// Sources of truth, most to least durable:
//   1. bfc_ref cookie  (set by the edge function; survives tab close, 30d)
//   2. localStorage    (mirror, easy JS read)
//   3. ?ref= query     (belt-and-braces if someone shares a ...?ref=dixit link)
//
// FIRST-TOUCH: we do NOT overwrite an existing ref. (DECISION #1.)
// ============================================================================

(function () {
  "use strict";

  var KEY = "bfc_ref";

  function readCookie(name) {
    var m = document.cookie.match(
      new RegExp("(?:^|; )" + name + "=([^;]*)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  function writeCookie(name, value, days) {
    var maxAge = days * 24 * 60 * 60;
    document.cookie =
      name + "=" + encodeURIComponent(value) +
      "; Path=/; Max-Age=" + maxAge + "; SameSite=Lax; Secure";
  }

  // Resolve the current ref, applying first-touch precedence.
  function resolveRef() {
    // 1. Already have one? Keep it (first-touch).
    var existing = readCookie(KEY) || localStorage.getItem(KEY);
    if (existing) return existing;

    // 2. On a referral page, the injected MEMORY_CATCHER carries stripe_ref.
    if (window.MEMORY_CATCHER && window.MEMORY_CATCHER.stripe_ref) {
      return window.MEMORY_CATCHER.stripe_ref;
    }

    // 3. ?ref= query param fallback.
    var q = new URLSearchParams(location.search).get("ref");
    if (q) return q.trim();

    return null;
  }

  var ref = resolveRef();
  if (ref) {
    // Persist to both stores so add-to-cart / checkout can always read it.
    writeCookie(KEY, ref, 30);
    try { localStorage.setItem(KEY, ref); } catch (e) {}
  }

  // Public accessor used by the add-to-cart + checkout code.
  window.BFCReferral = {
    get: function () {
      return readCookie(KEY) || localStorage.getItem(KEY) || null;
    },
    // Clear after a successful order so a later organic purchase isn't
    // mis-attributed. Call from the order-confirmation page.
    clear: function () {
      writeCookie(KEY, "", -1);
      try { localStorage.removeItem(KEY); } catch (e) {}
    },
  };
})();
