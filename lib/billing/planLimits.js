// ============================================================================
// lib/billing/planLimits.js
// HireEdge — AI Career Intelligence Platform
//
// Plan definitions. Each plan specifies which tools are accessible and
// daily usage limits. The access control layer reads from these definitions.
//
// Plans:
//   free         — Basic career intelligence, limited copilot
//   career_pack  — Free + full career pack access
//   pro          — Everything in career_pack + all tools + higher limits
//   elite        — Unlimited everything + priority features
// ============================================================================

/**
 * @typedef {Object} PlanDefinition
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {number}   copilot_messages_per_day
 * @property {number}   tools_per_day
 * @property {boolean}  career_pack_access
 * @property {Set<string>} allowed_tools
 * @property {boolean}  unlimited
 */

// Tool identifiers (matching API route names)
const FREE_TOOLS = new Set([
  "role-intelligence",
  "role-path",
  "skills-gap",
  "salary-intelligence",
  "role-graph",
  "role-graph-meta",
  "talent-profile",
  "career-gap-explainer",
]);

const PRO_TOOLS = new Set([
  ...FREE_TOOLS,
  "career-roadmap",
  "resume-optimiser",
  "linkedin-optimiser",
  "interview-prep",
  "visa-eligibility",
]);

const ELITE_TOOLS = new Set([
  ...PRO_TOOLS,
  // Future premium tools go here
]);

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    description: "Basic career intelligence and limited copilot access",
    copilot_messages_per_day: 10,
    tools_per_day: 15,
    career_pack_access: false,
    career_pack_export: false,
    allowed_tools: FREE_TOOLS,
    unlimited: false,
  },

  career_pack: {
    id: "career_pack",
    name: "Career Pack",
    description: "Full career pack access plus free-tier tools",
    copilot_messages_per_day: 20,
    tools_per_day: 25,
    career_pack_access: true,
    career_pack_export: true,
    allowed_tools: FREE_TOOLS,
    unlimited: false,
  },

  pro: {
    id: "pro",
    name: "Pro",
    description: "All tools, career packs, and higher limits",
    copilot_messages_per_day: 100,
    tools_per_day: 100,
    career_pack_access: true,
    career_pack_export: true,
    allowed_tools: PRO_TOOLS,
    unlimited: false,
  },

  elite: {
    id: "elite",
    name: "Elite",
    description: "Unlimited access to everything",
    copilot_messages_per_day: Infinity,
    tools_per_day: Infinity,
    career_pack_access: true,
    career_pack_export: true,
    allowed_tools: ELITE_TOOLS,
    unlimited: true,
  },
};

/**
 * Get a plan definition by ID. Defaults to free.
 * @param {string} planId
 * @returns {PlanDefinition}
 */
export function getPlan(planId) {
  return PLANS[planId] || PLANS.free;
}

/**
 * List all available plan IDs.
 * @returns {string[]}
 */
export function listPlanIds() {
  return Object.keys(PLANS);
}

/**
 * Check whether a tool is in the free tier.
 * @param {string} tool
 * @returns {boolean}
 */
export function isFreeTool(tool) {
  return FREE_TOOLS.has(tool);
}
