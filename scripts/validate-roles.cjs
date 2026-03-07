#!/usr/bin/env node

/**
 * HireEdge — Role Dataset Validator
 * scripts/validate-roles.js
 *
 * Usage:  node scripts/validate-roles.js
 *         node scripts/validate-roles.js --verbose
 *
 * Exit codes:
 *   0  — all checks passed (warnings are allowed)
 *   1  — one or more critical errors detected
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const DATASET_PATH = path.resolve(__dirname, '../data/roles-enriched.json');
const VERBOSE      = process.argv.includes('--verbose');

const REQUIRED_FIELDS = [
  'slug',
  'title',
  'category',
  'seniority',
  'skills',
  'salary_uk',
  'career_paths',
  'uk_soc_2020',
];

// Skills count below this triggers a weak-enrichment warning
const MIN_SKILLS = 4;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

function pass(msg)  { console.log(`  ${GREEN}✔${RESET}  ${msg}`); }
function fail(msg)  { console.log(`  ${RED}✘${RESET}  ${RED}${msg}${RESET}`); }
function warn(msg)  { console.log(`  ${YELLOW}⚠${RESET}  ${YELLOW}${msg}${RESET}`); }
function info(msg)  { console.log(`  ${CYAN}→${RESET}  ${DIM}${msg}${RESET}`); }
function header(msg){ console.log(`\n${BOLD}${msg}${RESET}`); }
function rule()     { console.log(`${DIM}${'─'.repeat(60)}${RESET}`); }

// ─────────────────────────────────────────────
// Load & parse
// ─────────────────────────────────────────────
header('HireEdge Role Dataset Validator');
rule();

if (!fs.existsSync(DATASET_PATH)) {
  fail(`Dataset not found at: ${DATASET_PATH}`);
  process.exit(1);
}

let dataset;
try {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  dataset   = JSON.parse(raw);
} catch (err) {
  fail(`Failed to parse JSON: ${err.message}`);
  process.exit(1);
}

if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.roles)) {
  fail('dataset.roles is missing or not an array. Expected a structured object with a top-level "roles" array.');
  process.exit(1);
}

const roles   = dataset.roles;
const slugSet = new Set(roles.map(r => r.slug).filter(Boolean));

// ─────────────────────────────────────────────
// Accumulators
// ─────────────────────────────────────────────
const errors   = [];  // critical — causes exit 1
const warnings = [];  // non-critical

// ─────────────────────────────────────────────
// CHECK 1 — Role count
// ─────────────────────────────────────────────
header('CHECK 1 — Role Count');
rule();

const declared = dataset.total_roles;
const actual   = roles.length;

console.log(`  Dataset name : ${dataset.dataset_name || '(not set)'}`);
console.log(`  Version      : ${dataset.version      || '(not set)'}`);
console.log(`  Declared     : ${declared}`);
console.log(`  Actual       : ${actual}`);

if (declared !== undefined && declared !== actual) {
  warn(`total_roles declares ${declared} but array contains ${actual}.`);
  warnings.push(`total_roles mismatch (declared ${declared}, actual ${actual})`);
} else {
  pass(`Total roles: ${actual}`);
}

// ─────────────────────────────────────────────
// CHECK 2 — Duplicate slugs
// ─────────────────────────────────────────────
header('CHECK 2 — Duplicate Slugs');
rule();

const slugCounts = {};
roles.forEach(r => {
  if (r.slug) slugCounts[r.slug] = (slugCounts[r.slug] || 0) + 1;
});
const duplicates = Object.entries(slugCounts).filter(([, n]) => n > 1);

if (duplicates.length === 0) {
  pass('No duplicate slugs found.');
} else {
  fail(`${duplicates.length} duplicate slug(s) detected.`);
  errors.push(`${duplicates.length} duplicate slug(s)`);
  duplicates.forEach(([slug, count]) => info(`"${slug}" appears ${count} times`));
}

// ─────────────────────────────────────────────
// CHECK 3 — Required fields
// ─────────────────────────────────────────────
header('CHECK 3 — Required Fields');
rule();

const missingFieldMap = {}; // field → [slug, …]
let   totalFieldErrors = 0;

roles.forEach(r => {
  const id = r.slug || '(no-slug)';
  REQUIRED_FIELDS.forEach(field => {
    const val = r[field];
    const missing =
      val === undefined ||
      val === null      ||
      val === ''        ||
      (Array.isArray(val) && val.length === 0 && field === 'skills');

    if (missing) {
      if (!missingFieldMap[field]) missingFieldMap[field] = [];
      missingFieldMap[field].push(id);
      totalFieldErrors++;
    }
  });
});

if (totalFieldErrors === 0) {
  pass('All roles contain every required field.');
} else {
  fail(`${totalFieldErrors} missing-field issue(s) across ${Object.keys(missingFieldMap).length} field(s).`);
  errors.push(`${totalFieldErrors} missing required field(s)`);
  Object.entries(missingFieldMap).forEach(([field, slugs]) => {
    info(`"${field}" missing in ${slugs.length} role(s)${VERBOSE ? ': ' + slugs.join(', ') : ''}`);
  });
}

// ─────────────────────────────────────────────
// CHECK 4 — career_paths structure
// ─────────────────────────────────────────────
header('CHECK 4 — career_paths Structure');
rule();

const badCareerPaths = [];

roles.forEach(r => {
  const id = r.slug || '(no-slug)';
  const cp = r.career_paths;

  if (!cp || typeof cp !== 'object') {
    badCareerPaths.push({ id, reason: 'career_paths is missing or not an object' });
    return;
  }
  if (!Array.isArray(cp.next_roles)) {
    badCareerPaths.push({ id, reason: 'next_roles is not an array' });
  }
  if (!Array.isArray(cp.previous_roles)) {
    badCareerPaths.push({ id, reason: 'previous_roles is not an array' });
  }
});

if (badCareerPaths.length === 0) {
  pass('All career_paths structures are valid.');
} else {
  fail(`${badCareerPaths.length} role(s) have invalid career_paths.`);
  errors.push(`${badCareerPaths.length} invalid career_paths structure(s)`);
  if (VERBOSE) badCareerPaths.forEach(({ id, reason }) => info(`"${id}": ${reason}`));
}

// ─────────────────────────────────────────────
// CHECK 5 — Broken linked slugs
// ─────────────────────────────────────────────
header('CHECK 5 — Broken Linked Slugs');
rule();

const brokenNext = [];
const brokenPrev = [];

roles.forEach(r => {
  const id = r.slug || '(no-slug)';
  const cp = r.career_paths || {};

  (cp.next_roles || []).forEach(target => {
    if (!slugSet.has(target)) brokenNext.push({ from: id, to: target });
  });
  (cp.previous_roles || []).forEach(target => {
    if (!slugSet.has(target)) brokenPrev.push({ from: id, to: target });
  });
});

const totalBroken = brokenNext.length + brokenPrev.length;

if (totalBroken === 0) {
  pass('All career path slugs resolve to existing roles.');
} else {
  fail(`${totalBroken} broken slug reference(s): ${brokenNext.length} in next_roles, ${brokenPrev.length} in previous_roles.`);
  errors.push(`${totalBroken} broken slug reference(s)`);
  if (VERBOSE) {
    brokenNext.forEach(({ from, to }) => info(`next_roles:  "${from}" → "${to}" (not found)`));
    brokenPrev.forEach(({ from, to }) => info(`prev_roles:  "${from}" ← "${to}" (not found)`));
  } else if (totalBroken <= 10) {
    brokenNext.forEach(({ from, to }) => info(`next: "${from}" → "${to}"`));
    brokenPrev.forEach(({ from, to }) => info(`prev: "${from}" ← "${to}"`));
  }
}

// ─────────────────────────────────────────────
// CHECK 6 — Weak enrichment
// ─────────────────────────────────────────────
header('CHECK 6 — Weak Enrichment');
rule();

const weakRoles = {
  missingSkills  : [],
  tooFewSkills   : [],
  missingSalary  : [],
  missingCategory: [],
  missingSeniority: [],
};

roles.forEach(r => {
  const id = r.slug || '(no-slug)';

  if (!r.skills || !Array.isArray(r.skills) || r.skills.length === 0) {
    weakRoles.missingSkills.push(id);
  } else if (r.skills.length < MIN_SKILLS) {
    weakRoles.tooFewSkills.push(id);
  }

  if (!r.salary_uk || typeof r.salary_uk !== 'object') {
    weakRoles.missingSalary.push(id);
  }

  if (!r.category || r.category.trim() === '') {
    weakRoles.missingCategory.push(id);
  }

  if (!r.seniority || r.seniority.trim() === '') {
    weakRoles.missingSeniority.push(id);
  }
});

const totalWeak = Object.values(weakRoles).reduce((s, a) => s + a.length, 0);

if (totalWeak === 0) {
  pass('All roles are fully enriched.');
} else {
  warn(`${totalWeak} weak-enrichment issue(s) found.`);
  warnings.push(`${totalWeak} weak enrichment issue(s)`);

  const entries = [
    ['Missing skills entirely', weakRoles.missingSkills],
    [`Too few skills (< ${MIN_SKILLS})`, weakRoles.tooFewSkills],
    ['Missing salary_uk',       weakRoles.missingSalary],
    ['Missing category',        weakRoles.missingCategory],
    ['Missing seniority',       weakRoles.missingSeniority],
  ];

  entries.forEach(([label, list]) => {
    if (list.length > 0) {
      info(`${label}: ${list.length} role(s)${VERBOSE ? ' — ' + list.join(', ') : ''}`);
    }
  });
}

// ─────────────────────────────────────────────
// CHECK 7 — Isolated roles
// ─────────────────────────────────────────────
header('CHECK 7 — Isolated Roles');
rule();

const isolatedRoles = roles.filter(r => {
  const cp = r.career_paths || {};
  return (
    (!cp.next_roles     || cp.next_roles.length     === 0) &&
    (!cp.previous_roles || cp.previous_roles.length === 0)
  );
});

if (isolatedRoles.length === 0) {
  pass('No isolated roles (all roles have at least one graph edge).');
} else {
  warn(`${isolatedRoles.length} isolated role(s) with no next_roles and no previous_roles.`);
  warnings.push(`${isolatedRoles.length} isolated role(s)`);
  if (VERBOSE || isolatedRoles.length <= 10) {
    isolatedRoles.forEach(r => info(`"${r.slug}" — ${r.title} (${r.category})`));
  }
}

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────
header('Summary');
rule();

const categoryCount = new Set(roles.map(r => r.category).filter(Boolean)).size;
const seniorityDist = {};
roles.forEach(r => {
  if (r.seniority) seniorityDist[r.seniority] = (seniorityDist[r.seniority] || 0) + 1;
});

console.log(`\n  ${BOLD}Dataset stats${RESET}`);
console.log(`  Total roles        : ${BOLD}${actual}${RESET}`);
console.log(`  Categories         : ${categoryCount}`);
console.log(`  Seniority spread   : ${Object.entries(seniorityDist).map(([k, v]) => `${k}(${v})`).join(', ')}`);

console.log(`\n  ${BOLD}Validation results${RESET}`);
console.log(`  Critical errors    : ${errors.length   > 0 ? RED + BOLD + errors.length   + RESET : GREEN + '0' + RESET}`);
console.log(`  Warnings           : ${warnings.length > 0 ? YELLOW + warnings.length    + RESET : GREEN + '0' + RESET}`);

if (errors.length > 0) {
  console.log(`\n  ${RED}${BOLD}Errors:${RESET}`);
  errors.forEach(e => console.log(`    ${RED}• ${e}${RESET}`));
}
if (warnings.length > 0) {
  console.log(`\n  ${YELLOW}Warnings:${RESET}`);
  warnings.forEach(w => console.log(`    ${YELLOW}• ${w}${RESET}`));
}

rule();

if (errors.length > 0) {
  console.log(`\n${RED}${BOLD}RESULT: FAILED — ${errors.length} critical error(s) must be resolved.${RESET}\n`);
  process.exit(1);
} else if (warnings.length > 0) {
  console.log(`\n${YELLOW}${BOLD}RESULT: PASSED WITH WARNINGS — review the items above.${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${GREEN}${BOLD}RESULT: ALL CHECKS PASSED ✔${RESET}\n`);
  process.exit(0);
}
