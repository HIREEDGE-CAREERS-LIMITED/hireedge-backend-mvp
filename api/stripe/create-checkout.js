import Stripe from "stripe";

export const config = {
  api: { bodyParser: true },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { priceId, userId, engineId } = req.body;

    if (!priceId || !userId || !engineId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.APP_URL}/engine/${engineId}?success=true`,
      cancel_url: `${process.env.APP_URL}/engine/${engineId}?canceled=true`,
      metadata: {
        userId,
        engineId,
        type: "single_engine",
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Stripe session failed" });
  }
}
