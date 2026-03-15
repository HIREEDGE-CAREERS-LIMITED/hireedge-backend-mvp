'use strict';

/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  HireEdge — Career Intelligence Engine
 *  v1.0.0
 *
 *  The central reasoning layer that powers the HireEdge AI Career Advisor.
 *  Aggregates signals from all seven datasets to answer high-level career
 *  questions in a single, structured response.
 *
 *  DATA SOURCES (all loaded on init)
 *  ──────────────────────────────────
 *  career-knowledge-graph.json       roles + skills + similarity + transitions
 *  career-salary-intelligence.json   salary moves + leaderboards
 *  career-skill-progression.json     step-by-step skill gaps + learning times
 *  roles-expanded.json               full role metadata, skills_grouped, ai_context
 *
 *  QUICK START
 *  ───────────
 *  const ci = require('./career-intelligence-engine');
 *  ci.load({ ... });   // see load() for paths
 *
 *  ci.analyzeCareer('data-analyst');
 *  ci.recommendNextRoles('data-analyst', ['salary', 'technical']);
 *  ci.analyzeSkillGap('data-analyst', 'machine-learning-engineer');
 *  ci.findBestCareerSwitch('data-analyst');
 *  ci.findHighGrowthPaths('data-analyst');
 *  ci.compareRoles('data-analyst', 'data-scientist');
 *
 *  FULL API
 *  ────────
 *  Core
 *    analyzeCareer(role)
 *    recommendNextRoles(role, goals)
 *    analyzeSkillGap(currentRole, targetRole)
 *    findBestCareerSwitch(role)
 *    findHighGrowthPaths(role)
 *    compareRoles(roleA, roleB)
 *
 *  Utilities
 *    getRole(role)
 *    listGoals()
 *    engineStats()
 * ══════════════════════════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');

// ── Internal state ────────────────────────────────────────────────────────────

let _kg   = null;   // knowledge graph roles:      { [slug]: kgNode }
let _sal  = null;   // salary intelligence roles:   { [slug]: salNode }
let _prog = null;   // skill progression roles:     { [slug]: progNode }
let _re   = null;   // roles-expanded:              { [slug]: reNode }
let _loaded = false;

// ── Constants ─────────────────────────────────────────────────────────────────

const SENIORITY_RANK = {
  Entry: 0, Junior: 1, Mid: 2, Senior: 3,
  Lead: 4, Manager: 4, Head: 5, Director: 6, 'C-Level': 7,
};

const LEADERSHIP_SENIORITY = new Set(['Manager', 'Head', 'Director', 'C-Level', 'Lead']);

const TECHNICAL_CATEGORIES = new Set([
  'Software Engineering', 'Data & AI', 'Cybersecurity',
  'Emerging Tech', 'Product & Project',
]);

const STABLE_INDUSTRIES = new Set([
  'healthcare', 'government', 'education', 'finance', 'banking',
  'public-sector', 'public sector', 'charity', 'insurance',
  'utilities', 'construction', 'legal', 'accounting', 'academia',
]);

const REMOTE_INDUSTRIES = new Set([
  'technology', 'saas', 'software', 'fintech', 'blockchain',
  'edtech', 'media', 'consulting', 'marketing', 'data',
  'startups', 'digital', 'cybersecurity', 'gaming',
]);

// Difficulty numeric weight (used in scoring/ranking)
const DIFF_WEIGHT = { easy: 1, medium: 2, hard: 3, very_hard: 4 };

// Supported goals and their display labels
const VALID_GOALS = {
  salary:     'Maximise salary growth',
  leadership: 'Move into leadership',
  technical:  'Deepen technical expertise',
  stability:  'Prioritise job stability',
  remote:     'Remote-friendly opportunities',
};

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load all data sources into memory. Must be called once before any query.
 *
 * @param   {object} paths
 * @param   {string} paths.knowledgeGraph   Path to career-knowledge-graph.json
 * @param   {string} paths.salary           Path to career-salary-intelligence.json
 * @param   {string} paths.progression      Path to career-skill-progression.json
 * @param   {string} paths.roles            Path to roles-expanded.json
 * @returns {object} Load summary
 *
 * @example
 * ci.load({
 *   knowledgeGraph: './career-knowledge-graph.json',
 *   salary:         './career-salary-intelligence.json',
 *   progression:    './career-skill-progression.json',
 *   roles:          './roles-expanded.json',
 * });
 */
