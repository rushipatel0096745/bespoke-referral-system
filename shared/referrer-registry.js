// // ============================================================================
// // REFERRER REGISTRY - the lookup source for a slug -> referrer record.
// // ----------------------------------------------------------------------------
// // Strategy (from the brief, option B designing toward C):
// //   - PRIMARY:  Supabase table `referrer` (one row per Memory Catcher, zero
// //               deploy to add one).
// //   - FALLBACK: bundled JSON (referrers.json) so the route still works in local
// //               dev / preview before Supabase creds are wired.
// //
// // Env vars (set in Netlify > Site settings > Environment variables):
// //   SUPABASE_URL           https://<project>.supabase.co
// //   SUPABASE_ANON_KEY      anon/public key (read-only via RLS)
// //
// // The `referrer` table (see referral-schema.sql):
// //   slug (pk) | name | photo | offer | code | stripe_ref | active
// // ============================================================================

// import fallbackReferrers from "../data/referrers.json" assert { type: "json" };

// /**
//  * Return the referrer record for a slug, or null if not found.
//  * @param {string} slug   e.g. "salamata-bah"
//  * @param {object} context Netlify edge context (unused now; kept for geo etc.)
//  * @returns {Promise<object|null>}
//  */
// export async function getReferrer(slug, context) {
//   const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
//   const SUPABASE_ANON_KEY = Netlify.env.get("SUPABASE_ANON_KEY");

//   // --- Primary: Supabase REST (PostgREST). No SDK needed at the edge. ---
//   if (SUPABASE_URL && SUPABASE_ANON_KEY) {
//     const endpoint =
//       `${SUPABASE_URL}/rest/v1/referrer` +
//       `?slug=eq.${encodeURIComponent(slug)}` +
//       `&active=eq.true` +
//       `&select=slug,name,photo,offer,code,stripe_ref,active&limit=1`;

//     const res = await fetch(endpoint, {
//       headers: {
//         apikey: SUPABASE_ANON_KEY,
//         authorization: `Bearer ${SUPABASE_ANON_KEY}`,
//         accept: "application/json",
//       },
//     });

//     if (res.ok) {
//       const rows = await res.json();
//       if (Array.isArray(rows) && rows.length) return rows[0];
//       return null; // reached Supabase, genuinely no such active slug
//     }
//     // Non-OK (e.g. creds wrong) -> fall through to JSON so we degrade gracefully.
//     console.warn("Supabase referrer lookup non-OK:", res.status);
//   }

//   // --- Fallback: bundled JSON (local dev / before Supabase is live) ---
//   const rec = fallbackReferrers[slug];
//   return rec && rec.active !== false ? { slug, ...rec } : null;
// }

// Edge functions run in Deno — no `assert { type: "json" }` import syntax.
// We fetch the JSON fallback from our own origin instead.

const FALLBACK_URL = "/data/referrers.json";

/**
 * Return the referrer record for a slug, or null if not found.
 */
export async function getReferrer(slug, context) {
    const SUPABASE_URL = Netlify.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Netlify.env.get("SUPABASE_ANON_KEY");

    // --- Primary: Supabase REST ---
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const endpoint =
            `${SUPABASE_URL}/rest/v1/referrer` +
            `?slug=eq.${encodeURIComponent(slug)}` +
            `&active=eq.true` +
            `&select=slug,name,photo,offer,code,stripe_ref,active&limit=1`;

        const res = await fetch(endpoint, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                accept: "application/json",
            },
        });

        if (res.ok) {
            const rows = await res.json();
            if (Array.isArray(rows) && rows.length) return rows[0];
            return null;
        }
        console.warn("Supabase referrer lookup non-OK:", res.status);
    }

    // --- Fallback: fetch referrers.json from our own origin ---
    try {
        const origin = context?.url ? new URL(context.url).origin : "http://localhost:8888";

        const fallbackRes = await fetch(`${origin}${FALLBACK_URL}`);
        if (fallbackRes.ok) {
            const data = await fallbackRes.json();
            const rec = data[slug];
            return rec && rec.active !== false ? { slug, ...rec } : null;
        }
    } catch (err) {
        console.warn("JSON fallback fetch failed:", err.message);
    }

    return null;
}
