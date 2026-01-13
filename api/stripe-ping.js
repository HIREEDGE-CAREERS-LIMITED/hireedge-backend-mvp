import Stripe from "stripe";

export default async function handler(req, res) {
  // Allow only GET
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // Safety: check env
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY" });
  }

  try {
    const stripe = new Stripe(key, { apiVersion: "2024-06-20" });

    // Lightweight call to verify Stripe works:
    // retrieve account (works for both test/live keys)
    const account = await stripe.accounts.retrieve();

    return res.status(200).json({
      ok: true,
      stripe: "connected",
      accountId: account.id,
      livemode: account.livemode,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      stripe: "error",
      message: err?.message || "Unknown error",
    });
  }
}
