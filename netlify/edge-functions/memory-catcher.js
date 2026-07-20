// ============================================================================
// EDGE FUNCTION - dynamic referral route  (/memory-catcher/:slug)
// ----------------------------------------------------------------------------
// Serves EVERY referral URL from ONE shared template. No per-page files.
//
//   /memory-catcher/salamata-bah   ->  looks up "salamata-bah"
//   /memory-catcher/dixit          ->  looks up "dixit"
//
// What it does, in order:
//   1. Pull the slug from the path.
//   2. Look the slug up in the referrer registry (Supabase, with a JSON
//      fallback for local dev - see getReferrer()).
//   3a. FOUND  -> inject that referrer's data into the HTML template, set a
//               first-party `bfc_ref` cookie (survives navigation), return HTML.
//   3b. UNKNOWN -> serve the generic Order page (so a mistyped link still sells).
//               <-- DECISION #3 in the brief: generic vs hard 404. Currently generic.
//
// Deploy: place at  netlify/edge-functions/memory-catcher.js  in the repo root.
// The `config.path` below binds it to the route - no _redirects entry needed.
// ============================================================================

import { getReferrer } from "../../shared/referrer-registry.js";
import { renderReferralPage } from "../../shared/render-template.js";

export const config = {
  path: "/memory-catcher/*",
};

// How long the referral attribution lasts (DECISION #2 in the brief).
const REF_COOKIE_DAYS = 30;

export default async function handler(request, context) {
  const url = new URL(request.url);

  // 1. Extract slug: everything after /memory-catcher/
  //    "/memory-catcher/salamata-bah" -> "salamata-bah"
  const slug = url.pathname
    .replace(/^\/memory-catcher\/?/, "")
    .replace(/\/+$/, "")
    .toLowerCase()
    .trim();

  // No slug at all ("/memory-catcher") -> generic page, no attribution.
  if (!slug) {
    return context.rewrite("/our-kit");
  }

  // 2. Look up the referrer.
  let referrer;
  try {
    referrer = await getReferrer(slug, context);
  } catch (err) {
    // Registry failure should never take the page down - log and fall back.
    console.error("referrer lookup failed:", err);
    referrer = null;
  }

  // 3b. Unknown slug -> generic Order page (DECISION #3: generic, not 404).
  if (!referrer || referrer.active === false) {
    return context.rewrite("/our-kit");
  }

  // 3a. Known referrer -> render the shared template with their data.
  const html = await renderReferralPage(referrer, { context, slug, request });

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    // Do not cache per-referrer HTML at the edge (each slug differs).
    "cache-control": "no-store",
  });

  // Set the first-party attribution cookie. FIRST-TOUCH: only set it if not
  // already present, so the person who introduced the buyer keeps the credit.
  // (DECISION #1 in the brief. Flip to always-set for last-touch.)
  const existing = request.headers.get("cookie") || "";
  const hasRef = /(?:^|;\s*)bfc_ref=/.test(existing);
  if (!hasRef) {
    const maxAge = REF_COOKIE_DAYS * 24 * 60 * 60;
    headers.append(
      "set-cookie",
      `bfc_ref=${encodeURIComponent(referrer.stripe_ref)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`
    );
  }

  return new Response(html, { status: 200, headers });
}
