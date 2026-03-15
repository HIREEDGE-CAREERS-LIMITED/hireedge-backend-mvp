// ============================================================================
// api/copilot/recommend.js
// HireEdge — Vercel Serverless API
//
// POST  /api/copilot/recommend
// Body: { "message": "...", "context": { role, target, skills, yearsExp } }
//
// Returns prioritised recommendations without the full orchestration payload.
// Lightweight endpoint for recommendation widgets / suggestion chips.
// ============================================================================

import { detectIntent } from "../../lib/copilot/intentDetector.js";
import { resolveContext, updateContext, serializeContext } from "../../lib/copilot/conversationState.js";
import { orchestrate } from "../../lib/copilot/orchestrator.js";
import { generateRecommendations } from "../../lib/copilot/recommender.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { message, context } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Missing required field: message" });
    }

    const ctx = resolveContext(context || {});
    const detected = detectIntent(message.trim(), ctx);
    const updatedCtx = updateContext(ctx, detected.entities, detected.intent, `[${detected.intent}] ${message.trim().slice(0, 80)}`);
    const { insights } = orchestrate(detected.intent, detected.entities, updatedCtx);
    const recommendations = generateRecommendations(detected.intent, insights, updatedCtx);

    return res.status(200).json({
      ok: true,
      data: {
        intent: detected.intent,
        recommendations,
        context: serializeContext(updatedCtx),
      },
    });
  } catch (err) {
    console.error("[copilot/recommend]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
