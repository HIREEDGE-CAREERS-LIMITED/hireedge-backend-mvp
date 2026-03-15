'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  HireEdge — Career Salary Engine
 *  v1.0.0
 *
 *  Answers salary-driven career questions:
 *    • Which moves increase my salary the most?
 *    • What is the salary progression across my career path?
 *    • Which high-growth transitions exist across the whole market?
 *    • Which moves maximise salary gain per skill learned?
 *    • How do multiple target roles compare on salary potential?
 *
 *  Data sources (loaded on init):
 *    • career-salary-intelligence.json   — pre-computed salary moves + leaderboards
 *    • roles-expanded.json               — full role metadata (salary, industries, skills)
 *
 *  QUICK START
 *  ───────────
 *  const salary = require('./career-salary-engine');
 *  salary.load({
 *    intelligence: './career-salary-intelligence.json',
 *    roles:        './roles-expanded.json',
 *  });
 *
 *  salary.findBestSalaryMoves('data-analyst');
 *  salary.findSalaryProgression('junior-data-analyst');
 *  salary.findHighGrowthTransitions(30000);
 *  salary.findBestSalaryEfficiencyMoves('data-analyst');
 *  salary.compareSalaryPaths('data-analyst', ['data-scientist', 'analytics-manager', 'data-engineer']);
 *
 *  FULL API
 *  ────────
 *  Core
 *    findBestSalaryMoves(role, opts?)
 *    findSalaryProgression(role, opts?)
 *    findHighGrowthTransitions(minIncrease, opts?)
 *    findBestSalaryEfficiencyMoves(role, opts?)
 *    compareSalaryPaths(fromRole, targetRoles, opts?)
 *
 *  Extended
 *    findSalaryByCategory(category, opts?)
 *    findTopEarningRoles(opts?)
 *    getSalaryBenchmark(role)
 *    findQuickWins(role, opts?)
 *    getLeaderboard(type, opts?)
 *
 *  Utilities
 *    getRole(role)
 *    listCategories()
 *    graphStats()
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');

// ── Internal state ────────────────────────────────────────────────────────────

let _intel     = null;   // salary intelligence roles map: { [slug]: entry }
let _leaderboards = null;// global leaderboards object
let _roleMap   = null;   // roles-expanded map:            { [slug]: role }
let _loaded    = false;

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load both data sources into memory. Must be called before any query.
 *
 * @param   {object} paths
 * @param   {string} paths.intelligence  Path to career-salary-intelligence.json
 * @param   {string} paths.roles         Path to roles-expanded.json
 * @returns {object}                     Summary of loaded data
 *
 * @example
 * salary.load({
 *   intelligence: './career-salary-intelligence.json',
 *   roles:        './roles-expanded.json',
 * });
 */
function load(paths = {}) {
  const read = (p, label) => {
    if (!p) throw new Error(`[SalaryEngine] Missing path for: ${label}`);
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`[SalaryEngine] File not found: ${abs}`);
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  };

  const intelData = read(paths.intelligence, 'intelligence');
  const rolesData = read(paths.roles,        'roles');

  // Index salary intelligence by slug
  _intel        = intelData.roles        || {};
  _leaderboards = intelData.global_leaderboards || {};

  // Index roles-expanded by slug; resolve salary for each
  _roleMap = {};
  for (const role of (rolesData.roles || [])) {
    _roleMap[role.slug] = role;
  }

  _loaded = true;

  const summary = {
    roles_with_salary_data: Object.keys(_intel).length,
    roles_in_graph:         Object.keys(_roleMap).length,
    total_salary_options:   intelData.total_options,
    version:                intelData.version,
  };

  console.log(
    `[SalaryEngine] Loaded — ` +
    `${summary.roles_with_salary_data} salary entries · ` +
    `${summary.total_salary_options} progression options · ` +
    `${summary.roles_in_graph} roles`
  );

  return summary;
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _guard() {
  if (!_loaded) {
    throw new Error(
      '[SalaryEngine] Not loaded. Call salary.load({ intelligence, roles }) first.'
    );
  }
}

const _norm    = (s) => (s || '').trim().toLowerCase();
const _slugify = (s) => _norm(s).replace(/\s+/g, '-');

/** Resolve slug, slugified title, or exact title → role node from roles-expanded */
function _resolveRole(input) {
  if (!input) return null;
  if (_roleMap[input])   return _roleMap[input];
  const s = _slugify(input);
  if (_roleMap[s])       return _roleMap[s];
  const needle = _norm(input);
  return Object.values(_roleMap).find((r) => _norm(r.title) === needle) || null;
}

