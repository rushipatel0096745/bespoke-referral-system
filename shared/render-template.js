// ============================================================================
// RENDER TEMPLATE - inject a referrer's data into the shared referral page.
// ----------------------------------------------------------------------------
// We reuse the EXISTING Salamata layout as the master template. It is already
// parametrised from a single `MEMORY_CATCHER` object, so "rendering" = fetching
// that template and swapping in this referrer's data + making the slug
// available throughout the page.
//
// The template file lives at /referral-template.html (a copy of the current
// memory-catcher-salamata-bah.html with the hard-coded MEMORY_CATCHER object
// replaced by the placeholder token below). See MIGRATION note at the bottom.
// ============================================================================

const TEMPLATE_URL_PATH = "/referral-template.html";

// The placeholder we look for in the template and replace with real data.
// In referral-template.html the per-referrer object is written as:
//     const MEMORY_CATCHER = /*__MC_DATA__*/ null /*__END_MC_DATA__*/;
const DATA_OPEN = "/*__MC_DATA__*/";
const DATA_CLOSE = "/*__END_MC_DATA__*/";

/**
 * @param {object} referrer  row from the registry (name, photo, offer, code, stripe_ref)
 * @param {object} opts       { context, slug }
 * @returns {Promise<string>} full HTML
 */
export async function renderReferralPage(referrer, { context, slug }) {
    const templateRes = await fetchTemplate(context);

    let html = await templateRes.text();

    // The object we inject. Only safe, display + attribution fields - never
    // anything sensitive. `ref` (the slug) and `stripe_ref` travel with the page.
    const mcData = {
        slug,
        ref: slug,
        name: referrer.name || "your Memory Catcher",
        photo: referrer.photo || "/assets/mc-ashley.webp",
        offer: referrer.offer || "",
        code: referrer.code || "",
        stripe_ref: referrer.stripe_ref, // read by the add-to-cart flow
    };

    const injected = `${DATA_OPEN} ${JSON.stringify(mcData)} ${DATA_CLOSE}`;

    // Replace the placeholder block:  /*__MC_DATA__*/ ... /*__END_MC_DATA__*/
    const re = new RegExp(escapeRegExp(DATA_OPEN) + "[\\s\\S]*?" + escapeRegExp(DATA_CLOSE));
    if (re.test(html)) {
        html = html.replace(re, injected);
    } else {
        // Template not migrated yet - fail loud in logs, still serve the page.
        console.error("referral-template.html missing MC_DATA placeholder");
    }

    // Also expose the slug as a body data attribute + <title> personalisation,
    // so it is genuinely available "throughout the page" (CSS, JS, analytics).
    html = html
        .replace("<body", `<body data-ref="${escapeAttr(slug)}"`)
        .replace(
            /<title>[\s\S]*?<\/title>/,
            `<title>Order Your Kit with ${escapeHtml(mcData.name)} | Bespoke Foil Company</title>`
        );

    return html;
}

/**
 * Fetch the referral-template.html.
 *
 * Production (Netlify Edge): uses context.next() so the request is resolved
 * by Netlify's CDN on the same host — no cross-origin fetch needed.
 *
 * Local dev (netlify dev): context.next() resolves to localhost; the static
 * server on :8888 or :3999 serves the file directly.
 */
async function fetchTemplate(context) {
    // context.next() works in both production and local netlify dev.
    if (context?.next) {
        try {
            // Netlify ignores the hostname in context.next() — only the path matters.
            // We use a dummy base so new URL() is satisfied.
            const req = new Request(new URL(TEMPLATE_URL_PATH, "http://localhost"));
            const res = await context.next(req);
            if (res.ok) return res;
            console.warn("context.next() returned non-OK for template:", res.status);
        } catch (err) {
            console.warn("context.next() threw for template fetch:", err.message);
        }
    }

    // Hard fallback for local dev without a full context (e.g. unit tests).
    const origins = ["http://localhost:8888", "http://localhost:3999"];
    for (const origin of origins) {
        try {
            const res = await fetch(`${origin}${TEMPLATE_URL_PATH}`);
            if (res.ok) return res;
        } catch (_) {
            // try next origin
        }
    }

    throw new Error(
        "Could not load referral-template.html — " +
        "make sure it exists at the repo root and is published by Netlify."
    );
}

// --- tiny escapers (no deps at the edge) ---
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeHtml(s) {
    return String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
}
function escapeAttr(s) {
    return escapeHtml(s).replace(/\s+/g, "-");
}

// ----------------------------------------------------------------------------
// MIGRATION (one-off, for Dixit):
//   1. Copy memory-catcher-salamata-bah.html  ->  referral-template.html
//   2. In it, replace the hard-coded object:
//         const MEMORY_CATCHER = { name:"Salamata", ... };
//      with the placeholder:
//         const MEMORY_CATCHER = /*__MC_DATA__*/ null /*__END_MC_DATA__*/;
//   3. Everything else in that file (renderMemoryCatcher(), the markup) stays.
//   4. Delete the old per-person static files once the dynamic route is verified.
// ----------------------------------------------------------------------------
