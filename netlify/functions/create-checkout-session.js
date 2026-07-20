// ============================================================================
// NETLIFY FUNCTION - create a Stripe Checkout Session (with referral metadata)
// ----------------------------------------------------------------------------
// This is the heart of the attribution: the referral `stripe_ref` is written
// to metadata on BOTH the Checkout Session and the PaymentIntent, so it shows
// up cleanly in Stripe reporting AND on the webhook that credits commission.
//
// Env vars (Netlify > Environment variables):
//   STRIPE_SECRET_KEY        sk_live_... / sk_test_...
//
// Prices: define your real Stripe Price IDs in PRICE_MAP below (or look them
// up from Supabase). NEVER trust the price sent by the browser - map by kit.
//
// Deploy: netlify/functions/create-checkout-session.js
// Endpoint: POST /.netlify/functions/create-checkout-session
// ============================================================================

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// Map internal kit ids -> real Stripe Price IDs (server-authoritative pricing).
// Replace with your actual price_... IDs once the products exist in Stripe.
const PRICE_MAP = {
  foil: "price_1Tv82DGlsKiCC9t5yG8Li60d",
  framed: "price_1Tv83DGlsKiCC9t553SXHwCb",
  premium: "price_1Tv83eGlsKiCC9t5YMuVrEPa",
};

const SITE = "https://www.thebespokefoilcompany.co.uk";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Bad JSON" };
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return { statusCode: 400, body: "No items" };
  }

  // The referral. May be null (organic purchase) - that's fine, we record it
  // as "organic" rather than leaving it blank, so reporting is unambiguous.
  const referrer = (body.referrer && String(body.referrer).slice(0, 120)) || "organic";

  // Build Stripe line items from server-side prices (ignore browser prices).
  const line_items = [];
  for (const it of items) {
    const price = PRICE_MAP[it.kit];
    if (!price) {
      return { statusCode: 400, body: `Unknown kit: ${it.kit}` };
    }
    line_items.push({ price, quantity: 1 });
  }

  // Options like colour/frame/personalisation are captured as metadata too,
  // so fulfilment sees them. Kept compact (Stripe metadata: 500 chars/value).
  const optionMeta = {};
  items.forEach((it, i) => {
    optionMeta[`item${i}_kit`] = it.kit || "";
    optionMeta[`item${i}_pers`] = it.personalisation || "later";
    if (it.options) {
      optionMeta[`item${i}_opts`] = JSON.stringify(it.options).slice(0, 480);
    }
  });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url: `${SITE}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE}/our-kit`,

      // ---- REFERRAL ATTRIBUTION ----
      // On the session (visible in dashboard + session webhooks):
      metadata: {
        referrer,
        ...optionMeta,
      },
      // AND on the PaymentIntent (this is what most reporting/exports key on):
      payment_intent_data: {
        metadata: { referrer },
      },

      // Optional niceties:
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: session.url, id: session.id }),
    };
  } catch (err) {
    console.error("stripe session error:", err);
    return { statusCode: 500, body: "Could not create checkout session" };
  }
};
