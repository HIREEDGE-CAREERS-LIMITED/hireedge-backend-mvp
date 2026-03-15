// ============================================================================
// lib/graph/careerPathEngine.js
// HireEdge — AI Career Intelligence Platform
// Career path discovery: shortest paths, all paths, and scored routes.
// ============================================================================

import { getRoleBySlug } from "../dataset/roleIndex.js";
import { getNextEdges, getPreviousEdges } from "../dataset/graphIndex.js";

/**
 * Find shortest career path from `fromSlug` to `toSlug` using BFS.
 * Returns null if no path exists.
 *
 * @param {string} fromSlug
 * @param {string} toSlug
 * @param {{ maxDepth?: number }} opts
 * @returns {{ path: string[], edges: object[], totalYears: number, totalDifficulty: number, totalSalaryGrowthPct: number } | null}
 */
export function findShortestPath(fromSlug, toSlug, opts = {}) {
  const maxDepth = opts.maxDepth || 8;
  if (fromSlug === toSlug) {
    return { path: [fromSlug], edges: [], totalYears: 0, totalDifficulty: 0, totalSalaryGrowthPct: 0 };
  }

  const visited = new Set([fromSlug]);
  const queue = [{ slug: fromSlug, trail: [fromSlug], edgeTrail: [] }];

  while (queue.length) {
    const { slug, trail, edgeTrail } = queue.shift();
    if (trail.length > maxDepth) continue;

    for (const edge of getNextEdges(slug)) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);

      const newTrail = [...trail, edge.to];
      const newEdges = [...edgeTrail, edge];

      if (edge.to === toSlug) {
        return _scorePath(newTrail, newEdges);
      }
      queue.push({ slug: edge.to, trail: newTrail, edgeTrail: newEdges });
    }
  }

  return null;
}

/**
 * Find ALL career paths from `fromSlug` to `toSlug` (DFS, capped).
 *
 * @param {string} fromSlug
 * @param {string} toSlug
 * @param {{ maxDepth?: number, maxResults?: number }} opts
 * @returns {Array<{ path: string[], edges: object[], totalYears: number, totalDifficulty: number, totalSalaryGrowthPct: number }>}
 */
export function findAllPaths(fromSlug, toSlug, opts = {}) {
  const maxDepth = opts.maxDepth || 6;
  const maxResults = opts.maxResults || 10;
  const results = [];

  function dfs(current, visited, trail, edgeTrail) {
    if (results.length >= maxResults) return;
    if (trail.length > maxDepth) return;

    if (current === toSlug) {
      results.push(_scorePath([...trail], [...edgeTrail]));
      return;
    }

    for (const edge of getNextEdges(current)) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      trail.push(edge.to);
      edgeTrail.push(edge);

      dfs(edge.to, visited, trail, edgeTrail);

      trail.pop();
      edgeTrail.pop();
      visited.delete(edge.to);
    }
  }

  const visited = new Set([fromSlug]);
  dfs(fromSlug, visited, [fromSlug], []);

  // Sort by composite score: lower difficulty + fewer years = better
  results.sort((a, b) => a.totalDifficulty - b.totalDifficulty || a.totalYears - b.totalYears);

  return results;
}

/**
 * Get immediate next-step career moves from a role, enriched with role details.
 *
 * @param {string} slug
 * @param {{ sortBy?: 'salary' | 'difficulty' | 'years' }} opts
 * @returns {Array<object>}
 */
export function getNextMoves(slug, opts = {}) {
  const edges = getNextEdges(slug);
  const enriched = edges.map((edge) => {
    const targetRole = getRoleBySlug(edge.to);
    return {
      slug: edge.to,
      title: edge.title,
      difficulty_score: edge.difficulty_score,
      difficulty_label: edge.difficulty_label,
      estimated_years: edge.estimated_years,
      salary_growth_pct: edge.salary_growth_pct,
      target_salary: targetRole?.salary_uk || null,
      target_seniority: targetRole?.seniority || null,
      target_category: targetRole?.category || null,
    };
  });

  const sortBy = opts.sortBy || "salary";
  if (sortBy === "salary") {
    enriched.sort((a, b) => (b.salary_growth_pct || 0) - (a.salary_growth_pct || 0));
  } else if (sortBy === "difficulty") {
    enriched.sort((a, b) => (a.difficulty_score || 0) - (b.difficulty_score || 0));
  } else if (sortBy === "years") {
    enriched.sort((a, b) => (a.estimated_years || 0) - (b.estimated_years || 0));
  }

  return enriched;
}

/**
 * Get roles that lead INTO the given role (entry routes).
 *
 * @param {string} slug
 * @returns {Array<object>}
 */
export function getPreviousMoves(slug) {
  const edges = getPreviousEdges(slug);
  return edges.map((edge) => {
    const sourceRole = getRoleBySlug(edge.from);
    return {
      slug: edge.from,
      title: sourceRole?.title || edge.from,
      difficulty_score: edge.difficulty_score,
      difficulty_label: edge.difficulty_label,
      estimated_years: edge.estimated_years,
      salary_growth_pct: edge.salary_growth_pct,
      source_salary: sourceRole?.salary_uk || null,
      source_seniority: sourceRole?.seniority || null,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function _scorePath(path, edges) {
  let totalYears = 0;
  let totalDifficulty = 0;
  let totalSalaryGrowthPct = 0;

  for (const e of edges) {
    totalYears += e.estimated_years || 0;
    totalDifficulty += e.difficulty_score || 0;
    totalSalaryGrowthPct += e.salary_growth_pct || 0;
  }

  return {
    path,
    steps: path.length - 1,
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      title: e.title,
      difficulty_score: e.difficulty_score,
      difficulty_label: e.difficulty_label,
      estimated_years: e.estimated_years,
      salary_growth_pct: e.salary_growth_pct,
    })),
    totalYears,
    totalDifficulty,
    totalSalaryGrowthPct,
  };
}
