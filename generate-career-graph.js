/**
 * ============================================================================
 * generate-career-graph.js
 * HireEdge Backend — Generate connected career transitions
 *
 * USAGE:
 *   node generate-career-graph.js
 *
 * This script:
 *   1. Reads data/roles-enriched.json
 *   2. Injects realistic career_paths.next_roles for every role
 *   3. Ensures the graph is fully connected (BFS can find paths)
 *   4. Writes the updated file back
 *
 * Run this in your hireedge-backend-mvp repo root.
 * ============================================================================
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Path to your dataset ───────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, "data", "roles-enriched.json");

// ── Career transition definitions ──────────────────────────────────────────
// Each entry: [from_slug, to_slug, difficulty(1-10), estimated_years, salary_growth_pct]
// These represent realistic UK career transitions.

const TRANSITIONS = [
  // DATA & ANALYTICS
  ["junior-data-analyst", "data-analyst", 3, 1.5, 25],
  ["junior-business-analyst", "business-analyst", 3, 1.5, 25],

  ["data-analyst", "senior-data-analyst", 4, 2, 20],
  ["data-analyst", "business-analyst", 3, 1, 10],
  ["data-analyst", "product-analyst", 4, 1.5, 15],
  ["data-analyst", "data-engineer", 6, 2, 30],
  ["data-analyst", "data-scientist", 6, 2, 25],
  ["data-analyst", "analytics-engineer", 5, 1.5, 25],
  ["data-analyst", "bi-developer", 4, 1, 15],

  ["senior-data-analyst", "lead-data-analyst", 4, 2, 15],
  ["senior-data-analyst", "analytics-manager", 5, 2, 20],
  ["senior-data-analyst", "data-scientist", 5, 1.5, 20],
  ["senior-data-analyst", "product-analyst", 3, 1, 10],
  ["senior-data-analyst", "data-engineer", 5, 1.5, 25],

  ["lead-data-analyst", "analytics-manager", 4, 1.5, 15],
  ["lead-data-analyst", "head-of-data", 6, 2.5, 30],
  ["analytics-manager", "head-of-data", 5, 2, 25],
  ["analytics-manager", "director-of-analytics", 6, 3, 30],

  ["bi-developer", "senior-bi-developer", 4, 2, 20],
  ["bi-developer", "analytics-engineer", 4, 1.5, 20],
  ["senior-bi-developer", "analytics-manager", 5, 2, 20],
  ["senior-bi-developer", "data-engineer", 5, 1.5, 20],

  ["analytics-engineer", "senior-analytics-engineer", 4, 2, 20],
  ["analytics-engineer", "data-engineer", 4, 1, 15],
  ["senior-analytics-engineer", "lead-data-engineer", 5, 2, 20],
  ["senior-analytics-engineer", "analytics-manager", 5, 2, 15],

  // BUSINESS ANALYSIS
  ["business-analyst", "senior-business-analyst", 4, 2, 20],
  ["business-analyst", "product-analyst", 4, 1.5, 15],
  ["business-analyst", "product-manager", 6, 2.5, 30],
  ["business-analyst", "data-analyst", 3, 0.5, 5],
  ["business-analyst", "project-manager", 4, 1.5, 15],
  ["business-analyst", "systems-analyst", 4, 1.5, 10],
  ["business-analyst", "business-intelligence-analyst", 3, 1, 10],

  ["senior-business-analyst", "lead-business-analyst", 4, 2, 15],
  ["senior-business-analyst", "product-manager", 5, 2, 25],
  ["senior-business-analyst", "product-owner", 4, 1.5, 20],
  ["senior-business-analyst", "programme-manager", 5, 2, 20],

  ["lead-business-analyst", "head-of-business-analysis", 5, 2, 20],
  ["lead-business-analyst", "delivery-manager", 5, 2, 15],

  ["business-intelligence-analyst", "bi-developer", 4, 1.5, 15],
  ["business-intelligence-analyst", "senior-data-analyst", 4, 1.5, 15],

  // PRODUCT
  ["product-analyst", "senior-product-analyst", 4, 2, 20],
  ["product-analyst", "product-manager", 5, 2, 25],
  ["product-analyst", "data-scientist", 6, 2, 20],
  ["product-analyst", "ux-researcher", 4, 1.5, 10],

  ["senior-product-analyst", "product-manager", 4, 1.5, 20],
  ["senior-product-analyst", "senior-product-manager", 5, 2, 25],

  ["product-manager", "senior-product-manager", 4, 2, 20],
  ["product-manager", "product-owner", 3, 0.5, 5],
  ["product-manager", "group-product-manager", 5, 2.5, 25],
  ["product-manager", "product-director", 6, 3, 35],
  ["product-manager", "programme-manager", 5, 2, 10],

  ["senior-product-manager", "group-product-manager", 4, 2, 20],
  ["senior-product-manager", "product-director", 5, 2.5, 25],
  ["senior-product-manager", "head-of-product", 5, 2, 25],

  ["group-product-manager", "head-of-product", 4, 2, 20],
  ["group-product-manager", "product-director", 4, 2, 20],

  ["product-director", "vp-of-product", 5, 3, 25],
  ["product-director", "chief-product-officer", 7, 4, 35],

  ["head-of-product", "vp-of-product", 5, 2.5, 20],
  ["vp-of-product", "chief-product-officer", 5, 3, 25],

  ["product-owner", "senior-product-owner", 4, 2, 15],
  ["product-owner", "product-manager", 4, 1.5, 15],
  ["senior-product-owner", "product-manager", 3, 1, 10],

  // DATA SCIENCE
  ["data-scientist", "senior-data-scientist", 4, 2, 20],
  ["data-scientist", "machine-learning-engineer", 5, 2, 25],
  ["data-scientist", "data-engineer", 5, 1.5, 15],
  ["data-scientist", "product-analyst", 3, 1, -5],

  ["senior-data-scientist", "lead-data-scientist", 4, 2, 15],
  ["senior-data-scientist", "principal-data-scientist", 5, 2.5, 20],
  ["senior-data-scientist", "machine-learning-engineer", 4, 1, 15],
  ["senior-data-scientist", "head-of-data-science", 6, 3, 30],

  ["lead-data-scientist", "head-of-data-science", 5, 2, 25],
  ["lead-data-scientist", "principal-data-scientist", 4, 2, 15],

  ["principal-data-scientist", "head-of-data-science", 4, 2, 20],
  ["head-of-data-science", "director-of-data-science", 5, 2.5, 25],
  ["director-of-data-science", "vp-of-data", 5, 3, 25],
  ["head-of-data", "vp-of-data", 5, 3, 25],

  // DATA ENGINEERING
  ["data-engineer", "senior-data-engineer", 4, 2, 20],
  ["data-engineer", "analytics-engineer", 3, 1, 10],
  ["data-engineer", "machine-learning-engineer", 5, 2, 20],
  ["data-engineer", "cloud-engineer", 5, 1.5, 15],
  ["data-engineer", "backend-engineer", 5, 1.5, 10],

  ["senior-data-engineer", "lead-data-engineer", 4, 2, 15],
  ["senior-data-engineer", "data-architect", 5, 2.5, 25],
  ["senior-data-engineer", "staff-data-engineer", 5, 2, 20],

  ["lead-data-engineer", "data-architect", 4, 2, 20],
  ["lead-data-engineer", "engineering-manager", 5, 2, 15],
  ["lead-data-engineer", "head-of-data-engineering", 5, 2.5, 25],

  ["data-architect", "principal-data-architect", 4, 2, 20],
  ["data-architect", "head-of-data-engineering", 5, 2, 20],
  ["principal-data-architect", "chief-data-officer", 7, 4, 40],

  ["staff-data-engineer", "principal-data-architect", 5, 2.5, 20],
  ["head-of-data-engineering", "director-of-engineering", 5, 3, 25],

  // ML / AI
  ["machine-learning-engineer", "senior-machine-learning-engineer", 4, 2, 20],
  ["machine-learning-engineer", "mlops-engineer", 4, 1.5, 15],
  ["machine-learning-engineer", "ai-engineer", 4, 1.5, 15],

  ["senior-machine-learning-engineer", "lead-machine-learning-engineer", 4, 2, 15],
  ["senior-machine-learning-engineer", "staff-machine-learning-engineer", 5, 2.5, 20],
  ["senior-machine-learning-engineer", "head-of-machine-learning", 6, 3, 30],

  ["ai-engineer", "senior-ai-engineer", 4, 2, 20],
  ["senior-ai-engineer", "head-of-ai", 6, 3, 30],

  ["mlops-engineer", "senior-mlops-engineer", 4, 2, 20],
  ["senior-mlops-engineer", "head-of-mlops", 5, 2.5, 25],

  // SOFTWARE ENGINEERING
  ["junior-software-engineer", "software-engineer", 3, 1.5, 25],
  ["software-engineer", "senior-software-engineer", 4, 2, 20],
  ["software-engineer", "frontend-engineer", 3, 1, 10],
  ["software-engineer", "backend-engineer", 3, 1, 10],
  ["software-engineer", "full-stack-engineer", 3, 1, 10],
  ["software-engineer", "data-engineer", 5, 2, 20],
  ["software-engineer", "devops-engineer", 5, 2, 20],

  ["senior-software-engineer", "staff-engineer", 5, 2.5, 20],
  ["senior-software-engineer", "engineering-manager", 5, 2, 15],
  ["senior-software-engineer", "tech-lead", 4, 1.5, 15],
  ["senior-software-engineer", "solutions-architect", 5, 2, 20],

  ["tech-lead", "engineering-manager", 4, 1.5, 15],
  ["tech-lead", "staff-engineer", 4, 2, 15],
  ["tech-lead", "principal-engineer", 5, 2.5, 20],

  ["staff-engineer", "principal-engineer", 5, 2.5, 20],
  ["staff-engineer", "director-of-engineering", 6, 3, 30],

  ["engineering-manager", "senior-engineering-manager", 4, 2, 20],
  ["engineering-manager", "director-of-engineering", 5, 2.5, 25],
  ["senior-engineering-manager", "director-of-engineering", 4, 2, 20],
  ["director-of-engineering", "vp-of-engineering", 5, 3, 25],
  ["vp-of-engineering", "cto", 6, 4, 35],

  ["frontend-engineer", "senior-frontend-engineer", 4, 2, 20],
  ["backend-engineer", "senior-backend-engineer", 4, 2, 20],
  ["full-stack-engineer", "senior-full-stack-engineer", 4, 2, 20],
  ["senior-frontend-engineer", "tech-lead", 5, 2, 15],
  ["senior-backend-engineer", "tech-lead", 5, 2, 15],
  ["senior-full-stack-engineer", "tech-lead", 5, 2, 15],

  ["devops-engineer", "senior-devops-engineer", 4, 2, 20],
  ["senior-devops-engineer", "site-reliability-engineer", 4, 1.5, 15],
  ["senior-devops-engineer", "cloud-architect", 5, 2, 25],
  ["site-reliability-engineer", "senior-site-reliability-engineer", 4, 2, 20],
  ["cloud-engineer", "senior-cloud-engineer", 4, 2, 20],
  ["senior-cloud-engineer", "cloud-architect", 5, 2, 20],
  ["cloud-architect", "solutions-architect", 4, 1.5, 15],
  ["solutions-architect", "enterprise-architect", 5, 2.5, 25],

  // UX / DESIGN
  ["ux-designer", "senior-ux-designer", 4, 2, 20],
  ["ux-designer", "product-designer", 4, 1.5, 15],
  ["ux-designer", "ux-researcher", 4, 1.5, 10],

  ["ux-researcher", "senior-ux-researcher", 4, 2, 20],
  ["ux-researcher", "product-analyst", 4, 1.5, 10],

  ["product-designer", "senior-product-designer", 4, 2, 20],
  ["senior-product-designer", "lead-product-designer", 4, 2, 15],
  ["senior-product-designer", "design-manager", 5, 2, 15],

  ["senior-ux-designer", "lead-ux-designer", 4, 2, 15],
  ["senior-ux-designer", "design-manager", 5, 2, 15],
  ["senior-ux-designer", "product-manager", 6, 2.5, 20],

  ["lead-ux-designer", "head-of-design", 5, 2.5, 25],
  ["lead-product-designer", "head-of-design", 5, 2, 25],
  ["design-manager", "head-of-design", 4, 2, 20],
  ["head-of-design", "vp-of-design", 5, 3, 25],

  // PROJECT / PROGRAMME
  ["project-manager", "senior-project-manager", 4, 2, 20],
  ["project-manager", "programme-manager", 5, 2.5, 25],
  ["project-manager", "product-manager", 5, 2, 20],
  ["project-manager", "delivery-manager", 4, 1.5, 15],
  ["project-manager", "scrum-master", 3, 1, 5],

  ["senior-project-manager", "programme-manager", 4, 2, 20],
  ["programme-manager", "senior-programme-manager", 4, 2, 20],
  ["senior-programme-manager", "head-of-delivery", 5, 2.5, 25],

  ["delivery-manager", "senior-delivery-manager", 4, 2, 15],
  ["senior-delivery-manager", "head-of-delivery", 5, 2, 20],

  ["scrum-master", "senior-scrum-master", 4, 2, 15],
  ["senior-scrum-master", "agile-coach", 4, 2, 20],
  ["agile-coach", "head-of-agile", 5, 2.5, 20],

  // CONSULTING
  ["management-consultant", "senior-management-consultant", 4, 2, 25],
  ["management-consultant", "business-analyst", 3, 1, -5],
  ["management-consultant", "product-manager", 5, 2, 15],
  ["management-consultant", "strategy-consultant", 4, 1.5, 20],

  ["senior-management-consultant", "principal-consultant", 4, 2, 20],
  ["senior-management-consultant", "engagement-manager", 5, 2, 20],
  ["principal-consultant", "partner", 6, 3, 40],

  ["strategy-consultant", "senior-strategy-consultant", 4, 2, 25],
  ["senior-strategy-consultant", "product-director", 6, 3, 20],

  // MARKETING / GROWTH
  ["marketing-analyst", "senior-marketing-analyst", 4, 2, 20],
  ["marketing-analyst", "data-analyst", 3, 1, 5],
  ["marketing-analyst", "growth-analyst", 3, 1, 10],
  ["marketing-analyst", "product-analyst", 5, 2, 15],

  ["growth-analyst", "growth-manager", 4, 2, 20],
  ["growth-manager", "head-of-growth", 5, 2.5, 25],

  ["digital-marketing-manager", "senior-digital-marketing-manager", 4, 2, 20],
  ["digital-marketing-manager", "head-of-marketing", 5, 2.5, 25],

  // CYBERSECURITY
  ["security-analyst", "senior-security-analyst", 4, 2, 20],
  ["security-analyst", "security-engineer", 5, 2, 20],
  ["security-engineer", "senior-security-engineer", 4, 2, 20],
  ["senior-security-engineer", "security-architect", 5, 2.5, 25],
  ["security-architect", "head-of-security", 5, 2.5, 25],
  ["head-of-security", "ciso", 6, 3, 35],

  // QA / TESTING
  ["qa-engineer", "senior-qa-engineer", 4, 2, 20],
  ["qa-engineer", "qa-automation-engineer", 4, 1.5, 15],
  ["senior-qa-engineer", "qa-lead", 4, 2, 15],
  ["qa-automation-engineer", "senior-qa-automation-engineer", 4, 2, 20],
  ["senior-qa-automation-engineer", "sdet", 4, 1.5, 15],
  ["qa-lead", "qa-manager", 4, 2, 15],
  ["qa-manager", "head-of-qa", 5, 2.5, 25],
];

// ── Difficulty labels ──────────────────────────────────────────────────────

function difficultyLabel(score) {
  if (score <= 3) return "easy";
  if (score <= 5) return "moderate";
  if (score <= 7) return "hard";
  return "very_hard";
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  let roles;
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    roles = JSON.parse(raw);
  } catch (err) {
    console.error("Could not read", DATA_PATH, err.message);
    console.log("\nMake sure you run this from the backend repo root.");
    process.exit(1);
  }

  const isArray = Array.isArray(roles);
  const roleList = isArray ? roles : Object.values(roles);
  const roleMap = new Map();

  for (const role of roleList) {
    const slug = role.slug || role.id;
    if (slug) roleMap.set(slug, role);
  }

  console.log(`Loaded ${roleMap.size} roles from ${DATA_PATH}`);

  const adjacency = new Map();
  let applied = 0;
  const missingRoles = new Set();

  for (const [from, to, difficulty, years, growth] of TRANSITIONS) {
    if (!roleMap.has(from)) missingRoles.add(from);
    if (!roleMap.has(to)) missingRoles.add(to);

    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({
      slug: to,
      difficulty,
      difficulty_label: difficultyLabel(difficulty),
      estimated_years: years,
      salary_growth_pct: growth,
    });
    applied++;
  }

  console.log(`Defined ${applied} transitions`);

  let created = 0;
  for (const slug of missingRoles) {
    if (!roleMap.has(slug)) {
      const title = slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const stub = {
        slug,
        title,
        category: inferCategory(slug),
        seniority: inferSeniority(slug),
        seniority_level: inferSeniorityLevel(slug),
        skills: [],
        skills_grouped: { core: [], technical: [], soft: [] },
        salary_uk: null,
        career_paths: { next_roles: [], previous_roles: [] },
        ai_context: { summary: `${title} role.` },
      };

      roleMap.set(slug, stub);

      if (isArray) {
        roles.push(stub);
      } else {
        roles[slug] = stub;
      }
      created++;
    }
  }

  if (created > 0) {
    console.log(`Created ${created} stub roles for missing references`);
  }

  for (const [slug, role] of roleMap) {
    if (!role.career_paths) role.career_paths = {};
    if (!role.career_paths.next_roles) role.career_paths.next_roles = [];
    if (!role.career_paths.previous_roles) role.career_paths.previous_roles = [];

    const transitions = adjacency.get(slug) || [];
    const existingSlugs = new Set(role.career_paths.next_roles.map((r) => r.slug));

    for (const t of transitions) {
      if (!existingSlugs.has(t.slug)) {
        const targetRole = roleMap.get(t.slug);
        role.career_paths.next_roles.push({
          slug: t.slug,
          title:
            targetRole?.title ||
            t.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          difficulty: t.difficulty,
          difficulty_label: t.difficulty_label,
          estimated_years: t.estimated_years,
          salary_growth_pct: t.salary_growth_pct,
        });
      }
    }
  }

  for (const [fromSlug, transitions] of adjacency) {
    for (const t of transitions) {
      const targetRole = roleMap.get(t.slug);
      if (!targetRole) continue;

      if (!targetRole.career_paths) targetRole.career_paths = {};
      if (!targetRole.career_paths.previous_roles) {
        targetRole.career_paths.previous_roles = [];
      }

      const alreadyHas = targetRole.career_paths.previous_roles.some(
        (p) => p.slug === fromSlug
      );

      if (!alreadyHas) {
        const fromRole = roleMap.get(fromSlug);
        targetRole.career_paths.previous_roles.push({
          slug: fromSlug,
          title:
            fromRole?.title ||
            fromSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          difficulty: t.difficulty,
          difficulty_label: t.difficulty_label,
          estimated_years: t.estimated_years,
          salary_growth_pct: t.salary_growth_pct,
        });
      }
    }
  }

  const allSlugs = new Set(roleMap.keys());
  const hasOutgoing = new Set(adjacency.keys());
  const hasIncoming = new Set();

  for (const transitions of adjacency.values()) {
    for (const t of transitions) hasIncoming.add(t.slug);
  }

  const isolated = [...allSlugs].filter((s) => !hasOutgoing.has(s) && !hasIncoming.has(s));
  const deadEnds = [...allSlugs].filter((s) => hasIncoming.has(s) && !hasOutgoing.has(s));
  const sources = [...allSlugs].filter((s) => hasOutgoing.has(s) && !hasIncoming.has(s));

  console.log(`\nGraph stats:`);
  console.log(`  Total roles: ${allSlugs.size}`);
  console.log(`  Roles with outgoing transitions: ${hasOutgoing.size}`);
  console.log(`  Roles with incoming transitions: ${hasIncoming.size}`);
  console.log(`  Dead ends (no outgoing): ${deadEnds.length}`);
  console.log(`  Sources (no incoming): ${sources.length}`);
  console.log(`  Isolated (no connections): ${isolated.length}`);

  const testPaths = [
    ["data-analyst", "product-manager"],
    ["data-analyst", "data-architect"],
    ["software-engineer", "cto"],
    ["business-analyst", "head-of-product"],
  ];

  console.log(`\nBFS path tests:`);
  for (const [from, to] of testPaths) {
    const result = bfs(adjacency, from, to);
    if (result) {
      console.log(`  ${from} → ${to}: ${result.join(" → ")} (${result.length - 1} steps)`);
    } else {
      console.log(`  ${from} → ${to}: NO PATH FOUND`);
    }
  }

  const output = JSON.stringify(isArray ? roles : roles, null, 2);
  fs.writeFileSync(DATA_PATH, output, "utf-8");

  console.log(`\nWritten updated data to ${DATA_PATH}`);
  console.log("Done.");
}

// ── BFS for testing ────────────────────────────────────────────────────────

function bfs(adjacency, from, to) {
  if (from === to) return [from];

  const visited = new Set([from]);
  const queue = [[from]];

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const neighbors = adjacency.get(current) || [];

    for (const n of neighbors) {
      if (visited.has(n.slug)) continue;
      const newPath = [...path, n.slug];
      if (n.slug === to) return newPath;
      visited.add(n.slug);
      queue.push(newPath);
    }
  }

  return null;
}

// ── Helpers for stub role creation ─────────────────────────────────────────

function inferCategory(slug) {
  if (slug.includes("data") || slug.includes("analytics") || slug.includes("bi-")) {
    return "Data & Analytics";
  }
  if (slug.includes("product")) return "Product";
  if (
    slug.includes("engineer") ||
    slug.includes("developer") ||
    slug.includes("architect") ||
    slug.includes("devops") ||
    slug.includes("sre") ||
    slug.includes("cloud")
  ) {
    return "Engineering";
  }
  if (slug.includes("machine-learning") || slug.includes("ml") || slug.includes("ai")) {
    return "Machine Learning & AI";
  }
  if (slug.includes("design") || slug.includes("ux")) return "Design";
  if (slug.includes("security") || slug.includes("ciso")) return "Cybersecurity";
  if (
    slug.includes("project") ||
    slug.includes("programme") ||
    slug.includes("delivery") ||
    slug.includes("scrum") ||
    slug.includes("agile")
  ) {
    return "Project Management";
  }
  if (slug.includes("business") || slug.includes("consult") || slug.includes("strategy")) {
    return "Business & Consulting";
  }
  if (slug.includes("marketing") || slug.includes("growth")) return "Marketing";
  if (slug.includes("qa") || slug.includes("test") || slug.includes("sdet")) {
    return "Quality Assurance";
  }
  if (slug.includes("cto") || slug.includes("cpo") || slug.includes("cdo") || slug.includes("vp-")) {
    return "Leadership";
  }
  return "General";
}

function inferSeniority(slug) {
  if (slug.startsWith("junior-")) return "Junior";
  if (slug.startsWith("senior-")) return "Senior";
  if (slug.startsWith("lead-")) return "Lead";
  if (slug.startsWith("principal-")) return "Principal";
  if (slug.startsWith("staff-")) return "Staff";
  if (slug.startsWith("head-of-")) return "Head";
  if (slug.startsWith("director-")) return "Director";
  if (slug.startsWith("vp-")) return "VP";
  if (slug.startsWith("chief-") || slug === "cto" || slug === "ciso") return "C-Level";
  return "Mid";
}

function inferSeniorityLevel(slug) {
  const map = {
    Junior: 1,
    Mid: 2,
    Senior: 3,
    Lead: 4,
    Staff: 4,
    Principal: 5,
    Head: 5,
    Director: 6,
    VP: 7,
    "C-Level": 8,
  };
  return map[inferSeniority(slug)] || 2;
}

main();
