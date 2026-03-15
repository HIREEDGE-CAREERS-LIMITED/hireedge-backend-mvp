// ============================================================================
// lib/dataset/roleIndex.js
// HireEdge — AI Career Intelligence Platform
// In-memory indexes for O(1) role lookups by slug, category, seniority, etc.
// ============================================================================

import { loadRoles } from "./loadDataset.js";

/** @type {Map<string, object> | null} */
let _bySlug = null;

/** @type {Map<string, Array<object>> | null} */
let _byCategory = null;

/** @type {Map<string, Array<object>> | null} */
let _bySeniority = null;

// ---------------------------------------------------------------------------
// Internal: build all indexes once
// ---------------------------------------------------------------------------
function _ensureIndexes() {
  if (_bySlug) return;

  const roles = loadRoles();
  _bySlug = new Map();
  _byCategory = new Map();
  _bySeniority = new Map();

  for (const role of roles) {
    // slug index
    _bySlug.set(role.slug, role);

    // category index
    if (!_byCategory.has(role.category)) _byCategory.set(role.category, []);
    _byCategory.get(role.category).push(role);

    // seniority index
    const sen = role.seniority || "Unknown";
    if (!_bySeniority.has(sen)) _bySeniority.set(sen, []);
    _bySeniority.get(sen).push(role);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a single role by its slug.
 * @param {string} slug
 * @returns {object | undefined}
 */
export function getRoleBySlug(slug) {
  _ensureIndexes();
  return _bySlug.get(slug);
}

/**
 * Get all roles in a category.
 * @param {string} category
 * @returns {Array<object>}
 */
export function getRolesByCategory(category) {
  _ensureIndexes();
  return _byCategory.get(category) || [];
}

/**
 * Get all roles at a given seniority level.
 * @param {string} seniority
 * @returns {Array<object>}
 */
export function getRolesBySeniority(seniority) {
  _ensureIndexes();
  return _bySeniority.get(seniority) || [];
}

/**
 * Return all unique category names.
 * @returns {string[]}
 */
export function getCategories() {
  _ensureIndexes();
  return [..._byCategory.keys()].sort();
}

/**
 * Return all unique seniority labels.
 * @returns {string[]}
 */
export function getSeniorities() {
  _ensureIndexes();
  return [..._bySeniority.keys()].sort();
}

/**
 * Full-text search across title, slug, category and skills.
 * Returns roles ranked by relevance (title match > category > skill).
 *
 * @param {string} query
 * @param {{ limit?: number, category?: string, seniority?: string }} opts
 * @returns {Array<object>}
 */
export function searchRoles(query, opts = {}) {
  _ensureIndexes();
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const limit = opts.limit || 20;
  const results = [];

  for (const role of _bySlug.values()) {
    if (opts.category && role.category !== opts.category) continue;
    if (opts.seniority && role.seniority !== opts.seniority) continue;

    let score = 0;
    const title = role.title.toLowerCase();
    const slug = role.slug;
    const cat = (role.category || "").toLowerCase();

    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 80;
    else if (title.includes(q)) score += 60;

    if (slug.includes(q)) score += 40;
    if (cat.includes(q)) score += 20;

    const skills = (role.skills || []).map((s) => s.toLowerCase());
    if (skills.some((s) => s === q)) score += 30;
    else if (skills.some((s) => s.includes(q))) score += 15;

    if (score > 0) results.push({ role, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => r.role);
}

/**
 * Return the full slug → role Map (for engines that need iteration).
 * @returns {Map<string, object>}
 */
export function getRoleMap() {
  _ensureIndexes();
  return _bySlug;
}
