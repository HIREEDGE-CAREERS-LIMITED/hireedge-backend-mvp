// ============================================================================
// api/copilot/chat.js
// HireEdge Backend — EDGEX chat endpoint
//
// POST /api/copilot/chat
// Body:    { message: string, context: object }
// Response: { ok: true, data: { reply, intent, insights, recommendations,
//                               next_actions, context } }
//
// Previously this was a disconnected keyword-matching stub that never called
// any intelligence engines and returned generic fallback text for every query.
//
// Now it delegates to composeChatResponse() which runs the full pipeline:
//   detectIntent → resolveContext → orchestrate → recommend → plan → compose
// ============================================================================

import { composeChatResponse } from "../../lib/copilot/responseComposer.js";

export default function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }

  const { message, context } = body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing required field: message" });
  }

  // ── Run full EDGEX pipeline ─────────────────────────────────────────────────
  // composeChatResponse runs: detectIntent → updateContext → checkReadiness
  //   → orchestrate (calls correct intelligence engines) → recommend → plan
  //   → compose (builds the human-readable reply and structured data)
  try {
    const result = composeChatResponse(message.trim(), context || {});

    // result.data already has the exact shape copilotService.js expects:
    // { reply, intent, insights, recommendations, next_actions, context }
    return res.status(200).json(result);

  } catch (err) {
    console.error("[copilot/chat]", err);

    // Return a graceful error that the frontend MessageBubble can handle
    return res.status(500).json({
      ok: false,
      error: "EDGEX is temporarily unavailable.",
      message: err.message,
    });
  }
}