/** Resolve a role and return its salary intelligence entry + role node together */
function _resolvePair(input) {
  const role  = _resolveRole(input);
  if (!role) return { role: null, entry: null };
  const entry = _intel[role.slug] || null;
  return { role, entry };
}

/**
 * Resolve the best available mean salary for a role node.
 * Priority: stored mean → computed (min+max)/2 → null
 */
function _resolveSalary(roleNode) {
  if (!roleNode) return null;
  const s = roleNode.salary_uk || {};
  if (s.mean)           return s.mean;
  if (s.min && s.max)   return Math.round((s.min + s.max) / 2);
  return null;
}

/** Format a salary progression option into a clean public-facing object */
function _formatOption(opt, includeSkills = true) {
  const out = {
    target_role:              opt.target_role,
    target_title:             opt.target_title,
    target_category:          opt.target_category,
    target_salary_mean:       opt.target_salary_mean,
    salary_increase:          opt.salary_increase,
    salary_increase_pct:      opt.salary_increase_pct,
    salary_efficiency_score:  opt.salary_efficiency_score,
    difficulty:               opt.difficulty,
    missing_skills_count:     opt.missing_skills_count,
    skill_overlap_pct:        opt.skill_overlap_pct,
    is_direct_path:           opt.is_direct_path,
    is_cross_department:      opt.is_cross_department,
  };
  if (includeSkills) {
    out.missing_skills = opt.missing_skills;
  }
  return out;
}

/** Difficulty rank for sorting (lower = easier) */
const DIFF_RANK = { easy: 0, medium: 1, hard: 2, very_hard: 3 };

// ── Core functions ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find the moves from a role that deliver the largest salary increase.
 * Returns options sorted by absolute salary gain descending.
 *
 * Answers: "Which next role gives me the biggest pay rise?"
 *
 * @param   {string} role                    Slug or title
 * @param   {object} [opts]
 * @param   {number}  [opts.limit=10]         Max results
 * @param   {boolean} [opts.positiveOnly=true] Exclude moves that reduce salary
 * @param   {string}  [opts.difficulty]       Filter: "easy"|"medium"|"hard"|"very_hard"
 * @param   {boolean} [opts.directOnly=false] Only show direct career-path moves
 * @param   {boolean} [opts.crossDeptOnly=false] Only cross-department moves
 * @returns {object}
 *
 * @example
 * salary.findBestSalaryMoves('data-analyst');
 * salary.findBestSalaryMoves('software-engineer', { difficulty: 'easy', limit: 5 });
 * salary.findBestSalaryMoves('marketing-manager', { crossDeptOnly: true });
 */