function load(paths = {}) {
  const read = (p, label) => {
    if (!p) throw new Error(`[IntelligenceEngine] Missing path: ${label}`);
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`[IntelligenceEngine] Not found: ${abs}`);
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  };

  const kgData   = read(paths.knowledgeGraph, 'knowledgeGraph');
  const salData  = read(paths.salary,         'salary');
  const progData = read(paths.progression,    'progression');
  const reData   = read(paths.roles,          'roles');

  _kg   = kgData.roles   || {};
  _sal  = salData.roles  || {};
  _prog = progData.roles || {};
  _re   = {};
  for (const r of (reData.roles || [])) _re[r.slug] = r;

  _loaded = true;

  const summary = {
    roles_in_graph:       Object.keys(_kg).length,
    roles_with_salary:    Object.keys(_sal).length,
    roles_with_progress:  Object.keys(_prog).length,
    roles_in_expanded:    Object.keys(_re).length,
  };

  console.log(
    `[IntelligenceEngine] Ready — ` +
    `${summary.roles_in_graph} roles · ` +
    `${summary.roles_with_salary} salary entries · ` +
    `${summary.roles_in_expanded} expanded profiles`
  );

  return summary;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _guard() {
  if (!_loaded) throw new Error(
    '[IntelligenceEngine] Not loaded. Call ci.load({ knowledgeGraph, salary, progression, roles }) first.'
  );
}

const _norm    = (s) => (s || '').trim().toLowerCase();
const _slugify = (s) => _norm(s).replace(/\s+/g, '-');
const _round1  = (n) => Math.round(n * 10) / 10;

/** Resolve any role input to a canonical slug + merged node */
function _resolve(input) {
  if (!input) return null;

  // Try exact slug across all datasets
  for (const store of [_re, _kg, _sal]) {
    if (store[input]) return _buildNode(input);
  }
  // Slugified
  const s = _slugify(input);
  for (const store of [_re, _kg, _sal]) {
    if (store[s]) return _buildNode(s);
  }
  // Title match against roles-expanded
  const needle = _norm(input);
  const match  = Object.values(_re).find((r) => _norm(r.title) === needle);
  if (match) return _buildNode(match.slug);

  return null;
}

/**
 * Build a unified node for a slug by merging all four data sources.
 * This is the single source of truth for any role inside the engine.
 */
function _buildNode(slug) {
  const re  = _re[slug]  || {};
  const kg  = _kg[slug]  || {};
  const sal = _sal[slug] || {};

  // Salary: prefer stored mean, then (min+max)/2
  const salVal = sal.current_salary_mean
    ?? (re.salary_uk?.mean)
    ?? (re.salary_uk?.min && re.salary_uk?.max
        ? Math.round((re.salary_uk.min + re.salary_uk.max) / 2) : null);

  return {
    slug,
    title:          re.title          || kg.title          || sal.title          || slug,
    category:       re.category       || kg.category       || sal.category       || null,
    seniority:      re.seniority      || kg.seniority      || sal.seniority      || null,
    seniority_rank: SENIORITY_RANK[re.seniority || kg.seniority] ?? 2,
    industries:     re.industries     || kg.industries     || [],
    skills:         re.skills         || kg.skills         || [],
    skills_grouped: re.skills_grouped || null,
    salary_uk:      re.salary_uk      || kg.salary_uk      || null,
    salary_mean:    salVal,
    experience_years: re.experience_years || null,
    ai_context:     re.ai_context     || null,
    career_paths:   re.career_paths   || kg.career_paths   || {},
    similar_roles:  kg.similar_roles  || [],
    career_switches:kg.career_switches|| [],
    switch_summary: kg.switch_summary || null,
    // Salary intel
    _sal:  sal,
    // Skill progression
    _prog: _prog[slug] || null,
    // Rich transitions (original 428 only)
    _transitions: re.transitions || null,
  };
}

/** Resolve salary for any slug even if not in _sal */
function _salary(slug) {
  const sal = _sal[slug];
  if (sal?.current_salary_mean) return sal.current_salary_mean;
  const re = _re[slug];
  if (!re) return null;
  if (re.salary_uk?.mean) return re.salary_uk.mean;
  if (re.salary_uk?.min && re.salary_uk?.max)
    return Math.round((re.salary_uk.min + re.salary_uk.max) / 2);
  return null;
}

/** Format a salary as a band string: "£45k–£70k" */
function _salaryBand(node) {
  const sal = node.salary_uk;
  if (!sal) return null;
  const fmt = (v) => v >= 1000 ? `£${Math.round(v / 1000)}k` : `£${v}`;
  if (sal.min && sal.max) return `${fmt(sal.min)}–${fmt(sal.max)}`;
  if (node.salary_mean) return `~${fmt(node.salary_mean)}`;
  return null;
}

/**
 * Score a candidate next-role against a set of goals.
 * Returns a numeric score (higher = better fit for the goals).
 * Each active goal contributes up to 25 points; max total = 100.
 */
