const crypto = require("crypto");

const COMMISSION_RATE = 0.4; // 40% for Shopify orders

// Verify the webhook came from Shopify using HMAC signature
function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
    const hash = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    return hash === hmacHeader;
}

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // 1. Verify signature
    const hmacHeader = event.headers["x-shopify-hmac-sha256"];
    if (!hmacHeader) {
        return { statusCode: 401, body: "Missing HMAC header" };
    }

    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;

    const isValid = verifyShopifyWebhook(rawBody, hmacHeader, process.env.SHOPIFY_WEBHOOK_SECRET);

    if (!isValid) {
        console.error("Shopify webhook signature verification failed");
        return { statusCode: 401, body: "Invalid signature" };
    }

    // 2. Parse the order
    let order;
    try {
        order = JSON.parse(rawBody);
    } catch {
        return { statusCode: 400, body: "Bad JSON" };
    }

    // 3. Extract discount code from the order
    const discountCodes = order.discount_codes || [];
    if (discountCodes.length === 0) {
        console.log("Order has no discount code — organic, skipping");
        return { statusCode: 200, body: "organic - no commission" };
    }

    // Use the first discount code (there's usually only one)
    const usedCode = discountCodes[0].code.toUpperCase();
    console.log("Discount code used:", usedCode);

    // 4. Look up referrer in Supabase by shopify_code
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const refRes = await fetch(
        `${supabaseUrl}/rest/v1/referrer` +
            `?shopify_code=eq.${encodeURIComponent(usedCode)}` +
            `&active=eq.true` +
            `&select=slug,name,stripe_ref,shopify_code&limit=1`,
        {
            headers: {
                apikey: serviceKey,
                authorization: `Bearer ${serviceKey}`,
                accept: "application/json",
            },
        }
    );

    if (!refRes.ok) {
        console.error("Supabase referrer lookup failed:", refRes.status);
        return { statusCode: 500, body: "Referrer lookup failed" };
    }

    const refs = await refRes.json();
    if (!Array.isArray(refs) || refs.length === 0) {
        console.log("No referrer found for code:", usedCode, "— skipping");
        return { statusCode: 200, body: "unknown code - no commission" };
    }

    const referrer = refs[0];

    // 5. Calculate commission
    // amount_total from Shopify is in major units (e.g. "49.00"), convert to pence
    const orderTotal = Math.round(parseFloat(order.total_price || "0") * 100);
    const commission = Math.round(orderTotal * COMMISSION_RATE);

    console.log(
        `Recording Shopify commission for ${referrer.name}:`,
        `order £${orderTotal / 100}, commission £${commission / 100}`
    );

    // 6. Insert commission row
    const commissionRow = {
        order_id: `shopify_${order.id}`, // prefix to avoid collision with Stripe IDs
        payment_intent: null,
        referrer_ref: referrer.stripe_ref,
        amount_total: orderTotal,
        currency: (order.currency || "GBP").toLowerCase(),
        customer_email: order.email || null,
        created_at: new Date().toISOString(),
        source: "shopify",
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/commission`, {
        method: "POST",
        headers: {
            apikey: serviceKey,
            authorization: `Bearer ${serviceKey}`,
            "content-type": "application/json",
            prefer: "resolution=ignore-duplicates",
        },
        body: JSON.stringify(commissionRow),
    });

    if (!insertRes.ok) {
        const txt = await insertRes.text();
        console.error("Supabase commission insert failed:", insertRes.status, txt);
        return { statusCode: 500, body: "Commission insert failed" };
    }

    console.log("Commission recorded for", referrer.name, "via Shopify order", order.id);
    return { statusCode: 200, body: "recorded" };
};