function findBestSalaryMoves(role, opts = {}) {
  _guard();
  const {
    limit        = 10,
    positiveOnly = true,
    difficulty,
    directOnly   = false,
    crossDeptOnly= false,
  } = opts;

  const { role: roleNode, entry } = _resolvePair(role);

  if (!roleNode) {
    return { error: `Role not found: "${role}"` };
  }
  if (!entry) {
    return {
      role:    roleNode.slug,
      title:   roleNode.title,
      message: 'No salary progression data for this role.',
      moves:   [],
    };
  }

  let options = [...(entry.salary_progression || [])];

  if (positiveOnly)  options = options.filter((o) => o.salary_increase > 0);
  if (difficulty)    options = options.filter((o) => o.difficulty === difficulty);
  if (directOnly)    options = options.filter((o) => o.is_direct_path);
  if (crossDeptOnly) options = options.filter((o) => o.is_cross_department);

  // Already sorted by salary_increase desc in the dataset; re-sort to be safe
  options.sort((a, b) => b.salary_increase - a.salary_increase);

  const sliced = options.slice(0, limit);

  return {
    role:                   roleNode.slug,
    title:                  roleNode.title,
    category:               roleNode.category,
    seniority:              roleNode.seniority,
    current_salary_mean:    entry.current_salary_mean,
    salary_source:          entry.salary_source,
    total_options_found:    options.length,
    best_salary_move:       entry.best_salary_move,
    moves:                  sliced.map((o) => _formatOption(o)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Show the salary progression across a role's entire career ladder.
 * Walks the direct-path chain step by step, accumulating salary gains.
 *
 * Answers: "What is the salary progression across a career path?"
 *
 * @param   {string} role                   Slug or title
 * @param   {object} [opts]
 * @param   {number}  [opts.maxSteps=8]      Maximum hops to trace
 * @param   {boolean} [opts.includeSkills=true] Include missing_skills per step
 * @returns {object}
 *
 * @example
 * salary.findSalaryProgression('junior-data-analyst');
 * salary.findSalaryProgression('software-engineer', { maxSteps: 5 });
 */
function findSalaryProgression(role, opts = {}) {
  _guard();
  const { maxSteps = 8, includeSkills = true } = opts;

  const { role: startNode, entry: startEntry } = _resolvePair(role);

  if (!startNode) {
    return { error: `Role not found: "${role}"` };
  }

  const visited = new Set([startNode.slug]);
  const steps   = [];

  let currentSlug   = startNode.slug;
  let currentSalary = startEntry?.current_salary_mean ?? _resolveSalary(startNode);

  for (let i = 0; i < maxSteps; i++) {
    const entry = _intel[currentSlug];
    if (!entry) break;

    // Prefer direct, same-department, positive-salary moves for clean ladder
    const candidates = (entry.salary_progression || []).filter(
      (o) => !visited.has(o.target_role) && o.salary_increase > 0
    );
    if (candidates.length === 0) break;

    // First: direct same-dept; then direct cross-dept; then highest salary gain
    const direct    = candidates.filter((o) =>  o.is_direct_path && !o.is_cross_department);
    const anyDirect = candidates.filter((o) =>  o.is_direct_path);
    const chosen    = (direct.length    > 0 ? direct
                     : anyDirect.length > 0 ? anyDirect
                     : candidates)
                     .sort((a, b) => b.salary_increase - a.salary_increase)[0];

    const targetRole = _roleMap[chosen.target_role];
    visited.add(chosen.target_role);

    const step = {
      step:               steps.length + 1,
      role:               chosen.target_role,
      title:              chosen.target_title,
      category:           chosen.target_category,
      seniority:          targetRole?.seniority ?? null,
      salary_mean:        chosen.target_salary_mean,
      salary_increase:    chosen.salary_increase,
      salary_increase_pct:chosen.salary_increase_pct,
      cumulative_increase:0,                          // filled below
      difficulty:         chosen.difficulty,
      missing_skills_count: chosen.missing_skills_count,
      is_direct_path:     chosen.is_direct_path,
      is_cross_department:chosen.is_cross_department,
    };
    if (includeSkills) step.missing_skills = chosen.missing_skills;

    steps.push(step);
    currentSlug   = chosen.target_role;
    currentSalary = chosen.target_salary_mean;
  }

  // Compute cumulative salary increase at each step from start
  const baseSalary = startEntry?.current_salary_mean ?? _resolveSalary(startNode) ?? 0;
  for (const step of steps) {
    step.cumulative_increase = step.salary_mean - baseSalary;
    step.cumulative_increase_pct = baseSalary > 0
      ? Math.round(((step.salary_mean - baseSalary) / baseSalary) * 1000) / 10
      : null;
  }

  const finalSalary   = steps.length > 0 ? steps[steps.length - 1].salary_mean : baseSalary;
  const totalIncrease = finalSalary - baseSalary;

  return {
    role:                    startNode.slug,
    title:                   startNode.title,
    category:                startNode.category,
    seniority:               startNode.seniority,
    starting_salary:         baseSalary,
    final_salary:            finalSalary,
    total_salary_increase:   totalIncrease,
    total_increase_pct:      baseSalary > 0
      ? Math.round((totalIncrease / baseSalary) * 1000) / 10 : null,
    steps_traced:            steps.length,
    progression:             steps,
    note: steps.length === 0
      ? 'No upward salary progression found from this role in the dataset.'
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find all transitions across the entire 1,228-role dataset where the salary
 * increase meets or exceeds a given threshold.
 *
 * Answers: "What role changes increase salary the most?" (market-wide view)
 *
 * @param   {number} minIncrease             Minimum salary increase in GBP (e.g. 30000)
 * @param   {object} [opts]
 * @param   {number}  [opts.maxIncrease]      Upper bound
 * @param   {string}  [opts.difficulty]       Filter by difficulty
 * @param   {string}  [opts.category]         Filter by source-role category
 * @param   {string}  [opts.targetCategory]   Filter by target-role category
 * @param   {boolean} [opts.directOnly=false]
 * @param   {boolean} [opts.crossDeptOnly=false]
 * @param   {string}  [opts.sortBy='increase'] "increase"|"pct"|"efficiency"
 * @param   {number}  [opts.limit=25]
 * @returns {object}
 *
 * @example
 * salary.findHighGrowthTransitions(30000);
 * salary.findHighGrowthTransitions(50000, { difficulty: 'easy', limit: 10 });
 * salary.findHighGrowthTransitions(20000, { sortBy: 'efficiency', crossDeptOnly: true });
 */
function findHighGrowthTransitions(minIncrease, opts = {}) {
  _guard();
  const {
    maxIncrease,
    difficulty,
    category,
    targetCategory,
    directOnly    = false,
    crossDeptOnly = false,
    sortBy        = 'increase',
    limit         = 25,
  } = opts;

  // Pull from the pre-built leaderboard, then apply secondary filters
  // Also scan all roles for moves not in the leaderboard top-20
  const allMoves = [];
  const seen     = new Set();

  for (const [slug, entry] of Object.entries(_intel)) {
    const roleNode = _roleMap[slug];
    if (!roleNode) continue;

    for (const opt of (entry.salary_progression || [])) {
      const key = `${slug}→${opt.target_role}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (opt.salary_increase < minIncrease)             continue;
      if (maxIncrease && opt.salary_increase > maxIncrease) continue;
      if (difficulty     && opt.difficulty       !== difficulty)     continue;
      if (category       && roleNode.category    !== category)       continue;
      if (targetCategory && opt.target_category  !== targetCategory) continue;
      if (directOnly     && !opt.is_direct_path)                     continue;
      if (crossDeptOnly  && !opt.is_cross_department)                continue;

      allMoves.push({
        from_role:               slug,
        from_title:              entry.title,
        from_category:           entry.category,
        from_seniority:          entry.seniority,
        from_salary:             entry.current_salary_mean,
        target_role:             opt.target_role,
        target_title:            opt.target_title,
        target_category:         opt.target_category,
        target_salary:           opt.target_salary_mean,
        salary_increase:         opt.salary_increase,
        salary_increase_pct:     opt.salary_increase_pct,
        salary_efficiency_score: opt.salary_efficiency_score,
        difficulty:              opt.difficulty,
        missing_skills:          opt.missing_skills,
        missing_skills_count:    opt.missing_skills_count,
        skill_overlap_pct:       opt.skill_overlap_pct,
        is_direct_path:          opt.is_direct_path,
        is_cross_department:     opt.is_cross_department,
      });
    }
  }

  // Sort
  const sortFn = sortBy === 'pct'        ? (a, b) => b.salary_increase_pct     - a.salary_increase_pct
               : sortBy === 'efficiency' ? (a, b) => b.salary_efficiency_score - a.salary_efficiency_score
               :                          (a, b) => b.salary_increase          - a.salary_increase;

  allMoves.sort(sortFn);

  return {
    min_increase:  minIncrease,
    max_increase:  maxIncrease  || null,
    sort_by:       sortBy,
    total_found:   allMoves.length,
    transitions:   allMoves.slice(0, limit),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find moves from a role that deliver the best salary gain per skill learned.
 * High efficiency = maximum pay rise for minimum upskilling effort.
 *
 * Answers: "Which moves give better salary with lower skill gap?"
 *
 * @param   {string} role
 * @param   {object} [opts]
 * @param   {number}  [opts.limit=10]
 * @param   {number}  [opts.minIncrease=0]    Require a minimum salary gain
 * @param   {string}  [opts.maxDifficulty]    Ceiling on difficulty: "easy"|"medium"|"hard"
 * @param   {boolean} [opts.positiveOnly=true]
 * @returns {object}
 *
 * @example
 * salary.findBestSalaryEfficiencyMoves('data-analyst');
 * salary.findBestSalaryEfficiencyMoves('software-engineer', { maxDifficulty: 'medium' });
 * salary.findBestSalaryEfficiencyMoves('marketing-manager', { minIncrease: 10000 });
 */
function findBestSalaryEfficiencyMoves(role, opts = {}) {
  _guard();
  const {
    limit         = 10,
    minIncrease   = 0,
    maxDifficulty,
    positiveOnly  = true,
  } = opts;

  const { role: roleNode, entry } = _resolvePair(role);

  if (!roleNode) return { error: `Role not found: "${role}"` };
  if (!entry) {
    return {
      role:    roleNode.slug,
      title:   roleNode.title,
      message: 'No salary data for this role.',
      moves:   [],
    };
  }

  const DIFF_CEILING = maxDifficulty ? DIFF_RANK[maxDifficulty] : 99;

  let options = (entry.salary_progression || []).filter((o) => {
    if (positiveOnly && o.salary_increase <= 0)                      return false;
    if (o.salary_increase < minIncrease)                              return false;
    if (maxDifficulty && (DIFF_RANK[o.difficulty] ?? 99) > DIFF_CEILING) return false;
    return true;
  });

  // Sort by efficiency score desc; tie-break on salary_increase desc
  options = [...options]
    .sort((a, b) =>
      b.salary_efficiency_score - a.salary_efficiency_score ||
      b.salary_increase         - a.salary_increase
    )
    .slice(0, limit);

  return {
    role:                  roleNode.slug,
    title:                 roleNode.title,
    category:              roleNode.category,
    seniority:             roleNode.seniority,
    current_salary_mean:   entry.current_salary_mean,
    best_efficiency_move:  entry.best_efficiency_move,
    best_low_effort_move:  entry.best_low_effort_move,
    total_options_found:   options.length,
    moves: options.map((o) => _formatOption(o)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compare multiple target roles side-by-side from a single starting role.
 * Ranks each target by salary outcome and provides a full breakdown.
 *
 * Answers: "If I could move to any of these roles, which pays best?"
 *
 * @param   {string}   fromRole       Starting role — slug or title
 * @param   {string[]} targetRoles    Two or more target roles to compare
 * @param   {object}   [opts]
 * @param   {string}    [opts.rankBy='increase'] "increase"|"target_salary"|"efficiency"|"difficulty"
 * @returns {object}
 *
 * @example
 * salary.compareSalaryPaths('data-analyst', ['data-scientist', 'analytics-manager', 'data-engineer']);
 * salary.compareSalaryPaths('software-engineer', ['engineering-manager', 'cloud-architect', 'staff-engineer'], { rankBy: 'efficiency' });
 */
function compareSalaryPaths(fromRole, targetRoles, opts = {}) {
  _guard();
  const { rankBy = 'increase' } = opts;

  if (!Array.isArray(targetRoles) || targetRoles.length < 2) {
    return { error: 'Provide an array of at least 2 target roles to compare.' };
  }

  const { role: fromNode, entry: fromEntry } = _resolvePair(fromRole);
  if (!fromNode) return { error: `Starting role not found: "${fromRole}"` };

  const fromSalary = fromEntry?.current_salary_mean ?? _resolveSalary(fromNode);

  const results = [];

  for (const target of targetRoles) {
    const toNode = _resolveRole(target);
    if (!toNode) {
      results.push({ target_input: target, error: `Role not found: "${target}"` });
      continue;
    }

    const toSalary = _resolveSalary(toNode);
    if (toSalary === null || fromSalary === null) {
      results.push({
        target_role:  toNode.slug,
        target_title: toNode.title,
        error:        'Salary data unavailable for comparison.',
      });
      continue;
    }

    // Look up the pre-computed option in fromRole's progression
    const precomputed = (fromEntry?.salary_progression || []).find(
      (o) => o.target_role === toNode.slug
    );

    const salaryIncrease    = toSalary - fromSalary;
    const salaryIncreasePct = fromSalary > 0
      ? Math.round((salaryIncrease / fromSalary) * 1000) / 10 : null;

    // Efficiency: use precomputed if available; otherwise approximate
    const missingCount  = precomputed?.missing_skills_count ?? null;
    const efficiencyScore = precomputed?.salary_efficiency_score
      ?? (salaryIncrease > 0 && missingCount !== null
          ? Math.round(((salaryIncrease / (missingCount || 0.5)) / 1000) * 10) / 10
          : null);

    results.push({
      target_role:              toNode.slug,
      target_title:             toNode.title,
      target_category:          toNode.category,
      target_seniority:         toNode.seniority,
      from_salary:              fromSalary,
      target_salary_mean:       toSalary,
      salary_increase:          salaryIncrease,
      salary_increase_pct:      salaryIncreasePct,
      salary_efficiency_score:  efficiencyScore,
      difficulty:               precomputed?.difficulty        ?? null,
      missing_skills_count:     missingCount,
      missing_skills:           precomputed?.missing_skills    ?? null,
      skill_overlap_pct:        precomputed?.skill_overlap_pct ?? null,
      is_direct_path:           precomputed?.is_direct_path    ?? null,
      is_cross_department:      precomputed?.is_cross_department ?? null,
      in_progression_map:       !!precomputed,
    });
  }

  // Rank
  const rankFn =
    rankBy === 'target_salary' ? (a, b) => (b.target_salary_mean  || 0) - (a.target_salary_mean  || 0)
  : rankBy === 'efficiency'    ? (a, b) => (b.salary_efficiency_score || 0) - (a.salary_efficiency_score || 0)
  : rankBy === 'difficulty'    ? (a, b) => (DIFF_RANK[a.difficulty] ?? 99)  - (DIFF_RANK[b.difficulty] ?? 99)
  :                              (a, b) => (b.salary_increase || 0)  - (a.salary_increase || 0);

  const sorted = results
    .filter((r) => !r.error)
    .sort(rankFn);

  const errored = results.filter((r) => r.error);

  return {
    from_role:           fromNode.slug,
    from_title:          fromNode.title,
    from_category:       fromNode.category,
    from_salary:         fromSalary,
    ranked_by:           rankBy,
    total_compared:      sorted.length,
    ranked_paths:        sorted.map((r, i) => ({ rank: i + 1, ...r })),
    errors:              errored.length > 0 ? errored : undefined,
  };
}

// ── Extended functions ────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find all roles in a category with their salary data, sorted by salary.
 * Useful for understanding the salary landscape within a field.
 *
 * @param   {string} category               e.g. "Data & AI", "Cybersecurity"
 * @param   {object} [opts]
 * @param   {string}  [opts.seniority]       Filter by seniority
 * @param   {number}  [opts.minSalary]
 * @param   {number}  [opts.maxSalary]
 * @param   {string}  [opts.sortBy='salary'] "salary"|"title"
 * @returns {object}
 *
 * @example
 * salary.findSalaryByCategory('Data & AI');
 * salary.findSalaryByCategory('Cybersecurity', { seniority: 'Senior', minSalary: 80000 });
 */
function findSalaryByCategory(category, opts = {}) {
  _guard();
  const { seniority, minSalary, maxSalary, sortBy = 'salary' } = opts;

  let roles = Object.values(_roleMap)
    .filter((r) => r.category === category)
    .filter((r) => !seniority || r.seniority === seniority);

  const withSalary = roles.map((r) => {
    const sal  = _resolveSalary(r);
    const entry = _intel[r.slug];
    return {
      slug:        r.slug,
      title:       r.title,
      seniority:   r.seniority,
      salary_mean: sal,
      salary_min:  r.salary_uk?.min  ?? null,
      salary_max:  r.salary_uk?.max  ?? null,
      best_move:   entry?.best_salary_move        ?? null,
      best_efficiency: entry?.best_efficiency_move ?? null,
    };
  }).filter((r) => {
    if (r.salary_mean === null) return false;
    if (minSalary && r.salary_mean < minSalary) return false;
    if (maxSalary && r.salary_mean > maxSalary) return false;
    return true;
  });

  sortBy === 'title'
    ? withSalary.sort((a, b) => a.title.localeCompare(b.title))
    : withSalary.sort((a, b) => (b.salary_mean || 0) - (a.salary_mean || 0));

  const salaries = withSalary.map((r) => r.salary_mean).filter(Boolean);
  const avg = salaries.length > 0
    ? Math.round(salaries.reduce((s, v) => s + v, 0) / salaries.length) : null;

  return {
    category,
    role_count:     withSalary.length,
    salary_average: avg,
    salary_min:     salaries.length > 0 ? Math.min(...salaries) : null,
    salary_max:     salaries.length > 0 ? Math.max(...salaries) : null,
    roles:          withSalary,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find the highest-earning roles in the dataset, with optional filters.
 *
 * @param   {object} [opts]
 * @param   {number}  [opts.limit=20]
 * @param   {string}  [opts.category]
 * @param   {string}  [opts.seniority]
 * @param   {number}  [opts.minSalary]
 * @returns {object}
 *
 * @example
 * salary.findTopEarningRoles({ limit: 10 });
 * salary.findTopEarningRoles({ category: 'Data & AI', limit: 5 });
 */
function findTopEarningRoles(opts = {}) {
  _guard();
  const { limit = 20, category, seniority, minSalary } = opts;

  let roles = Object.values(_roleMap).map((r) => ({
    role:       r,
    salaryMean: _resolveSalary(r),
  })).filter(({ role: r, salaryMean }) => {
    if (salaryMean === null)                          return false;
    if (category   && r.category  !== category)      return false;
    if (seniority  && r.seniority !== seniority)     return false;
    if (minSalary  && salaryMean  <  minSalary)      return false;
    return true;
  });

  roles.sort((a, b) => b.salaryMean - a.salaryMean);

  return {
    total_found: roles.length,
    filters:     { category: category || null, seniority: seniority || null, minSalary: minSalary || null },
    roles: roles.slice(0, limit).map(({ role: r, salaryMean }) => ({
      slug:        r.slug,
      title:       r.title,
      category:    r.category,
      seniority:   r.seniority,
      industries:  r.industries,
      salary_mean: salaryMean,
      salary_min:  r.salary_uk?.min ?? null,
      salary_max:  r.salary_uk?.max ?? null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Get a salary benchmark for a role — where it sits relative to its category
 * and the overall market.
 *
 * @param   {string} role
 * @returns {object}
 *
 * @example
 * salary.getSalaryBenchmark('data-analyst');
 * salary.getSalaryBenchmark('senior-software-engineer');
 */
function getSalaryBenchmark(role) {
  _guard();

  const { role: roleNode, entry } = _resolvePair(role);
  if (!roleNode) return { error: `Role not found: "${role}"` };

  const roleSalary = entry?.current_salary_mean ?? _resolveSalary(roleNode);

  // Category-level stats
  const catRoles = Object.values(_roleMap)
    .filter((r) => r.category === roleNode.category)
    .map((r) => _resolveSalary(r))
    .filter(Boolean);

  const catAvg = catRoles.length > 0
    ? Math.round(catRoles.reduce((s, v) => s + v, 0) / catRoles.length) : null;
  const catMin = catRoles.length > 0 ? Math.min(...catRoles) : null;
  const catMax = catRoles.length > 0 ? Math.max(...catRoles) : null;
  const catPercentile = catRoles.length > 0
    ? Math.round((catRoles.filter((s) => s <= roleSalary).length / catRoles.length) * 100)
    : null;

  // Market-level stats
  const allSalaries = Object.values(_roleMap)
    .map((r) => _resolveSalary(r))
    .filter(Boolean);
  const marketAvg = allSalaries.length > 0
    ? Math.round(allSalaries.reduce((s, v) => s + v, 0) / allSalaries.length) : null;
  const marketPercentile = allSalaries.length > 0
    ? Math.round((allSalaries.filter((s) => s <= roleSalary).length / allSalaries.length) * 100)
    : null;

  return {
    role:             roleNode.slug,
    title:            roleNode.title,
    category:         roleNode.category,
    seniority:        roleNode.seniority,
    salary_mean:      roleSalary,
    salary_min:       roleNode.salary_uk?.min ?? null,
    salary_max:       roleNode.salary_uk?.max ?? null,
    salary_source:    entry?.salary_source ?? 'computed',

    category_benchmark: {
      category:        roleNode.category,
      category_avg:    catAvg,
      category_min:    catMin,
      category_max:    catMax,
      vs_category_avg: catAvg ? roleSalary - catAvg : null,
      percentile:      catPercentile,
    },

    market_benchmark: {
      market_avg:      marketAvg,
      vs_market_avg:   marketAvg ? roleSalary - marketAvg : null,
      percentile:      marketPercentile,
    },

    best_salary_move:    entry?.best_salary_move    ?? null,
    best_efficiency_move:entry?.best_efficiency_move ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find quick-win moves: positive salary increase with easy or medium difficulty.
 * The sweet spot for candidates who want better pay without a massive skill gap.
 *
 * @param   {string} role
 * @param   {object} [opts]
 * @param   {number}  [opts.limit=5]
 * @param   {number}  [opts.minIncrease=0]
 * @param   {string}  [opts.maxDifficulty='medium'] "easy"|"medium"
 * @returns {object}
 *
 * @example
 * salary.findQuickWins('data-analyst');
 * salary.findQuickWins('software-engineer', { minIncrease: 5000 });
 */
function findQuickWins(role, opts = {}) {
  _guard();
  const { limit = 5, minIncrease = 0, maxDifficulty = 'medium' } = opts;

  const { role: roleNode, entry } = _resolvePair(role);
  if (!roleNode) return { error: `Role not found: "${role}"` };
  if (!entry)    return { role: roleNode.slug, title: roleNode.title, quick_wins: [] };

  const DIFF_CEILING = DIFF_RANK[maxDifficulty] ?? 1;

  const wins = (entry.salary_progression || [])
    .filter((o) =>
      o.salary_increase > minIncrease &&
      (DIFF_RANK[o.difficulty] ?? 99) <= DIFF_CEILING
    )
    .sort((a, b) =>
      // Sort by composite: efficiency first, then absolute increase
      b.salary_efficiency_score - a.salary_efficiency_score ||
      b.salary_increase         - a.salary_increase
    )
    .slice(0, limit);

  return {
    role:                 roleNode.slug,
    title:                roleNode.title,
    current_salary_mean:  entry.current_salary_mean,
    max_difficulty:       maxDifficulty,
    quick_wins:           wins.map((o) => _formatOption(o)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Return one of the four pre-built global salary leaderboards.
 *
 * @param   {string} type   "top_increases"|"top_efficiency"|"easy_wins"|"cross_dept"
 * @param   {object} [opts]
 * @param   {number}  [opts.limit=20]
 * @param   {string}  [opts.category]          Filter by source-role category
 * @param   {string}  [opts.targetCategory]    Filter by target-role category
 * @returns {object}
 *
 * @example
 * salary.getLeaderboard('top_increases');
 * salary.getLeaderboard('easy_wins', { limit: 10 });
 * salary.getLeaderboard('top_efficiency', { category: 'Data & AI' });
 */
function getLeaderboard(type, opts = {}) {
  _guard();
  const { limit = 20, category, targetCategory } = opts;

  const KEY_MAP = {
    top_increases:  'top_salary_increases',
    top_efficiency: 'top_efficiency_moves',
    easy_wins:      'easy_and_medium_wins',
    cross_dept:     'cross_department_wins',
  };

  const key = KEY_MAP[type] || type;
  let board = _leaderboards[key];

  if (!board) {
    return {
      error:            `Unknown leaderboard type: "${type}"`,
      available_types:  Object.keys(KEY_MAP),
    };
  }

  if (category)       board = board.filter((m) => m.from_role && _roleMap[m.from_role]?.category === category);
  if (targetCategory) board = board.filter((m) => _roleMap[m.target_role]?.category === targetCategory);

  return {
    leaderboard:   type,
    total_entries: board.length,
    entries:       board.slice(0, limit),
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Return the full role node and salary intelligence entry for a slug or title */
function getRole(role) {
  _guard();
  const { role: roleNode, entry } = _resolvePair(role);
  if (!roleNode) return { error: `Role not found: "${role}"` };
  return {
    ...roleNode,
    salary_intelligence: entry ?? null,
  };
}

/** List all distinct categories present in roles-expanded */
function listCategories() {
  _guard();
  return [...new Set(Object.values(_roleMap).map((r) => r.category).filter(Boolean))].sort();
}

/** Return summary stats from both loaded datasets */
function graphStats() {
  _guard();
  const allSalaries = Object.values(_roleMap)
    .map((r) => _resolveSalary(r))
    .filter(Boolean);

  const avg   = Math.round(allSalaries.reduce((s, v) => s + v, 0) / allSalaries.length);
  const med   = [...allSalaries].sort((a, b) => a - b)[Math.floor(allSalaries.length / 2)];

  return {
    total_roles:          Object.keys(_roleMap).length,
    roles_with_salary:    allSalaries.length,
    total_salary_options: Object.values(_intel).reduce((s, e) => s + (e.salary_progression?.length || 0), 0),
    market_salary_mean:   avg,
    market_salary_median: med,
    market_salary_min:    Math.min(...allSalaries),
    market_salary_max:    Math.max(...allSalaries),
    leaderboards_available: Object.keys(_leaderboards),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Bootstrap
  load,

  // ── Core ─────────────────────────────────────────────────────────────────
  findBestSalaryMoves,          // Largest absolute salary increases from a role
  findSalaryProgression,        // Step-by-step salary ladder from a role
  findHighGrowthTransitions,    // Market-wide high-salary moves above a threshold
  findBestSalaryEfficiencyMoves,// Best £-per-skill-learned from a role
  compareSalaryPaths,           // Side-by-side salary comparison of target roles

  // ── Extended ─────────────────────────────────────────────────────────────
  findSalaryByCategory,         // Salary landscape within a department
  findTopEarningRoles,          // Highest-earning roles with filters
  getSalaryBenchmark,           // Where a role sits vs category and market
  findQuickWins,                // Easy/medium moves with positive salary gain
  getLeaderboard,               // Pre-built global salary leaderboards

  // ── Utilities ─────────────────────────────────────────────────────────────
  getRole,
  listCategories,
  graphStats,
};
