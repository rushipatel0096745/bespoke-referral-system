// ============================================================================
// ADD TO CART - attach the referral to the cart line, then hand off to Stripe.
// ----------------------------------------------------------------------------
// This is the glue between the buy panel (on /our-kit and the referral pages)
// and the Stripe Checkout session. It reads the persisted ref and includes it
// so attribution survives all the way to the payment.
//
// NOTE: this assumes the Stripe-checkout migration is in place (the create-
// checkout-session function below is the target). Until then, the buy button
// still links to Wix; wire this up as part of that migration.
// ============================================================================

(function () {
  "use strict";

  // Called by the "Add to cart" / "Checkout" button on the buy panel.
  // `selection` = { kit, price, personalisation, colour, frame, font, ... }
  async function startCheckout(selection) {
    var ref = (window.BFCReferral && window.BFCReferral.get()) || null;

    var payload = {
      items: [
        {
          kit: selection.kit,            // foil | framed | premium
          price: selection.price,        // display price; server re-prices
          personalisation: selection.personalisation || "later",
          options: {
            colour: selection.colour || null,
            frame: selection.frame || null,
            font: selection.font || null,
          },
        },
      ],
      // The referral travels in the cart payload...
      referrer: ref,                     // stripe_ref (or null for organic)
    };

    try {
      var res = await fetch("/.netlify/functions/create-checkout-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("checkout session " + res.status);
      var data = await res.json();

      // Stripe returns a hosted checkout URL - send the buyer there.
      if (data.url) {
        window.location.assign(data.url);
      } else {
        throw new Error("no checkout url returned");
      }
    } catch (err) {
      console.error("checkout failed:", err);
      // Surface a friendly message in the UI (hook into your existing toast).
      alert("Sorry, something went wrong starting checkout. Please try again.");
    }
  }

  window.BFCCart = { startCheckout: startCheckout };
})();
