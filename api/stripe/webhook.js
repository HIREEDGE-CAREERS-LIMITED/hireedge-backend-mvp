import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle when payment is successful
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const engine = session.metadata.engine;
    const userId = session.metadata.userId;

    // TODO: Save purchase → Supabase
    // purchases.insert({ userId, engine, stripe_session: session.id })
    console.log("Payment success → unlock engine:", engine, "for user:", userId);
  }

  res.json({ received: true });
}

// Utility to grab raw body
function buffer(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
