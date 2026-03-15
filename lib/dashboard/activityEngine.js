// ============================================================================
// lib/dashboard/activityEngine.js
// HireEdge — AI Career Intelligence Platform
//
// Lightweight activity layer (V1). No persistence — activity is passed in
// the request and normalised into dashboard-ready JSON. The frontend is
// responsible for storing activity client-side (localStorage / state) and
// sending it back. This engine validates, deduplicates, and enriches.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";

/**
 * @typedef {Object} ActivityEntry
 * @property {string} type        - recent_roles | recent_tools | recent_queries | recent_packs
 * @property {string} id          - Unique identifier (slug, tool name, or query hash)
 * @property {string} [label]     - Display label
 * @property {string} [timestamp] - ISO timestamp
 * @property {object} [meta]      - Additional metadata
 */

/**
 * Normalise and enrich raw activity entries from the frontend.
 *
 * @param {object} input
 * @param {object[]} [input.recent_roles]   - [{ slug, timestamp }]
 * @param {object[]} [input.recent_tools]   - [{ tool, params, timestamp }]
 * @param {object[]} [input.recent_queries] - [{ query, intent, timestamp }]
 * @param {object[]} [input.recent_packs]   - [{ pack_id, role, target, timestamp }]
 * @returns {object}
 */
export function normaliseActivity(input = {}) {
  const recentRoles = _normaliseRoles(input.recent_roles);
  const recentTools = _normaliseTools(input.recent_tools);
  const recentQueries = _normaliseQueries(input.recent_queries);
  const recentPacks = _normalisePacks(input.recent_packs);

  const totalItems = recentRoles.length + recentTools.length + recentQueries.length + recentPacks.length;

  // Combined timeline (all types, sorted by timestamp desc)
  const timeline = [
    ...recentRoles.map((r) => ({ ...r, type: "role_view" })),
    ...recentTools.map((t) => ({ ...t, type: "tool_use" })),
    ...recentQueries.map((q) => ({ ...q, type: "query" })),
    ...recentPacks.map((p) => ({ ...p, type: "pack_build" })),
  ].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  }).slice(0, 20);

  return {
    ok: true,
    data: {
      total_items: totalItems,
      recent_roles: recentRoles,
      recent_tools: recentTools,
      recent_queries: recentQueries,
      recent_packs: recentPacks,
      timeline,
    },
  };
}

/**
 * Create a new activity entry (helper for the frontend to use).
 *
 * @param {'role_view'|'tool_use'|'query'|'pack_build'} type
 * @param {object} data
 * @returns {ActivityEntry}
 */
export function createActivityEntry(type, data = {}) {
  return {
    type,
    id: data.id || data.slug || data.tool || data.query || `entry_${Date.now()}`,
    label: data.label || data.title || data.tool || data.query || null,
    timestamp: data.timestamp || new Date().toISOString(),
    meta: data.meta || {},
  };
}

// ===========================================================================
// Normalisers
// ===========================================================================

function _normaliseRoles(entries) {
  if (!Array.isArray(entries)) return [];

  const seen = new Set();
  return entries
    .filter((e) => e && e.slug)
    .map((e) => {
      const role = getRoleBySlug(e.slug);
      return {
        id: e.slug,
        slug: e.slug,
        title: role?.title || e.title || e.slug,
        category: role?.category || e.category || null,
        seniority: role?.seniority || null,
        timestamp: e.timestamp || null,
      };
    })
    .filter((e) => {
      if (seen.has(e.slug)) return false;
      seen.add(e.slug);
      return true;
    })
    .slice(0, 10);
}

function _normaliseTools(entries) {
  if (!Array.isArray(entries)) return [];

  const validTools = new Set([
    "career-roadmap", "career-gap-explainer", "talent-profile",
    "resume-optimiser", "linkedin-optimiser", "interview-prep",
    "visa-eligibility", "career-pack",
  ]);

  return entries
    .filter((e) => e && e.tool)
    .map((e) => ({
      id: `${e.tool}_${e.timestamp || Date.now()}`,
      tool: e.tool,
      label: _toolLabel(e.tool),
      valid: validTools.has(e.tool),
      params: e.params || {},
      timestamp: e.timestamp || null,
    }))
    .slice(0, 10);
}

function _normaliseQueries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((e) => e && e.query)
    .map((e) => ({
      id: `q_${_hash(e.query)}`,
      query: e.query.slice(0, 200),
      intent: e.intent || null,
      timestamp: e.timestamp || null,
    }))
    .slice(0, 10);
}

function _normalisePacks(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((e) => e && (e.pack_id || e.role))
    .map((e) => {
      const fromRole = e.role ? getRoleBySlug(e.role) : null;
      const toRole = e.target ? getRoleBySlug(e.target) : null;
      return {
        id: e.pack_id || `pack_${e.role}_${e.target}`,
        pack_id: e.pack_id || null,
        from_slug: e.role || null,
        from_title: fromRole?.title || e.role || null,
        to_slug: e.target || null,
        to_title: toRole?.title || e.target || null,
        timestamp: e.timestamp || null,
      };
    })
    .slice(0, 10);
}

// ===========================================================================
// Util
// ===========================================================================

function _toolLabel(tool) {
  const labels = {
    "career-roadmap": "Career Roadmap",
    "career-gap-explainer": "Gap Explainer",
    "talent-profile": "Talent Profile",
    "resume-optimiser": "Resume Optimiser",
    "linkedin-optimiser": "LinkedIn Optimiser",
    "interview-prep": "Interview Prep",
    "visa-eligibility": "Visa Eligibility",
    "career-pack": "Career Pack",
  };
  return labels[tool] || tool;
}

function _hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
