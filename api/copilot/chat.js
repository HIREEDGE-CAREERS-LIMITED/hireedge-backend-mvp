// ============================================================================
// api/copilot/chat.js
// HireEdge — Vercel Serverless API
//
// POST  /api/copilot/chat
// Body: { "message": "...", "context": { role, target, skills, yearsExp, lastIntent, history } }
//
// Main conversational Copilot endpoint. Runs the full pipeline:
// intent detection → context resolution → orchestration → recommendations → response.
// ============================================================================

import { composeChatResponse } from "../../lib/copilot/responseComposer.js";
import { enforceBilling } from "../../lib/billing/billingMiddleware.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HireEdge-Plan, X-HireEdge-User-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  try {
    if (enforceBilling(req, res, "copilot-chat")) return;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { message, context } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Missing required field: message" });
    }

    const result = composeChatResponse(message.trim(), context || {});

    return res.status(200).json(result);
  } catch (err) {
    console.error("[copilot/chat]", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
}
