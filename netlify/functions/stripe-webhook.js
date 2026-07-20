// ============================================================================
// NETLIFY FUNCTION - Stripe webhook -> record referral commission in Supabase.
// ----------------------------------------------------------------------------
// Fires on checkout.session.completed. Reads the `referrer` metadata we set on
// the session and writes a row to Supabase `commission`, which the franchisee
// hub's live commissions dashboard already reads from.
//
// Env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET     whsec_...  (from the Stripe webhook endpoint)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (service role - server-only, NEVER exposed client-side)
//
// Stripe dashboard: add endpoint -> POST /.netlify/functions/stripe-webhook
// listening for `checkout.session.completed`.
//
// IMPORTANT: this function needs the RAW body for signature verification, so
// Netlify must not parse it. See netlify.toml note in the README.
// ============================================================================

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

exports.handler = async (event) => {
  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    // event.body is the raw string; isBase64Encoded handled by Netlify.
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    stripeEvent = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "ignored" };
  }

  const session = stripeEvent.data.object;
  const referrer = (session.metadata && session.metadata.referrer) || "organic";

  // Don't record commission for organic sales.
  if (referrer === "organic") {
    return { statusCode: 200, body: "organic - no commission" };
  }

  const commission = {
    order_id: session.id,
    payment_intent: session.payment_intent || null,
    referrer_ref: referrer,                       // the stripe_ref
    amount_total: session.amount_total,           // in pence
    currency: session.currency,
    customer_email: (session.customer_details && session.customer_details.email) || null,
    created_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/commission`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "content-type": "application/json",
          // idempotency: ignore duplicate webhook deliveries for same order.
          prefer: "resolution=ignore-duplicates",
        },
        body: JSON.stringify(commission),
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      console.error("supabase insert failed:", res.status, txt);
      // Return 500 so Stripe retries (better than silently losing commission).
      return { statusCode: 500, body: "insert failed" };
    }
  } catch (err) {
    console.error("commission write error:", err);
    return { statusCode: 500, body: "insert error" };
  }

  return { statusCode: 200, body: "recorded" };
};