function _scoreAgainstGoals(candidateSlug, candidateOpt, goals, fromNode) {
  if (!goals || goals.length === 0) return 0;

  const target   = _buildNode(candidateSlug);
  const goalSet  = new Set(goals.map(_norm));
  const weight   = 100 / goals.length;
  let   score    = 0;

  if (goalSet.has('salary')) {
    // Score: salary_increase_pct capped at 100%, normalised to weight
    const pct = candidateOpt?.salary_increase_pct ?? 0;
    score += Math.min(pct / 100, 1) * weight;
  }

  if (goalSet.has('leadership')) {
    // Score: target is a leadership seniority AND is a step up
    const isLeadership = LEADERSHIP_SENIORITY.has(target.seniority);
    const isStepUp     = target.seniority_rank > fromNode.seniority_rank;
    score += (isLeadership ? 0.7 : 0) * weight + (isStepUp ? 0.3 : 0) * weight;
  }

  if (goalSet.has('technical')) {
    // Score: target is in a technical category + has high technical skill density
    const isTechCat = TECHNICAL_CATEGORIES.has(target.category);
    const techSkills = target.skills_grouped?.technical?.length ?? 0;
    const totalSkills = target.skills.length || 1;
    const techDensity = techSkills / totalSkills;
    score += (isTechCat ? 0.6 : 0.2) * weight + techDensity * 0.4 * weight;
  }

  if (goalSet.has('stability')) {
    const inds        = new Set(target.industries);
    const stableRatio = [...inds].filter((i) => STABLE_INDUSTRIES.has(i)).length / Math.max(inds.size, 1);
    // Fewer required skills = easier to get and retain the role
    const missingPenalty = Math.max(0, 1 - (candidateOpt?.missing_skills_count ?? 0) / 10);
    score += stableRatio * 0.6 * weight + missingPenalty * 0.4 * weight;
  }

  if (goalSet.has('remote')) {
    const inds        = new Set(target.industries);
    const remoteRatio = [...inds].filter((i) => REMOTE_INDUSTRIES.has(i)).length / Math.max(inds.size, 1);
    const isTechCat   = TECHNICAL_CATEGORIES.has(target.category);
    score += remoteRatio * 0.7 * weight + (isTechCat ? 0.3 : 0) * weight;
  }

  return _round1(score);
}

// ── Core functions ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Comprehensive career profile for a role.
 * Returns role summary, salary band, seniority, top similar roles,
 * future roles, market context, and quick-access best moves.
 *
 * @param   {string} role  Slug or title
 * @returns {object}
 *
 * @example
 * ci.analyzeCareer('data-analyst');
 * ci.analyzeCareer('Senior Software Engineer');
 */
