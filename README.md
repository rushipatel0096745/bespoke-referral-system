# Referral System - setup & wiring

Dynamic `/memory-catcher/:slug` referral pages with Stripe attribution.
One Edge Function serves every slug; the referral survives to Stripe metadata
and lands in the hub commission dashboard. No per-page files, no per-referrer
deploys.

## Files

```
netlify/edge-functions/memory-catcher.js     dynamic route (/memory-catcher/*)
netlify/functions/create-checkout-session.js Stripe session + referral metadata
netlify/functions/stripe-webhook.js          records commission -> Supabase
shared/referrer-registry.js                  slug -> referrer (Supabase + JSON fallback)
shared/render-template.js                     injects referrer into the template
shared/referral-capture.js                   bfc_ref cookie/localStorage (all pages)
shared/add-to-cart.js                         attaches ref, calls checkout
data/referral-schema.sql                      referrer + commission tables
data/referrers.json                           local-dev fallback registry
```

## What's ready vs what's a stub (be aware before you test)

**Ready and runnable now:** the edge route, slug extraction, registry lookup
(JSON fallback works with zero setup), cookie/localStorage capture, first-touch
logic, the Stripe session + webhook shape.

**Stubs waiting on decisions / the Stripe migration (marked in code):**
- `PRICE_MAP` in `create-checkout-session.js` - needs your real `price_...` IDs.
- The buy button still points to Wix until the Stripe migration flips it to
  `BFCCart.startCheckout(...)`.
- Discount-vs-tracking (DECISION #5): the `code` is shown but not yet minted as
  a Stripe promotion code. Only needed if the referral is also a discount.

## Setup steps

### 1. Move files to repo root
The `netlify/` and `shared/` folders go at the **repo root** (not inside
`referral-system/`). Keep `data/` wherever you like and update the import path
in `referrer-registry.js` if you move it.

### 2. netlify.toml additions
```toml
# Edge function is auto-detected from netlify/edge-functions/ + its config.path.
# Add the raw-body setting so the Stripe webhook can verify signatures:
[functions."stripe-webhook"]
  # ensure the raw body is preserved (do not pre-parse)
```
Netlify passes the raw body to functions by default; the webhook handles the
base64 case. No _redirects entry is needed - the edge function's `config.path`
binds `/memory-catcher/*`.

### 3. Create the template
```
cp memory-catcher-salamata-bah.html referral-template.html
```
In `referral-template.html`, replace the hard-coded object:
```js
const MEMORY_CATCHER = { name:"Salamata", ... };
```
with the placeholder:
```js
const MEMORY_CATCHER = /*__MC_DATA__*/ null /*__END_MC_DATA__*/;
```
Everything else in that file stays exactly as-is.

### 4. Include the client scripts on every page
Add to the shared `<head>` (or before `</body>`):
```html
<script src="/shared/referral-capture.js" defer></script>
<script src="/shared/add-to-cart.js" defer></script>
```
`referral-capture.js` must load on **all** pages (buyer may land on a referral
page then browse before buying). `add-to-cart.js` only matters on buy pages.

### 5. Supabase
Run `data/referral-schema.sql` in the Supabase SQL editor. It creates both
tables, RLS, and seeds Salamata + Ashley. Confirm the anon key can read
`referrer` and the service role can insert `commission`.

### 6. Environment variables (Netlify)
```
SUPABASE_URL
SUPABASE_ANON_KEY                (edge: referrer read)
SUPABASE_SERVICE_ROLE_KEY        (webhook: commission write - server only)
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

### 7. Stripe
- Create products/prices; put the `price_...` IDs in `PRICE_MAP`.
- Add a webhook endpoint -> `/.netlify/functions/stripe-webhook`, event
  `checkout.session.completed`. Copy its signing secret to `STRIPE_WEBHOOK_SECRET`.

## Testing

1. **Route + template:** visit `/memory-catcher/salamata-bah` and
   `/memory-catcher/dixit` - both render the same template with different
   names/offers. `/memory-catcher/nonsense` falls back to `/our-kit`.
2. **Cookie:** after landing, check `document.cookie` has `bfc_ref`. Browse to
   `/our-kit`; `window.BFCReferral.get()` still returns the ref (persistence).
3. **First-touch:** visit `salamata-bah` then `dixit` - ref stays salamata.
4. **Checkout (after Stripe migration):** add to cart -> Stripe session's
   metadata.referrer = the stripe_ref. Complete a test payment.
5. **Commission:** webhook fires -> a row appears in `commission` -> shows in
   the hub dashboard.

## The five open decisions (from the brief) and where they live in code

1. **First vs last touch** - `memory-catcher.js` (cookie set) + `referral-capture.js` (`resolveRef`). Currently first-touch.
2. **Attribution window** - `REF_COOKIE_DAYS` (edge) + `writeCookie(...,30)` (client). Currently 30 days.
3. **Unknown slug** - `memory-catcher.js` -> `context.rewrite("/our-kit")`. Currently generic page, not 404.
4. **stripe_ref format** - stable id in the `referrer` table, not the slug, so slugs can be renamed. Already done.
5. **Discount vs tracking** - `code` shown on page; promotion-code minting NOT built. Decide before go-live.
