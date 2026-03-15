// ============================================================================
// lib/dataset/graphIndex.js
// HireEdge — AI Career Intelligence Platform
// Builds and caches a directed graph (adjacency list) from role transitions.
// ============================================================================

import { loadRoles } from "./loadDataset.js";
import { getRoleBySlug } from "./roleIndex.js";

/**
 * @typedef {Object} GraphEdge
 * @property {string} from
 * @property {string} to
 * @property {string} title
 * @property {number} difficulty_score
 * @property {string} difficulty_label
 * @property {number} estimated_years
 * @property {number} salary_growth_pct
 */

/** @type {{ forward: Map<string, GraphEdge[]>, reverse: Map<string, GraphEdge[]>, nodes: Set<string> } | null} */
let _graph = null;

// ---------------------------------------------------------------------------
// Internal: build the graph once
// ---------------------------------------------------------------------------
function _ensureGraph() {
  if (_graph) return;

  const roles = loadRoles();
  const forward = new Map(); // slug → outgoing edges (next roles)
  const reverse = new Map(); // slug → incoming edges (previous roles)
  const nodes = new Set();

  for (const role of roles) {
    nodes.add(role.slug);

    // Use the rich `transitions.next` array when available
    const nextTransitions = role.transitions?.next || [];
    for (const t of nextTransitions) {
      const edge = {
        from: role.slug,
        to: t.to,
        title: t.title || t.to,
        difficulty_score: t.difficulty_score ?? 0,
        difficulty_label: t.difficulty_label || "unknown",
        estimated_years: t.estimated_years ?? 0,
        salary_growth_pct: t.salary_growth_pct ?? 0,
      };

      if (!forward.has(role.slug)) forward.set(role.slug, []);
      forward.get(role.slug).push(edge);

      if (!reverse.has(t.to)) reverse.set(t.to, []);
      reverse.get(t.to).push(edge);

      nodes.add(t.to);
    }

    // Fallback: if no transitions.next, use career_paths.next_roles
    if (nextTransitions.length === 0 && role.career_paths?.next_roles) {
      for (const slug of role.career_paths.next_roles) {
        const target = getRoleBySlug(slug);
        const edge = {
          from: role.slug,
          to: slug,
          title: target?.title || slug,
          difficulty_score: 0,
          difficulty_label: "unknown",
          estimated_years: 0,
          salary_growth_pct: 0,
        };
        if (!forward.has(role.slug)) forward.set(role.slug, []);
        forward.get(role.slug).push(edge);

        if (!reverse.has(slug)) reverse.set(slug, []);
        reverse.get(slug).push(edge);

        nodes.add(slug);
      }
    }
  }

  _graph = { forward, reverse, nodes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all outgoing (next) edges from a role.
 * @param {string} slug
 * @returns {GraphEdge[]}
 */
export function getNextEdges(slug) {
  _ensureGraph();
  return _graph.forward.get(slug) || [];
}

/**
 * Get all incoming (previous) edges to a role.
 * @param {string} slug
 * @returns {GraphEdge[]}
 */
export function getPreviousEdges(slug) {
  _ensureGraph();
  return _graph.reverse.get(slug) || [];
}

/**
 * Check if a slug exists in the graph.
 * @param {string} slug
 * @returns {boolean}
 */
export function hasNode(slug) {
  _ensureGraph();
  return _graph.nodes.has(slug);
}

/**
 * Return the full forward adjacency map (for engines that need full traversal).
 * @returns {Map<string, GraphEdge[]>}
 */
export function getForwardGraph() {
  _ensureGraph();
  return _graph.forward;
}

/**
 * Return the full reverse adjacency map.
 * @returns {Map<string, GraphEdge[]>}
 */
export function getReverseGraph() {
  _ensureGraph();
  return _graph.reverse;
}

/**
 * Return total number of unique nodes (roles referenced in graph).
 * @returns {number}
 */
export function getNodeCount() {
  _ensureGraph();
  return _graph.nodes.size;
}

/**
 * Return total number of directed edges.
 * @returns {number}
 */
export function getEdgeCount() {
  _ensureGraph();
  let count = 0;
  for (const edges of _graph.forward.values()) count += edges.length;
  return count;
}
