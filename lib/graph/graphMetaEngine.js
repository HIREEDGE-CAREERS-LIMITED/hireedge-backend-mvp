// ============================================================================
// lib/graph/graphMetaEngine.js
// HireEdge — AI Career Intelligence Platform
// Graph-level metadata: stats, connectivity, hotspots, category bridges.
// ============================================================================

import { loadRoles } from "../dataset/loadDataset.js";
import { getRoleBySlug, getRoleMap } from "../dataset/roleIndex.js";
import {
  getNextEdges,
  getPreviousEdges,
  getForwardGraph,
  getNodeCount,
  getEdgeCount,
} from "../dataset/graphIndex.js";

/**
 * High-level graph statistics.
 * @returns {object}
 */
export function getGraphStats() {
  const roles = loadRoles();
  const categories = new Map();
  const seniorities = new Map();

  for (const r of roles) {
    categories.set(r.category, (categories.get(r.category) || 0) + 1);
    seniorities.set(r.seniority, (seniorities.get(r.seniority) || 0) + 1);
  }

  return {
    total_roles: roles.length,
    total_nodes: getNodeCount(),
    total_edges: getEdgeCount(),
    categories: Object.fromEntries([...categories.entries()].sort((a, b) => b[1] - a[1])),
    seniorities: Object.fromEntries([...seniorities.entries()].sort((a, b) => b[1] - a[1])),
    avg_edges_per_role: +(getEdgeCount() / Math.max(roles.length, 1)).toFixed(2),
  };
}

/**
 * Find roles with the most outgoing transitions (career hub roles).
 * @param {{ limit?: number }} opts
 * @returns {Array<{ slug: string, title: string, outgoing: number, incoming: number }>}
 */
export function getHubRoles(opts = {}) {
  const limit = opts.limit || 20;
  const roleMap = getRoleMap();
  const scored = [];

  for (const [slug] of roleMap) {
    const out = getNextEdges(slug).length;
    const inc = getPreviousEdges(slug).length;
    scored.push({
      slug,
      title: roleMap.get(slug)?.title || slug,
      category: roleMap.get(slug)?.category || "",
      outgoing: out,
      incoming: inc,
      total_connections: out + inc,
    });
  }

  scored.sort((a, b) => b.total_connections - a.total_connections);
  return scored.slice(0, limit);
}

/**
 * Find "dead-end" roles with no outgoing transitions.
 * @param {{ limit?: number }} opts
 * @returns {Array<{ slug: string, title: string, category: string, incoming: number }>}
 */
export function getDeadEndRoles(opts = {}) {
  const limit = opts.limit || 50;
  const roleMap = getRoleMap();
  const results = [];

  for (const [slug, role] of roleMap) {
    if (getNextEdges(slug).length === 0) {
      results.push({
        slug,
        title: role.title,
        category: role.category,
        seniority: role.seniority,
        incoming: getPreviousEdges(slug).length,
      });
    }
  }

  results.sort((a, b) => b.incoming - a.incoming);
  return results.slice(0, limit);
}

/**
 * Find "entry-point" roles with no incoming transitions.
 * @param {{ limit?: number }} opts
 * @returns {Array<{ slug: string, title: string, category: string, outgoing: number }>}
 */
export function getEntryPointRoles(opts = {}) {
  const limit = opts.limit || 50;
  const roleMap = getRoleMap();
  const results = [];

  for (const [slug, role] of roleMap) {
    if (getPreviousEdges(slug).length === 0) {
      results.push({
        slug,
        title: role.title,
        category: role.category,
        seniority: role.seniority,
        outgoing: getNextEdges(slug).length,
      });
    }
  }

  results.sort((a, b) => b.outgoing - a.outgoing);
  return results.slice(0, limit);
}

/**
 * Identify cross-category transitions (career bridges).
 * @param {{ limit?: number }} opts
 * @returns {Array<object>}
 */
export function getCategoryBridges(opts = {}) {
  const limit = opts.limit || 30;
  const forwardGraph = getForwardGraph();
  const bridges = [];

  for (const [fromSlug, edges] of forwardGraph) {
    const fromRole = getRoleBySlug(fromSlug);
    if (!fromRole) continue;

    for (const edge of edges) {
      const toRole = getRoleBySlug(edge.to);
      if (!toRole) continue;

      if (fromRole.category !== toRole.category) {
        bridges.push({
          from_slug: fromSlug,
          from_title: fromRole.title,
          from_category: fromRole.category,
          to_slug: edge.to,
          to_title: toRole.title,
          to_category: toRole.category,
          difficulty_score: edge.difficulty_score,
          salary_growth_pct: edge.salary_growth_pct,
        });
      }
    }
  }

  bridges.sort((a, b) => (b.salary_growth_pct || 0) - (a.salary_growth_pct || 0));
  return bridges.slice(0, limit);
}
