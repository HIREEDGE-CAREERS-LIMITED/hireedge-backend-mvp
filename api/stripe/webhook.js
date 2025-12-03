import Stripe from "stripe";
import { buffer } from "micro";
import supabase from "../../utils/supabaseClient";

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).end("Method not allowed");
  }

  const sig = req.headers["stripe-signature"];
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  let event;

  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf.toString(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.metadata.type === "single_engine") {
          await supabase.from("purchases").insert({
            user_id: session.metadata.userId,
            engine_id: session.metadata.engineId,
            stripe_session: session.id,
            status: "paid",
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const subscription = event.data.object;

        await supabase.from("subscriptions").insert({
          user_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          status: "active",
        });
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        await supabase
          .from("subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_subscription_id", subscription.id);

        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