function analyzeCareer(role) {
  _guard();

  const node = _resolve(role);
  if (!node) return { error: `Role not found: "${role}"` };

  const sal      = node._sal;
  const prog     = node._prog;
  const trans    = node._transitions;

  // ── Salary context ──
  const salaryBand = _salaryBand(node);
  const salaryMean = node.salary_mean;

  // ── Similar roles (top 5 by overlap) ──
  const similarRoles = node.similar_roles
    .slice(0, 5)
    .map((s) => {
      const t = _re[s.slug] || _kg[s.slug] || {};
      return {
        slug:               s.slug,
        title:              t.title || s.slug,
        category:           t.category || null,
        skill_overlap_score: s.skill_overlap_score,
      };
    });

  // ── Future roles ──
  const nextSlugs  = node.career_paths.next_roles || [];
  const futureRoles = nextSlugs.slice(0, 5).map((slug) => {
    const t       = _buildNode(slug);
    const tSalary = _salary(slug);
    const salInc  = (tSalary && salaryMean) ? tSalary - salaryMean : null;
    // Get learning time from progression if available
    const progOpt = prog?.next_roles?.find((nr) => nr.role === slug);
    return {
      slug,
      title:                  t.title,
      category:               t.category,
      seniority:              t.seniority,
      salary_mean:            tSalary,
      salary_increase:        salInc,
      estimated_months:       progOpt?.estimated_learning_time_months ?? null,
      skills_to_learn:        progOpt?.skills_to_learn ?? [],
      skills_to_learn_count:  progOpt?.skills_to_learn_count ?? null,
    };
  });

  // ── Switch summary ──
  const switchSummary = node.switch_summary;

  // ── Best moves (from salary intelligence) ──
  const bestSalaryMove    = sal?.best_salary_move     ?? null;
  const bestEfficiencyMove= sal?.best_efficiency_move ?? null;
  const bestLowEffortMove = sal?.best_low_effort_move ?? null;

  // ── AI context / narrative ──
  const context = node.ai_context?.summary ?? null;

  // ── Skills summary ──
  const skillsGrouped = node.skills_grouped;
  const topSkills = skillsGrouped
    ? [
        ...(skillsGrouped.core     || []).slice(0, 3),
        ...(skillsGrouped.technical|| []).slice(0, 4),
        ...(skillsGrouped.soft     || []).slice(0, 2),
      ]
    : node.skills.slice(0, 8);

  return {
    role:             node.slug,
    title:            node.title,
    category:         node.category,
    seniority:        node.seniority,
    experience_years: node.experience_years,
    industries:       node.industries,

    salary: {
      mean:     salaryMean,
      band:     salaryBand,
      currency: 'GBP',
      source:   sal?.salary_source ?? 'computed',
    },

    skills: {
      total_count:  node.skills.length,
      top_skills:   topSkills,
      grouped:      skillsGrouped,
    },

    similar_roles:    similarRoles,
    future_roles:     futureRoles,

    transition_summary: switchSummary
      ? {
          total_paths:      switchSummary.total,
          easy_moves:       switchSummary.easy,
          medium_moves:     switchSummary.medium,
          hard_moves:       switchSummary.hard,
          cross_dept_moves: switchSummary.cross_dept,
        }
      : null,

    best_moves: {
      highest_salary:  bestSalaryMove,
      best_efficiency: bestEfficiencyMove,
      lowest_effort:   bestLowEffortMove,
    },

    context,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Recommend up to 5 next roles tailored to the user's stated goals.
 * Each goal contributes to a composite score; roles are ranked highest first.
 *
 * Supported goals: "salary" | "leadership" | "technical" | "stability" | "remote"
 *
 * @param   {string}   role    Slug or title
 * @param   {string[]} goals   One or more goal strings (case-insensitive)
 * @param   {object}   [opts]
 * @param   {number}    [opts.limit=5]
 * @returns {object}
 *
 * @example
 * ci.recommendNextRoles('data-analyst', ['salary', 'technical']);
 * ci.recommendNextRoles('software-engineer', ['leadership']);
 * ci.recommendNextRoles('marketing-manager', ['salary', 'remote', 'stability']);
 */
function recommendNextRoles(role, goals = [], opts = {}) {
  _guard();
  const { limit = 5 } = opts;

  const node = _resolve(role);
  if (!node) return { error: `Role not found: "${role}"` };

  // Validate + normalise goals
  const recognisedGoals = goals
    .map(_norm)
    .filter((g) => VALID_GOALS[g]);

  if (recognisedGoals.length === 0) {
    return {
      error:          'No valid goals provided.',
      valid_goals:    Object.keys(VALID_GOALS),
      goal_descriptions: VALID_GOALS,
    };
  }

  // Build candidate pool: direct next_roles + career_switches
  const candidateMap = new Map();

  // From career_paths (career ladder)
  for (const slug of (node.career_paths.next_roles || [])) {
    if (!candidateMap.has(slug)) {
      const opt = node._sal?.salary_progression?.find((o) => o.target_role === slug) ?? null;
      candidateMap.set(slug, { opt, source: 'career_path' });
    }
  }

  // From career_switches (broader market)
  for (const sw of (node.career_switches || [])) {
    if (!candidateMap.has(sw.target_role)) {
      const opt = node._sal?.salary_progression?.find((o) => o.target_role === sw.target_role) ?? {
        salary_increase_pct:    null,
        missing_skills_count:   sw.missing_skill_count,
        missing_skills:         sw.missing_skills,
        difficulty:             sw.difficulty,
        is_direct_path:         sw.is_direct_path,
        is_cross_department:    sw.is_cross_department,
      };
      candidateMap.set(sw.target_role, { opt, source: 'career_switch', sw });
    }
  }

  // Score each candidate
  const scored = [];
  for (const [slug, { opt, source, sw }] of candidateMap) {
    const targetNode = _resolve(slug);
    if (!targetNode) continue;

    const goalScore = _scoreAgainstGoals(slug, opt, recognisedGoals, node);

    // Feasibility penalty: harder moves score lower
    const diffPenalty = DIFF_WEIGHT[opt?.difficulty] ?? 2;
    const feasibility = Math.max(0, 1 - (diffPenalty - 1) / 6); // 0→1 scale

    const finalScore  = _round1(goalScore * 0.8 + feasibility * 20);

    const tSalary    = _salary(slug);
    const salInc     = tSalary && node.salary_mean ? tSalary - node.salary_mean : null;
    const progEntry  = node._prog?.next_roles?.find((nr) => nr.role === slug);

    scored.push({
      slug,
      title:                  targetNode.title,
      category:               targetNode.category,
      seniority:              targetNode.seniority,
      salary_mean:            tSalary,
      salary_increase:        salInc,
      salary_increase_pct:    opt?.salary_increase_pct ?? (salInc && node.salary_mean
        ? _round1((salInc / node.salary_mean) * 100) : null),
      difficulty:             opt?.difficulty ?? sw?.difficulty ?? null,
      missing_skills:         opt?.missing_skills ?? sw?.missing_skills ?? [],
      missing_skills_count:   opt?.missing_skills_count ?? sw?.missing_skill_count ?? null,
      estimated_months:       progEntry?.estimated_learning_time_months ?? null,
      is_direct_path:         opt?.is_direct_path ?? sw?.is_direct_path ?? false,
      is_cross_department:    opt?.is_cross_department ?? sw?.is_cross_department ?? false,
      goal_score:             goalScore,
      final_score:            finalScore,
      goal_fit:               recognisedGoals.filter((g) => {
        if (g === 'salary')     return (salInc ?? 0) > 0;
        if (g === 'leadership') return LEADERSHIP_SENIORITY.has(targetNode.seniority);
        if (g === 'technical')  return TECHNICAL_CATEGORIES.has(targetNode.category);
        if (g === 'stability')  return targetNode.industries.some((i) => STABLE_INDUSTRIES.has(i));
        if (g === 'remote')     return targetNode.industries.some((i) => REMOTE_INDUSTRIES.has(i));
        return false;
      }),
    });
  }

  scored.sort((a, b) => b.final_score - a.final_score || (b.salary_increase ?? 0) - (a.salary_increase ?? 0));

  return {
    role:            node.slug,
    title:           node.title,
    category:        node.category,
    current_salary:  node.salary_mean,
    goals:           recognisedGoals,
    total_candidates:scored.length,
    recommendations: scored.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Deep skill gap analysis between two roles.
 * Returns missing skills, a learning path, and estimated total months.
 *
 * @param   {string} currentRole
 * @param   {string} targetRole
 * @returns {object}
 *
 * @example
 * ci.analyzeSkillGap('data-analyst', 'machine-learning-engineer');
 * ci.analyzeSkillGap('marketing manager', 'product manager');
 */
function analyzeSkillGap(currentRole, targetRole) {
  _guard();

  const from = _resolve(currentRole);
  const to   = _resolve(targetRole);

  if (!from) return { error: `Role not found: "${currentRole}"` };
  if (!to)   return { error: `Role not found: "${targetRole}"` };
  if (from.slug === to.slug) {
    return {
      from_role:             from.slug,
      to_role:               to.slug,
      message:               'Same role — no gap to bridge.',
      missing_skills:        [],
      estimated_total_months: 0,
    };
  }

  // ── 1. Pre-computed gap from progression map ──
  const progEntry = from._prog?.next_roles?.find((nr) => nr.role === to.slug);

  // ── 2. Live skill set comparison ──
  const fromSkills = new Set((from.skills || []).map(_norm));
  const toSkills   = new Set((to.skills   || []).map(_norm));
  const missing      = [...toSkills].filter((s) => !fromSkills.has(s)).sort();
  const transferable = [...fromSkills].filter((s) => toSkills.has(s)).sort();
  const unionSize    = new Set([...fromSkills, ...toSkills]).size;
  const overlapPct   = unionSize > 0
    ? Math.round((transferable.length / unionSize) * 100) : 0;

  // ── 3. Skill-by-skill learning time (from salary intel difficulty proxy) ──
  const diffLabel = missing.length <= 2 ? 'easy'
    : missing.length <= 4              ? 'medium'
    : missing.length <= 6              ? 'hard'
    :                                    'very_hard';

  // Months: use pre-computed if available; else estimate from skill count
  const estimatedMonths = progEntry?.estimated_learning_time_months
    ?? (missing.length === 0 ? 0
      : missing.length <= 2  ? 3
      : missing.length <= 4  ? 6
      : missing.length <= 6  ? 9
      : missing.length <= 9  ? 12
      : 18);

  // ── 4. Learning path — ordered skill acquisition steps ──
  // Prioritise skills that appear in more roles (foundational first)
  const learningPath = missing.map((skill) => ({
    skill,
    priority: missing.indexOf(skill) + 1,
  }));

  // ── 5. Salary context ──
  const fromSalary = from.salary_mean ?? _salary(from.slug);
  const toSalary   = _salary(to.slug);
  const salaryDelta = (fromSalary && toSalary) ? toSalary - fromSalary : null;

  return {
    from_role:             from.slug,
    from_title:            from.title,
    from_category:         from.category,
    from_seniority:        from.seniority,
    to_role:               to.slug,
    to_title:              to.title,
    to_category:           to.category,
    to_seniority:          to.seniority,
    is_cross_department:   from.category !== to.category,
    difficulty:            diffLabel,

    missing_skills:        missing,
    missing_skills_count:  missing.length,
    transferable_skills:   transferable,
    transferable_count:    transferable.length,
    skill_overlap_pct:     overlapPct,

    learning_path:         learningPath,
    estimated_total_months:estimatedMonths,

    salary_impact: {
      from_salary:     fromSalary  ?? null,
      to_salary:       toSalary    ?? null,
      salary_increase: salaryDelta ?? null,
      salary_increase_pct: (salaryDelta && fromSalary)
        ? _round1((salaryDelta / fromSalary) * 100) : null,
    },

    source: progEntry ? 'progression_map' : 'live_computed',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find the best cross-department career switches from a role.
 * Surfaces moves to different fields, ranked by salary uplift and ease.
 *
 * @param   {string} role
 * @param   {object} [opts]
 * @param   {number}  [opts.limit=5]
 * @param   {string}  [opts.sortBy='salary'] "salary"|"efficiency"|"ease"
 * @returns {object}
 *
 * @example
 * ci.findBestCareerSwitch('data-analyst');
 * ci.findBestCareerSwitch('software-engineer', { sortBy: 'ease' });
 */
function findBestCareerSwitch(role, opts = {}) {
  _guard();
  const { limit = 5, sortBy = 'salary' } = opts;

  const node = _resolve(role);
  if (!node) return { error: `Role not found: "${role}"` };

  // Cross-dept moves: from career_switches + salary intel cross_department_moves
  const crossSwitches = (node.career_switches || [])
    .filter((sw) => sw.is_cross_department);

  if (crossSwitches.length === 0) {
    return {
      role:    node.slug,
      title:   node.title,
      message: 'No cross-department moves found for this role.',
      switches: [],
    };
  }

  const enriched = crossSwitches.map((sw) => {
    const targetNode  = _buildNode(sw.target_role);
    const tSalary     = _salary(sw.target_role);
    const salInc      = (tSalary && node.salary_mean) ? tSalary - node.salary_mean : null;
    const salIncPct   = (salInc && node.salary_mean)
      ? _round1((salInc / node.salary_mean) * 100) : null;

    // Efficiency = salary per skill to learn
    const effScore = salInc > 0 && sw.missing_skill_count > 0
      ? _round1((salInc / sw.missing_skill_count) / 1000)
      : salInc > 0 ? _round1(salInc / 500) : 0;

    return {
      target_role:             sw.target_role,
      target_title:            sw.target_title,
      target_category:         sw.target_category,
      target_seniority:        targetNode.seniority,
      target_salary_mean:      tSalary,
      salary_increase:         salInc,
      salary_increase_pct:     salIncPct,
      difficulty:              sw.difficulty,
      missing_skills:          sw.missing_skills,
      missing_skills_count:    sw.missing_skill_count,
      skill_overlap_pct:       sw.skill_overlap_pct,
      salary_efficiency_score: effScore,
      target_industries:       targetNode.industries,
    };
  });

  const sortFn =
    sortBy === 'ease'       ? (a, b) => (DIFF_WEIGHT[a.difficulty] ?? 4) - (DIFF_WEIGHT[b.difficulty] ?? 4) || (b.salary_increase ?? 0) - (a.salary_increase ?? 0)
  : sortBy === 'efficiency' ? (a, b) => b.salary_efficiency_score - a.salary_efficiency_score
  :                           (a, b) => (b.salary_increase ?? 0) - (a.salary_increase ?? 0);

  enriched.sort(sortFn);

  return {
    role:              node.slug,
    title:             node.title,
    category:          node.category,
    current_salary:    node.salary_mean,
    total_cross_dept:  enriched.length,
    sorted_by:         sortBy,
    switches:          enriched.slice(0, limit),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find career paths ranked by salary growth potential.
 * Traces multiple branches from a role and scores each by cumulative uplift.
 *
 * @param   {string} role
 * @param   {object} [opts]
 * @param   {number}  [opts.maxDepth=4]   Hops to trace per path
 * @param   {number}  [opts.limit=5]      Paths to return
 * @returns {object}
 *
 * @example
 * ci.findHighGrowthPaths('junior-data-analyst');
 * ci.findHighGrowthPaths('software-engineer', { maxDepth: 5 });
 */
function findHighGrowthPaths(role, opts = {}) {
  _guard();
  const { maxDepth = 4, limit = 5 } = opts;

  const startNode = _resolve(role);
  if (!startNode) return { error: `Role not found: "${role}"` };

  const baseSalary = startNode.salary_mean;

  /**
   * DFS: from a slug, build all paths up to maxDepth hops.
   * Each path is an array of slugs starting from the role after `from`.
   */
  function buildPaths(fromSlug, visited, depth) {
    if (depth === 0) return [[]];

    const node    = _buildNode(fromSlug);
    // Use salary-sorted progression options for path building
    const salNode = _sal[fromSlug];
    const options = (salNode?.salary_progression || [])
      .filter((o) => o.salary_increase > 0 && !visited.has(o.target_role))
      .sort((a, b) => b.salary_increase - a.salary_increase)
      .slice(0, 3); // max 3 branches per node (prevents explosion)

    if (options.length === 0) return [[]];

    const allPaths = [];
    for (const opt of options) {
      const newVisited = new Set([...visited, opt.target_role]);
      const subPaths   = buildPaths(opt.target_role, newVisited, depth - 1);
      for (const sub of subPaths) {
        allPaths.push([opt.target_role, ...sub.filter(Boolean)]);
      }
    }

    return allPaths.length > 0 ? allPaths : [[]];
  }

  const rawPaths = buildPaths(startNode.slug, new Set([startNode.slug]), maxDepth);

  // Score and enrich each path
  const scored = rawPaths
    .filter((p) => p.length > 0)
    .map((slugPath) => {
      const steps       = [];
      let   prevSalary  = baseSalary;
      let   totalInc    = 0;
      let   cumulativeMonths = 0;

      for (const slug of slugPath) {
        const tNode    = _buildNode(slug);
        const tSalary  = _salary(slug);
        const inc      = tSalary && prevSalary ? tSalary - prevSalary : 0;
        const progOpt  = _prog[slugPath[0] === slug
          ? startNode.slug : slugPath[slugPath.indexOf(slug) - 1]]
          ?.next_roles?.find((nr) => nr.role === slug);

        cumulativeMonths += progOpt?.estimated_learning_time_months ?? 6;
        totalInc          = (tSalary ?? 0) - (baseSalary ?? 0);

        steps.push({
          role:             slug,
          title:            tNode.title,
          category:         tNode.category,
          seniority:        tNode.seniority,
          salary_mean:      tSalary,
          salary_step_increase: inc > 0 ? inc : null,
          cumulative_increase:  totalInc > 0 ? totalInc : null,
          estimated_months_to_reach: cumulativeMonths,
        });

        prevSalary = tSalary ?? prevSalary;
      }

      const finalSalary  = _salary(slugPath[slugPath.length - 1]) ?? baseSalary ?? 0;
      const totalGrowthPct = baseSalary > 0
        ? _round1(((finalSalary - baseSalary) / baseSalary) * 100) : null;

      return {
        path_id:            steps.map((s) => s.role).join(' → '),
        steps,
        total_steps:        steps.length,
        starting_salary:    baseSalary,
        final_salary:       finalSalary,
        total_increase:     finalSalary - (baseSalary ?? 0),
        total_growth_pct:   totalGrowthPct,
        estimated_total_months: cumulativeMonths,
        _score:             (totalGrowthPct ?? 0) * 0.7 + (steps.length * 5),
      };
    });

  // Deduplicate by path_id and sort by growth
  const seen    = new Set();
  const unique  = scored.filter((p) => {
    if (seen.has(p.path_id)) return false;
    seen.add(p.path_id);
    return true;
  });

  unique.sort((a, b) => b._score - a._score || b.total_increase - a.total_increase);

  return {
    role:            startNode.slug,
    title:           startNode.title,
    starting_salary: baseSalary,
    paths_found:     unique.length,
    top_paths:       unique.slice(0, limit).map(({ _score, ...p }) => p),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Side-by-side comparison of two roles across salary, skills, and growth.
 *
 * @param   {string} roleA
 * @param   {string} roleB
 * @returns {object}
 *
 * @example
 * ci.compareRoles('data-analyst', 'data-scientist');
 * ci.compareRoles('software engineer', 'product manager');
 */
function compareRoles(roleA, roleB) {
  _guard();

  const a = _resolve(roleA);
  const b = _resolve(roleB);

  if (!a) return { error: `Role not found: "${roleA}"` };
  if (!b) return { error: `Role not found: "${roleB}"` };

  // ── Salary comparison ──
  const aSal = a.salary_mean;
  const bSal = b.salary_mean;
  const salDiff    = (aSal && bSal) ? bSal - aSal : null;
  const salDiffPct = (salDiff && aSal) ? _round1((salDiff / aSal) * 100) : null;

  // ── Skill overlap ──
  const aSkills  = new Set((a.skills || []).map(_norm));
  const bSkills  = new Set((b.skills || []).map(_norm));
  const shared   = [...aSkills].filter((s) => bSkills.has(s));
  const onlyA    = [...aSkills].filter((s) => !bSkills.has(s));
  const onlyB    = [...bSkills].filter((s) => !aSkills.has(s));
  const union    = new Set([...aSkills, ...bSkills]);
  const overlapPct = union.size > 0
    ? Math.round((shared.length / union.size) * 100) : 0;

  // ── Growth potential ──
  const aMaxGrowth = a._sal?.salary_progression
    ? Math.max(...a._sal.salary_progression.filter((o) => o.salary_increase > 0).map((o) => o.salary_increase_pct), 0)
    : null;
  const bMaxGrowth = b._sal?.salary_progression
    ? Math.max(...b._sal.salary_progression.filter((o) => o.salary_increase > 0).map((o) => o.salary_increase_pct), 0)
    : null;

  // ── Mobility (how many paths exist) ──
  const aMobility = a.switch_summary?.total ?? (a.career_switches?.length ?? 0);
  const bMobility = b.switch_summary?.total ?? (b.career_switches?.length ?? 0);

  // ── Remote/stability profile ──
  const scoreProfile = (node) => {
    const inds = new Set(node.industries);
    return {
      remote_score:  _round1([...inds].filter((i) => REMOTE_INDUSTRIES.has(i)).length / Math.max(inds.size, 1) * 100),
      stable_score:  _round1([...inds].filter((i) => STABLE_INDUSTRIES.has(i)).length / Math.max(inds.size, 1) * 100),
      is_technical:  TECHNICAL_CATEGORIES.has(node.category),
      is_leadership: LEADERSHIP_SENIORITY.has(node.seniority),
    };
  };

  // ── Transition between them ──
  const aToB = a.career_switches?.find((sw) => sw.target_role === b.slug) ?? null;
  const bToA = b.career_switches?.find((sw) => sw.target_role === a.slug) ?? null;

  // ── Verdict ──
  const winner = {
    salary:   aSal && bSal ? (aSal > bSal ? a.slug : aSal < bSal ? b.slug : 'tie') : null,
    growth:   aMaxGrowth != null && bMaxGrowth != null
      ? (aMaxGrowth > bMaxGrowth ? a.slug : aMaxGrowth < bMaxGrowth ? b.slug : 'tie') : null,
    mobility: aMobility !== bMobility ? (aMobility > bMobility ? a.slug : b.slug) : 'tie',
  };

  return {
    role_a: {
      slug:               a.slug,
      title:              a.title,
      category:           a.category,
      seniority:          a.seniority,
      salary_mean:        aSal,
      salary_band:        _salaryBand(a),
      skill_count:        a.skills.length,
      unique_skills:      onlyA,
      total_paths:        aMobility,
      max_salary_growth_pct: aMaxGrowth,
      profile:            scoreProfile(a),
    },
    role_b: {
      slug:               b.slug,
      title:              b.title,
      category:           b.category,
      seniority:          b.seniority,
      salary_mean:        bSal,
      salary_band:        _salaryBand(b),
      skill_count:        b.skills.length,
      unique_skills:      onlyB,
      total_paths:        bMobility,
      max_salary_growth_pct: bMaxGrowth,
      profile:            scoreProfile(b),
    },
    comparison: {
      salary_difference:     salDiff,
      salary_difference_pct: salDiffPct,
      salary_higher:         winner.salary,
      shared_skills:         shared,
      shared_skill_count:    shared.length,
      skill_overlap_pct:     overlapPct,
      higher_growth:         winner.growth,
      higher_mobility:       winner.mobility,
    },
    transitions: {
      a_to_b: aToB ? {
        difficulty:           aToB.difficulty,
        missing_skills:       aToB.missing_skills,
        missing_skills_count: aToB.missing_skill_count,
        skill_overlap_pct:    aToB.skill_overlap_pct,
      } : null,
      b_to_a: bToA ? {
        difficulty:           bToA.difficulty,
        missing_skills:       bToA.missing_skills,
        missing_skills_count: bToA.missing_skill_count,
        skill_overlap_pct:    bToA.skill_overlap_pct,
      } : null,
    },
    verdict: winner,
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Return the fully merged node for a slug or title */
function getRole(role) {
  _guard();
  const node = _resolve(role);
  return node ?? { error: `Role not found: "${role}"` };
}

/** Return all valid goal keys and their descriptions */
function listGoals() {
  return { ...VALID_GOALS };
}

/** Return aggregate stats across all loaded datasets */
function engineStats() {
  _guard();
  const allSalaries = Object.values(_re)
    .map((r) => r.salary_uk?.mean ?? (r.salary_uk?.min && r.salary_uk?.max
      ? Math.round((r.salary_uk.min + r.salary_uk.max) / 2) : null))
    .filter(Boolean);

  const avg = Math.round(allSalaries.reduce((s, v) => s + v, 0) / allSalaries.length);
  const sorted = [...allSalaries].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    total_roles:          Object.keys(_re).length,
    roles_with_salary:    allSalaries.length,
    roles_with_progression: Object.keys(_prog).length,
    market_salary_mean:   avg,
    market_salary_median: median,
    market_salary_min:    Math.min(...allSalaries),
    market_salary_max:    Math.max(...allSalaries),
    valid_goals:          Object.keys(VALID_GOALS),
    datasets_loaded:      ['career-knowledge-graph', 'career-salary-intelligence', 'career-skill-progression', 'roles-expanded'],
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Bootstrap
  load,

  // ── Core ─────────────────────────────────────────────────────────────────
  analyzeCareer,            // Full career profile: salary, skills, future roles, best moves
  recommendNextRoles,       // Goal-weighted top 5 recommendations
  analyzeSkillGap,          // Missing skills + learning path between two roles
  findBestCareerSwitch,     // Best cross-department pivots ranked by salary / ease
  findHighGrowthPaths,      // Career paths ranked by total salary growth
  compareRoles,             // Head-to-head: salary, skills, growth, transitions

  // ── Utilities ─────────────────────────────────────────────────────────────
  getRole,
  listGoals,
  engineStats,
};
