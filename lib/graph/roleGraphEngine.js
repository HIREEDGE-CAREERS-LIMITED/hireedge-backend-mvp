// ============================================================================
// lib/graph/roleGraphEngine.js
// HireEdge — AI Career Intelligence Platform
// Builds local subgraphs around a role for visualization (nodes + edges).
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getNextEdges, getPreviousEdges } from "../dataset/graphIndex.js";

/**
 * Build a neighborhood subgraph centered on `slug`.
 * Returns nodes and edges suitable for frontend graph rendering (e.g. D3, Cytoscape).
 *
 * @param {string} slug - Center role slug
 * @param {{ depth?: number, includeAdjacent?: boolean }} opts
 * @returns {{ nodes: object[], edges: object[], center: string }}
 */
export function buildRoleGraph(slug, opts = {}) {
  const depth = Math.min(opts.depth || 2, 3); // cap at 3 to avoid huge graphs
  const includeAdjacent = opts.includeAdjacent ?? true;

  const nodeMap = new Map();
  const edgeList = [];
  const edgeSet = new Set(); // dedup key: "from→to"

  const centerRole = getRoleBySlug(slug);
  if (!centerRole) return { nodes: [], edges: [], center: slug };

  // BFS outward from center
  const queue = [{ slug, level: 0 }];
  const visited = new Set([slug]);

  _addNode(nodeMap, centerRole, "center", 0);

  while (queue.length) {
    const { slug: current, level } = queue.shift();
    if (level >= depth) continue;

    // Forward edges (next roles)
    for (const edge of getNextEdges(current)) {
      const key = `${edge.from}→${edge.to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgeList.push(_formatEdge(edge, "next"));
      }

      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        const targetRole = getRoleBySlug(edge.to);
        if (targetRole) _addNode(nodeMap, targetRole, "next", level + 1);
        queue.push({ slug: edge.to, level: level + 1 });
      }
    }

    // Reverse edges (previous roles)
    for (const edge of getPreviousEdges(current)) {
      const key = `${edge.from}→${edge.to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edgeList.push(_formatEdge(edge, "previous"));
      }

      if (!visited.has(edge.from)) {
        visited.add(edge.from);
        const sourceRole = getRoleBySlug(edge.from);
        if (sourceRole) _addNode(nodeMap, sourceRole, "previous", level + 1);
        queue.push({ slug: edge.from, level: level + 1 });
      }
    }
  }

  // Optionally add adjacent (skill-overlap) roles
  if (includeAdjacent && centerRole.adjacent_roles) {
    for (const adj of centerRole.adjacent_roles) {
      if (!visited.has(adj.slug)) {
        visited.add(adj.slug);
        const adjRole = getRoleBySlug(adj.slug);
        if (adjRole) {
          _addNode(nodeMap, adjRole, "adjacent", 1);
          edgeList.push({
            from: slug,
            to: adj.slug,
            type: "adjacent",
            skill_overlap_score: adj.skill_overlap_score || 0,
            label: `${adj.skill_overlap_score || 0}% overlap`,
          });
        }
      }
    }
  }

  return {
    center: slug,
    nodes: [...nodeMap.values()],
    edges: edgeList,
    meta: {
      total_nodes: nodeMap.size,
      total_edges: edgeList.length,
      depth,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function _addNode(nodeMap, role, relation, level) {
  if (nodeMap.has(role.slug)) return;
  nodeMap.set(role.slug, {
    id: role.slug,
    title: role.title,
    category: role.category,
    seniority: role.seniority,
    seniority_level: role.seniority_level,
    salary_mean: role.salary_uk?.mean || null,
    relation,
    level,
  });
}

function _formatEdge(edge, direction) {
  return {
    from: edge.from,
    to: edge.to,
    type: direction,
    difficulty_score: edge.difficulty_score,
    difficulty_label: edge.difficulty_label,
    estimated_years: edge.estimated_years,
    salary_growth_pct: edge.salary_growth_pct,
  };
}
