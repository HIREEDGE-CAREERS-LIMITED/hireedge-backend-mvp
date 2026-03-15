import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // ✅ If you open in browser, it's GET — never crash
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "Use POST with JSON: { priceId, quantity } to create a Stripe Checkout session.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("Missing STRIPE_SECRET_KEY in Vercel environment variables");
    }

    // Vercel sometimes passes body as string, sometimes object
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { priceId, quantity = 1 } = body;

    if (!priceId) {
      return res.status(400).json({ ok: false, error: "Missing priceId" });
    }

    const successBase = process.env.SUCCESS_URL || "https://hireedge.co.uk";
    const cancelBase = process.env.CANCEL_URL || "https://hireedge.co.uk";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: Number(quantity) || 1 }],
      success_url: `${successBase}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${cancelBase}/cancel`,
    });

    return res.status(200).json({
      ok: true,
      url: session.url,
      id: session.id,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unknown error",
    });
  }
}

