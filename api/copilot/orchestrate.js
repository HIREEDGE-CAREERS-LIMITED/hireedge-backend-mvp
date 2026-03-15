// ============================================================================
// api/copilot/orchestrate.js
// HireEdge — Vercel Serverless API
//
// POST  /api/copilot/orchestrate
// Body: { "message": "...", "context": { role, target, skills, yearsExp } }
//
// Direct orchestration endpoint. Returns raw intent + insights without
// composing a conversational reply. Useful for frontends that render
// their own UI from structured data.
// ============================================================================

import { detectIntent } from "../../lib/copilot/intentDetector.js";
import { resolveContext, updateContext, serializeContext } from "../../lib/copilot/conversationState.js";
import { orchestrate } from "../../lib/copilot/orchestrator.js";

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
    const { engines_called, insights } = orchestrate(detected.intent, detected.entities, updatedCtx);

    return res.status(200).json({
      ok: true,
      data: {
        intent: { name: detected.intent, confidence: detected.confidence },
        entities: detected.entities,
        engines_called,
        insights,
        context: serializeContext(updatedCtx),
      },
    });
  } catch (err) {
    console.error("[copilot/orchestrate]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
