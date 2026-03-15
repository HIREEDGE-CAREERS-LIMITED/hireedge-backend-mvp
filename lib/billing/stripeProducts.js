// ============================================================================
// lib/billing/stripeProducts.js
// HireEdge — AI Career Intelligence Platform
//
// Stripe product & price placeholders. These map HireEdge plans to Stripe
// product IDs and price IDs. In production, replace the placeholder values
// with real Stripe dashboard IDs.
//
// Usage:
//   import { STRIPE_PRODUCTS, getCheckoutConfig } from "./stripeProducts.js";
// ============================================================================

export const STRIPE_PRODUCTS = {
  career_pack: {
    plan_id: "career_pack",
    name: "HireEdge Career Pack",
    description: "Full career pack access: roadmaps, skills analysis, resume & interview prep bundled into one download.",
    stripe_product_id: "prod_hireedge_career_pack",    // Replace with real Stripe product ID
    prices: {
      one_time: {
        stripe_price_id: "price_hireedge_cp_onetime",  // Replace with real Stripe price ID
        amount: 1999,                                    // £19.99
        currency: "gbp",
        type: "one_time",
      },
    },
    features: [
      "Full Career Pack (build + export)",
      "Career Roadmap",
      "Skills Gap Analysis",
      "20 Copilot messages/day",
      "25 tool uses/day",
    ],
  },

  career_pro: {
    plan_id: "pro",
    name: "HireEdge Pro",
    description: "All career tools unlocked: resume optimiser, interview prep, LinkedIn optimiser, visa eligibility, and more.",
    stripe_product_id: "prod_hireedge_pro",
    prices: {
      monthly: {
        stripe_price_id: "price_hireedge_pro_monthly",
        amount: 1499,                                    // £14.99/month
        currency: "gbp",
        type: "recurring",
        interval: "month",
      },
      yearly: {
        stripe_price_id: "price_hireedge_pro_yearly",
        amount: 11988,                                   // £119.88/year (£9.99/month)
        currency: "gbp",
        type: "recurring",
        interval: "year",
      },
    },
    features: [
      "Everything in Career Pack",
      "Resume Optimiser",
      "LinkedIn Optimiser",
      "Interview Prep",
      "Visa Eligibility",
      "100 Copilot messages/day",
      "100 tool uses/day",
    ],
  },

  career_elite: {
    plan_id: "elite",
    name: "HireEdge Elite",
    description: "Unlimited access to every HireEdge feature. Priority support and early access to new tools.",
    stripe_product_id: "prod_hireedge_elite",
    prices: {
      monthly: {
        stripe_price_id: "price_hireedge_elite_monthly",
        amount: 2999,                                    // £29.99/month
        currency: "gbp",
        type: "recurring",
        interval: "month",
      },
      yearly: {
        stripe_price_id: "price_hireedge_elite_yearly",
        amount: 23988,                                   // £239.88/year (£19.99/month)
        currency: "gbp",
        type: "recurring",
        interval: "year",
      },
    },
    features: [
      "Everything in Pro",
      "Unlimited Copilot messages",
      "Unlimited tool uses",
      "Priority support",
      "Early access to new features",
    ],
  },
};

/**
 * Get Stripe checkout configuration for a plan.
 *
 * @param {string} productKey - "career_pack" | "career_pro" | "career_elite"
 * @param {string} [priceType] - "one_time" | "monthly" | "yearly"
 * @returns {object | null}
 */
export function getCheckoutConfig(productKey, priceType) {
  const product = STRIPE_PRODUCTS[productKey];
  if (!product) return null;

  // Auto-select price: use specified type, or first available
  const price = priceType
    ? product.prices[priceType]
    : Object.values(product.prices)[0];

  if (!price) return null;

  return {
    product_name: product.name,
    plan_id: product.plan_id,
    stripe_product_id: product.stripe_product_id,
    stripe_price_id: price.stripe_price_id,
    amount: price.amount,
    currency: price.currency,
    type: price.type,
    interval: price.interval || null,
    display_price: `£${(price.amount / 100).toFixed(2)}`,
    features: product.features,
  };
}

/**
 * List all products with their pricing for a pricing page.
 * @returns {object[]}
 */
export function listProducts() {
  return Object.entries(STRIPE_PRODUCTS).map(([key, product]) => ({
    key,
    plan_id: product.plan_id,
    name: product.name,
    description: product.description,
    features: product.features,
    prices: Object.entries(product.prices).map(([type, p]) => ({
      type,
      amount: p.amount,
      currency: p.currency,
      display_price: `£${(p.amount / 100).toFixed(2)}`,
      interval: p.interval || null,
    })),
  }));
}
