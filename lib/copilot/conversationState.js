// ============================================================================
// lib/copilot/conversationState.js
// HireEdge — AI Career Intelligence Platform
//
// In-memory conversation state manager. Maintains per-session context across
// multi-turn conversations. In a serverless environment this provides
// within-invocation state; for persistence across requests the frontend
// should send context back with each message.
// ============================================================================

/**
 * @typedef {Object} ConversationContext
 * @property {string|null}  role      - Current role slug
 * @property {string|null}  target    - Target role slug
 * @property {string[]}     skills    - Known skills
 * @property {number|null}  yearsExp  - Years of experience
 * @property {string|null}  lastIntent - Last detected intent
 * @property {string[]}     history   - Summary of previous turns (max 10)
 */

/**
 * Create a fresh conversation context.
 * @returns {ConversationContext}
 */
export function createContext() {
  return {
    role: null,
    target: null,
    skills: [],
    yearsExp: null,
    lastIntent: null,
    history: [],
  };
}

/**
 * Merge incoming context (from the frontend / request body) with defaults.
 * Ensures all fields are present and correctly typed.
 *
 * @param {object} incoming - Partial context from the request
 * @returns {ConversationContext}
 */
export function resolveContext(incoming = {}) {
  return {
    role: _str(incoming.role),
    target: _str(incoming.target),
    skills: Array.isArray(incoming.skills) ? incoming.skills.map((s) => String(s).trim()).filter(Boolean) : [],
    yearsExp: typeof incoming.yearsExp === "number" ? incoming.yearsExp : null,
    lastIntent: _str(incoming.lastIntent),
    history: Array.isArray(incoming.history) ? incoming.history.slice(-10) : [],
  };
}

/**
 * Update context after a turn: merge newly extracted entities into existing
 * context without overwriting with nulls. Appends a history entry.
 *
 * @param {ConversationContext} current - Existing context
 * @param {{ currentRole?: string, targetRole?: string, skills?: string[], yearsExp?: number }} entities
 * @param {string} intent
 * @param {string} messageSummary - Short description of the turn (for history)
 * @returns {ConversationContext} New context (does not mutate original)
 */
export function updateContext(current, entities, intent, messageSummary) {
  const updated = { ...current };

  // Only overwrite with non-null values
  if (entities.currentRole) updated.role = entities.currentRole;
  if (entities.targetRole) updated.target = entities.targetRole;
  if (entities.skills?.length > 0) {
    // Merge, deduplicate (case-insensitive)
    const existing = new Set(updated.skills.map((s) => s.toLowerCase()));
    for (const s of entities.skills) {
      if (!existing.has(s.toLowerCase())) {
        updated.skills.push(s);
        existing.add(s.toLowerCase());
      }
    }
  }
  if (entities.yearsExp !== null && entities.yearsExp !== undefined) {
    updated.yearsExp = entities.yearsExp;
  }

  updated.lastIntent = intent;

  // Append to history (keep last 10)
  updated.history = [...current.history, messageSummary].slice(-10);

  return updated;
}

/**
 * Check whether the context has enough data for a given intent.
 *
 * @param {ConversationContext} ctx
 * @param {string} intent
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function checkReadiness(ctx, intent) {
  const missing = [];

  switch (intent) {
    case "transition":
    case "career_pack":
      if (!ctx.role) missing.push("current role");
      if (!ctx.target) missing.push("target role");
      if (ctx.skills.length === 0) missing.push("skills");
      break;

    case "skills_gap":
      if (!ctx.target && !ctx.role) missing.push("a role to analyse");
      break;

    case "interview":
    case "resume":
      if (!ctx.target && !ctx.role) missing.push("target role");
      if (ctx.skills.length === 0) missing.push("skills");
      break;

    case "linkedin":
      if (!ctx.role) missing.push("current role");
      if (ctx.skills.length === 0) missing.push("skills");
      break;

    case "salary":
      if (!ctx.role && !ctx.target) missing.push("a role to check salary for");
      break;

    case "explore":
      if (!ctx.role) missing.push("current role");
      break;

    case "visa":
      if (!ctx.target && !ctx.role) missing.push("target role");
      break;

    case "role_info":
    case "compare":
      // These work with mentionedRoles, not necessarily context
      break;

    case "general":
    default:
      break;
  }

  return { ready: missing.length === 0, missing };
}

/**
 * Build a context echo for inclusion in the API response, so the
 * frontend can send it back on the next turn.
 *
 * @param {ConversationContext} ctx
 * @returns {object}
 */
export function serializeContext(ctx) {
  return {
    role: ctx.role,
    target: ctx.target,
    skills: ctx.skills,
    yearsExp: ctx.yearsExp,
    lastIntent: ctx.lastIntent,
    history: ctx.history,
  };
}

// ===========================================================================
// Internal
// ===========================================================================
function _str(val) {
  if (typeof val === "string" && val.trim()) return val.trim();
  return null;
}
