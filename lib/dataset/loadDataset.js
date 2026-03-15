// ============================================================================
// lib/dataset/loadDataset.js
// HireEdge — AI Career Intelligence Platform
// Singleton dataset loader with warm-cache for Vercel serverless functions.
// ============================================================================

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, "../../data/roles-enriched.json");

/** @type {{ version: string, total: number, roles: Array<object> } | null} */
let _cache = null;

/**
 * Load and return the full roles-enriched dataset.
 * The result is cached in module scope so subsequent invocations within
 * the same serverless cold-start pay zero I/O cost.
 *
 * @returns {{ version: string, total: number, roles: Array<object> }}
 */
export function loadDataset() {
  if (_cache) return _cache;

  const raw = readFileSync(DATA_PATH, "utf-8");
  _cache = JSON.parse(raw);

  return _cache;
}

/**
 * Return only the roles array (convenience shorthand).
 * @returns {Array<object>}
 */
export function loadRoles() {
  return loadDataset().roles;
}
