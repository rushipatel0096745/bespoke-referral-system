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
  // Fetch the static template from our own origin (Netlify serves it).
  const templateRes = await context.next
    ? await fetchTemplateViaNext(context)
    : await fetch(new URL(TEMPLATE_URL_PATH, "https://www.thebespokefoilcompany.co.uk"));

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
  const re = new RegExp(
    escapeRegExp(DATA_OPEN) + "[\\s\\S]*?" + escapeRegExp(DATA_CLOSE)
  );
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

// Fetch the template through the edge context so we hit the deployed static file.
async function fetchTemplateViaNext(context) {
  const req = new Request(
    new URL(TEMPLATE_URL_PATH, "https://www.thebespokefoilcompany.co.uk")
  );
  return context.next(req);
}

// --- tiny escapers (no deps at the edge) ---
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
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



