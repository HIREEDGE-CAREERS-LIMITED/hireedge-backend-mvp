/**
 * ============================================================================
 * generate-career-graph.js
 * HireEdge Backend — Enrich career transitions for BFS pathfinding
 *
 * USAGE:
 *   node generate-career-graph.js
 *
 * What this script does:
 *   1. Reads data/roles-enriched.json
 *   2. Correctly loads fileData.roles when dataset is wrapped
 *   3. Removes stale top-level slug-keyed objects from a previous bad run
 *   4. Adds useful lateral / diagonal / progression transitions
 *   5. Builds previous_roles from next_roles
 *   6. Writes the cleaned + enriched dataset back
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "data", "roles-enriched.json");

// Add only high-value missing transitions.
// Your dataset already has many vertical transitions.
// These are mainly lateral / bridging edges to make BFS useful.
const EXTRA_TRANSITIONS = [
  // Data / Analytics / Product bridges
  ["data-analyst", "business-analyst", 3, 1, 10],
  ["data-analyst", "product-analyst", 4, 1.5, 15],
  ["data-analyst", "business-intelligence-analyst", 3, 1, 10],
  ["data-analyst", "analytics-engineer", 5, 2, 20],
  ["data-analyst", "data-engineer", 6, 2, 25],
  ["data-analyst", "data-scientist", 6, 2, 25],

  ["business-analyst", "product-analyst", 4, 1.5, 15],
  ["business-analyst", "product-owner", 4, 1.5, 15],
  ["business-analyst", "project-manager", 4, 1.5, 15],
  ["business-analyst", "business-intelligence-analyst", 3, 1, 10],

  ["product-analyst", "product-manager", 5, 2, 20],
  ["product-analyst", "senior-product-analyst", 4, 2, 15],
  ["product-analyst", "ux-researcher", 4, 1.5, 10],

  ["senior-product-analyst", "product-manager", 4, 1.5, 15],
  ["product-owner", "product-manager", 4, 1.5, 15],
  ["product-manager", "senior-product-manager", 4, 2, 20],
  ["senior-product-manager", "head-of-product", 5, 2.5, 20],
  ["head-of-product", "product-director", 4, 2, 15],
  ["product-director", "chief-product-officer", 6, 3.5, 25],

  // Data leadership
  ["data-scientist", "senior-data-scientist", 4, 2, 20],
  ["senior-data-scientist", "lead-data-scientist", 4, 2, 15],
  ["lead-data-scientist", "head-of-data-science", 5, 2.5, 20],
  ["head-of-data-science", "chief-data-officer", 6, 3, 25],

  ["data-engineer", "senior-data-engineer", 4, 2, 20],
  ["senior-data-engineer", "lead-data-engineer", 4, 2, 15],
  ["lead-data-engineer", "data-architect", 5, 2.5, 20],
  ["data-architect", "chief-data-officer", 6, 3.5, 25],

  ["analytics-engineer", "senior-analytics-engineer", 4, 2, 20],
  ["senior-analytics-engineer", "analytics-manager", 5, 2.5, 20],
  ["analytics-manager", "head-of-data", 5, 2.5, 20],
  ["head-of-data", "chief-data-officer", 6, 3, 25],

  // Engineering leadership
  ["software-engineer", "senior-software-engineer", 4, 2, 20],
  ["senior-software-engineer", "tech-lead", 4, 1.5, 15],
  ["tech-lead", "staff-engineer", 5, 2, 15],
  ["staff-engineer", "principal-engineer", 5, 2.5, 20],
  ["principal-engineer", "director-of-engineering", 6, 3, 20],
  ["director-of-engineering", "vp-of-engineering", 5, 2.5, 20],
  ["vp-of-engineering", "chief-technology-officer", 6, 3.5, 25],

  ["software-engineer", "backend-engineer", 3, 1, 10],
  ["software-engineer", "frontend-engineer", 3, 1, 10],
  ["software-engineer", "full-stack-engineer", 3, 1, 10],
  ["software-engineer", "data-engineer", 5, 2, 15],
  ["software-engineer", "devops-engineer", 5, 2, 15],

  ["backend-engineer", "senior-backend-engineer", 4, 2, 20],
  ["frontend-engineer", "senior-frontend-engineer", 4, 2, 20],
  ["full-stack-engineer", "senior-full-stack-engineer", 4, 2, 20],

  // Design / product bridge
  ["ux-designer", "senior-ux-designer", 4, 2, 15],
  ["ux-designer", "product-designer", 4, 1.5, 15],
  ["ux-designer", "ux-researcher", 4, 1.5, 10],
  ["ux-researcher", "product-analyst", 4, 1.5, 10],
  ["senior-ux-designer", "product-manager", 6, 2.5, 15],

  // Marketing / growth bridge
  ["marketing-analyst", "growth-analyst", 3, 1, 10],
  ["marketing-analyst", "data-analyst", 3, 1, 5],
  ["marketing-analyst", "product-analyst", 5, 2, 10],
  ["growth-analyst", "growth-manager", 4, 2, 15],
  ["growth-manager", "head-of-growth", 5, 2.5, 20],

  // Consulting / business bridge
  ["management-consultant", "business-analyst", 3, 1, 0],
  ["management-consultant", "product-manager", 5, 2, 10],
  ["strategy-consultant", "product-director", 6, 3, 15],

  // Project / delivery bridge
  ["project-manager", "programme-manager", 5, 2.5, 20],
  ["project-manager", "product-manager", 5, 2, 15],
  ["project-manager", "delivery-manager", 4, 1.5, 15],
  ["delivery-manager", "head-of-delivery", 5, 2.5, 20],

  // Security
  ["security-analyst", "security-engineer", 5, 2, 15],
  ["security-engineer", "senior-security-engineer", 4, 2, 20],
  ["senior-security-engineer", "security-architect", 5, 2.5, 20],
  ["security-architect", "head-of-security", 5, 2.5, 20],
  ["head-of-security", "chief-information-security-officer", 6, 3, 25],

  // QA
  ["qa-engineer", "senior-qa-engineer", 4, 2, 15],
  ["qa-engineer", "qa-automation-engineer", 4, 1.5, 15],
  ["senior-qa-engineer", "qa-lead", 4, 2, 15],
  ["qa-lead", "qa-manager", 4, 2, 15],
  ["qa-manager", "head-of-qa", 5, 2.5, 20],
];

function difficultyLabel(score) {
  if (score <= 3) return "easy";
  if (score <= 5) return "moderate";
  if (score <= 7) return "hard";
  return "very_hard";
}

function slugToTitle(slug) {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeRoleList(fileData) {
  if (Array.isArray(fileData)) {
    return { containerType: "array", roles: fileData };
  }

  if (fileData && Array.isArray(fileData.roles)) {
    return { containerType: "wrapped", roles: fileData.roles };
  }

  throw new Error("Unsupported dataset structure: expected array or object with roles[]");
}

function cleanupTopLevelSlugKeys(fileData) {
  if (!fileData || Array.isArray(fileData)) return 0;

  const protectedKeys = new Set(["version", "total", "roles"]);
  let removed = 0;

  for (const key of Object.keys(fileData)) {
    if (protectedKeys.has(key)) continue;

    const val = fileData[key];
    if (
      val &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      val.slug === key
    ) {
      delete fileData[key];
      removed++;
    }
  }

  return removed;
}

function ensureCareerPaths(role) {
  if (!role.career_paths || typeof role.career_paths !== "object") {
    role.career_paths = {};
  }
  if (!Array.isArray(role.career_paths.next_roles)) {
    role.career_paths.next_roles = [];
  }
  if (!Array.isArray(role.career_paths.previous_roles)) {
    role.career_paths.previous_roles = [];
  }
}

function normalizeEdge(edge) {
  if (!edge) return null;

  if (typeof edge === "string") {
    return { slug: edge, title: slugToTitle(edge) };
  }

  if (typeof edge === "object" && edge.slug) {
    return {
      slug: edge.slug,
      title: edge.title || slugToTitle(edge.slug),
      difficulty: edge.difficulty,
      difficulty_label: edge.difficulty_label,
      estimated_years: edge.estimated_years,
      salary_growth_pct: edge.salary_growth_pct,
    };
  }

  return null;
}

function dedupeEdges(edges) {
  const seen = new Set();
  const out = [];

  for (const edge of edges) {
    const normalized = normalizeEdge(edge);
    if (!normalized?.slug) continue;
    if (seen.has(normalized.slug)) continue;
    seen.add(normalized.slug);
    out.push(normalized);
  }

  return out;
}

function buildAdjacencyFromRoles(roles) {
  const adjacency = new Map();

  for (const role of roles) {
    const slug = role.slug || role.id;
    if (!slug) continue;

    ensureCareerPaths(role);
    const nextRoles = dedupeEdges(role.career_paths.next_roles);
    role.career_paths.next_roles = nextRoles;
    adjacency.set(slug, nextRoles);
  }

  return adjacency;
}

function addExtraTransitions(roleMap, adjacency) {
  let applied = 0;
  let skippedMissing = 0;

  for (const [from, to, difficulty, years, growth] of EXTRA_TRANSITIONS) {
    if (!roleMap.has(from) || !roleMap.has(to)) {
      skippedMissing++;
      continue;
    }

    if (!adjacency.has(from)) adjacency.set(from, []);
    const existing = adjacency.get(from);
    if (existing.some((e) => e.slug === to)) continue;

    existing.push({
      slug: to,
      title: roleMap.get(to)?.title || slugToTitle(to),
      difficulty,
      difficulty_label: difficultyLabel(difficulty),
      estimated_years: years,
      salary_growth_pct: growth,
    });
    applied++;
  }

  return { applied, skippedMissing };
}

function writeAdjacencyBackToRoles(roles, adjacency) {
  for (const role of roles) {
    const slug = role.slug || role.id;
    if (!slug) continue;

    ensureCareerPaths(role);
    role.career_paths.next_roles = dedupeEdges(adjacency.get(slug) || []);
  }
}

function rebuildPreviousRoles(roles, roleMap, adjacency) {
  for (const role of roles) {
    ensureCareerPaths(role);
    role.career_paths.previous_roles = [];
  }

  for (const [fromSlug, nextEdges] of adjacency.entries()) {
    const fromRole = roleMap.get(fromSlug);

    for (const edge of nextEdges) {
      const targetRole = roleMap.get(edge.slug);
      if (!targetRole) continue;

      ensureCareerPaths(targetRole);

      if (targetRole.career_paths.previous_roles.some((p) => p.slug === fromSlug)) {
        continue;
      }

      targetRole.career_paths.previous_roles.push({
        slug: fromSlug,
        title: fromRole?.title || slugToTitle(fromSlug),
        difficulty: edge.difficulty,
        difficulty_label: edge.difficulty_label,
        estimated_years: edge.estimated_years,
        salary_growth_pct: edge.salary_growth_pct,
      });
    }
  }

  for (const role of roles) {
    role.career_paths.previous_roles = dedupeEdges(role.career_paths.previous_roles);
  }
}

function bfs(adjacency, from, to) {
  if (from === to) return [from];
  if (!adjacency.has(from)) return null;

  const visited = new Set([from]);
  const queue = [[from]];

  while (queue.length) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = adjacency.get(current) || [];

    for (const edge of neighbors) {
      const next = edge.slug;
      if (!next || visited.has(next)) continue;

      const nextPath = [...path, next];
      if (next === to) return nextPath;

      visited.add(next);
      queue.push(nextPath);
    }
  }

  return null;
}

function countEdges(adjacency) {
  let total = 0;
  for (const edges of adjacency.values()) total += edges.length;
  return total;
}

function reachableCount(adjacency, start) {
  if (!adjacency.has(start)) return 0;

  const visited = new Set([start]);
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || [];

    for (const edge of neighbors) {
      const next = edge.slug;
      if (!next || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return visited.size - 1;
}

function main() {
  const raw = fs.readFileSync(DATA_PATH, "utf-8");
  const fileData = JSON.parse(raw);

  const { containerType, roles } = normalizeRoleList(fileData);
  console.log(`Loaded ${roles.length} roles from ${DATA_PATH} (${containerType})`);

  const removedTopLevel = cleanupTopLevelSlugKeys(fileData);
  if (removedTopLevel > 0) {
    console.log(`Cleaned ${removedTopLevel} stale top-level slug keys`);
  }

  const roleMap = new Map();
  for (const role of roles) {
    const slug = role.slug || role.id;
    if (slug) roleMap.set(slug, role);
  }

  let adjacency = buildAdjacencyFromRoles(roles);
  const beforeEdges = countEdges(adjacency);

  const { applied, skippedMissing } = addExtraTransitions(roleMap, adjacency);
  writeAdjacencyBackToRoles(roles, adjacency);
  rebuildPreviousRoles(roles, roleMap, adjacency);
  adjacency = buildAdjacencyFromRoles(roles);

  const afterEdges = countEdges(adjacency);

  let noNextRoles = 0;
  for (const role of roles) {
    ensureCareerPaths(role);
    if (!role.career_paths.next_roles.length) noNextRoles++;
  }

  console.log(`Edges before: ${beforeEdges}`);
  console.log(`Applied extra edges: ${applied}`);
  console.log(`Skipped missing-edge endpoints: ${skippedMissing}`);
  console.log(`Edges after: ${afterEdges}`);
  console.log(`Roles with no next_roles: ${noNextRoles}`);

  const tests = [
    ["data-analyst", "product-manager"],
    ["data-analyst", "business-analyst"],
    ["data-analyst", "chief-data-officer"],
    ["business-analyst", "head-of-product"],
    ["software-engineer", "chief-technology-officer"],
    ["ux-designer", "product-manager"],
    ["marketing-analyst", "product-manager"],
    ["project-manager", "chief-product-officer"],
  ];

  console.log("\nBFS tests:");
  for (const [from, to] of tests) {
    const pathResult = bfs(adjacency, from, to);
    if (pathResult) {
      console.log(`  ✓ ${from} → ${to}: ${pathResult.join(" → ")} (${pathResult.length - 1} steps)`);
    } else {
      console.log(`  ✗ ${from} → ${to}: NO PATH FOUND`);
    }
  }

  console.log(`\nReachable from data-analyst: ${reachableCount(adjacency, "data-analyst")} roles`);

  if (containerType === "array") {
    fs.writeFileSync(DATA_PATH, JSON.stringify(roles, null, 2), "utf-8");
  } else {
    fileData.roles = roles;
    fileData.total = roles.length;
    fs.writeFileSync(DATA_PATH, JSON.stringify(fileData, null, 2), "utf-8");
  }

  console.log(`\nWritten updated data to ${DATA_PATH}`);
  console.log("Done.");
}

main();
