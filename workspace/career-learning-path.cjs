'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 *  HireEdge — Career Learning Path Engine
 *  v1.0.0
 *
 *  Answers three questions:
 *    1. What skills do I need to move from Role A → Role B?
 *    2. What is the full step-by-step learning journey from my role?
 *    3. How long will it take me to learn a list of skills?
 *
 *  Data sources loaded on init:
 *    • career-skill-progression.json  — pre-computed skill gaps + learning times
 *    • skills-index.json              — canonical skill list + rarity (role_count)
 *    • roles-expanded.json            — full role metadata + career_paths
 *
 *  QUICK START
 *  ───────────
 *  const lp = require('./career-learning-path');
 *  lp.load({
 *    progression: './career-skill-progression.json',
 *    skills:      './skills-index.json',
 *    roles:       './roles-expanded.json',
 *  });
 *
 *  lp.findSkillsToMove('data-analyst', 'machine-learning-engineer');
 *  lp.getLearningPath('junior-data-analyst');
 *  lp.estimateLearningTime(['python', 'machine learning', 'pytorch']);
 *
 * ═══════════════════════════════════════════════════════════════
 */

const fs   = require('fs');
const path = require('path');

// ── Internal state ────────────────────────────────────────────────────────────

let _prog      = null;   // career-skill-progression roles map:  { [slug]: entry }
let _skillsIdx = null;   // skills-index map:                    { [skill]: entry }
let _roleMap   = null;   // roles-expanded map:                  { [slug]: role }
let _loaded    = false;

// ── Skill learning-time model ─────────────────────────────────────────────────
//
// Weeks per skill, derived from the skill's rarity in the dataset.
// A skill used by many roles has abundant learning resources and clear
// documentation → quicker to acquire in a professional context.
// A skill used by only 1–2 roles is highly specialist → longer to master.
//
//   role_count 51+  : 2 weeks  (foundational: Python, SQL, stakeholder mgmt)
//   role_count 21-50: 3 weeks  (common: Tableau, Kubernetes, GDPR)
//   role_count  6-20: 5 weeks  (niche: PyTorch, Terraform, FHIR)
//   role_count  2-5 : 7 weeks  (specialist: CRISPR, FTK Imager, CDISC)
//   role_count   1  : 10 weeks (unique: highly domain-specific tools)
//   unknown          : 4 weeks  (skill not in index — conservative default)
//
const WEEKS_BY_RARITY = (roleCount) => {
  if (roleCount === undefined || roleCount === null) return 4;
  if (roleCount >= 51)  return 2;
  if (roleCount >= 21)  return 3;
  if (roleCount >= 6)   return 5;
  if (roleCount >= 2)   return 7;
  return 10;
};

// Skills can overlap in learning (e.g. learning PyTorch also covers
// some Deep Learning). Apply a concurrency discount beyond the 3rd skill.
const CONCURRENCY_FACTOR = 0.85; // each skill beyond 3rd takes 85% of full time

// Round to nearest clean milestone in months
const MONTH_MILESTONES = [1, 2, 3, 4, 6, 9, 12, 18, 24, 30, 36];
const snapToMilestone = (months) =>
  MONTH_MILESTONES.reduce((prev, curr) =>
    Math.abs(curr - months) < Math.abs(prev - months) ? curr : prev
  );

// ── Loader ────────────────────────────────────────────────────────────────────

/**
 * Load all three data sources into memory.
 * Must be called before any query function.
 *
 * @param {object} paths
 * @param {string} paths.progression  Path to career-skill-progression.json
 * @param {string} paths.skills       Path to skills-index.json
 * @param {string} paths.roles        Path to roles-expanded.json
 * @returns {object} Summary of loaded data
 *
 * @example
 * lp.load({
 *   progression: './career-skill-progression.json',
 *   skills:      './skills-index.json',
 *   roles:       './roles-expanded.json',
 * });
 */
function load(paths = {}) {
  const resolve = (p) => {
    if (!p) throw new Error(`[LearningPath] Missing file path.`);
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) throw new Error(`[LearningPath] File not found: ${abs}`);
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  };

  const progData   = resolve(paths.progression);
  const skillsData = resolve(paths.skills);
  const rolesData  = resolve(paths.roles);

  // Index progression by role slug
  _prog = progData.roles || {};

  // Index skills by name (already lowercase in skills-index)
  _skillsIdx = {};
  for (const entry of (skillsData.skills || [])) {
    _skillsIdx[entry.skill] = entry;
  }

  // Index roles by slug
  _roleMap = {};
  for (const role of (rolesData.roles || [])) {
    _roleMap[role.slug] = role;
  }

  _loaded = true;

  const summary = {
    roles_in_progression: Object.keys(_prog).length,
    skills_indexed:       Object.keys(_skillsIdx).length,
    roles_in_graph:       Object.keys(_roleMap).length,
  };

  console.log(
    `[LearningPath] Loaded — ` +
    `${summary.roles_in_progression} progression entries · ` +
    `${summary.skills_indexed} skills · ` +
    `${summary.roles_in_graph} roles`
  );

  return summary;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _guard() {
  if (!_loaded) {
    throw new Error(
      '[LearningPath] Data not loaded. Call load({ progression, skills, roles }) first.'
    );
  }
}

const _norm  = (s) => (s || '').trim().toLowerCase();
const _slugify = (s) => _norm(s).replace(/\s+/g, '-');

/** Resolve slug or title → role node */
function _resolveRole(input) {
  if (!input) return null;
  if (_roleMap[input])        return _roleMap[input];
  const s = _slugify(input);
  if (_roleMap[s])            return _roleMap[s];
  const needle = _norm(input);
  return Object.values(_roleMap).find((r) => _norm(r.title) === needle) || null;
}

/** Normalise a role's skills to lowercase set */
function _skillSet(role) {
  return new Set((role.skills || []).map((s) => _norm(s)));
}

/**
 * Compute skill gap between two role nodes directly from roles-expanded.
 * Used as the fallback when progression map doesn't have a pre-computed entry.
 */
function _computeGapDirect(fromRole, toRole) {
  const fromSkills = _skillSet(fromRole);
  const toSkills   = _skillSet(toRole);
  const missing      = [...toSkills].filter((s) => !fromSkills.has(s)).sort();
  const transferable = [...fromSkills].filter((s) => toSkills.has(s));
  const union        = new Set([...fromSkills, ...toSkills]);
  const overlapPct   = union.size > 0
    ? Math.round((transferable.length / union.size) * 100) : 0;
  return { missing, transferable, overlapPct };
}

/** Classify difficulty from missing skill count */
function _difficulty(missingCount) {
  if (missingCount <= 2)  return 'easy';
  if (missingCount <= 4)  return 'medium';
  if (missingCount <= 6)  return 'hard';
  return 'very_hard';
}

/** Enrich a skill with rarity metadata from the index */
function _enrichSkill(skillName) {
  const entry = _skillsIdx[skillName];
  return {
    skill:      skillName,
    role_count: entry?.role_count ?? null,
    weeks:      WEEKS_BY_RARITY(entry?.role_count),
    rarity:     !entry                  ? 'unknown'
               : entry.role_count >= 51 ? 'foundational'
               : entry.role_count >= 21 ? 'common'
               : entry.role_count >= 6  ? 'niche'
               : entry.role_count >= 2  ? 'specialist'
               :                          'unique',
  };
}

// ── Core functions ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Find the skills needed to move from one role to another, plus estimated time.
 *
 * Strategy:
 *   1. Check the pre-computed progression map for a direct entry (exact gap data)
 *   2. If not found, compute the gap live from roles-expanded skill sets
 *   3. Enrich each missing skill with rarity and per-skill time estimate
 *   4. Sum to total learning time with concurrency discount
 *
 * @param   {string} fromRole   Current role — slug or title
 * @param   {string} toRole     Target role  — slug or title
 * @returns {object}
 *   {
 *     from_role, to_role, difficulty,
 *     missing_skills: string[],
 *     estimated_time_months: number,
 *     skills_detail: [{ skill, rarity, weeks }],
 *     transferable_skills: string[],
 *     skill_overlap_pct: number,
 *     is_cross_department: boolean,
 *     data_source: 'progression_map' | 'live_computed'
 *   }
 *
 * @example
 * lp.findSkillsToMove('data-analyst', 'machine-learning-engineer');
 * lp.findSkillsToMove('software engineer', 'devops architect');
 * lp.findSkillsToMove('marketing-manager', 'Product Manager');
 */
function findSkillsToMove(fromRole, toRole) {
  _guard();

  // Resolve both roles
  const from = _resolveRole(fromRole);
  const to   = _resolveRole(toRole);

  if (!from) return { error: `Role not found: "${fromRole}"` };
  if (!to)   return { error: `Role not found: "${toRole}"` };
  if (from.slug === to.slug) {
    return {
      from_role:             from.slug,
      to_role:               to.slug,
      message:               'Same role — no transition needed.',
      missing_skills:        [],
      estimated_time_months: 0,
    };
  }

  // ── 1. Check pre-computed progression map ──
  let missingSkills   = null;
  let transferable    = null;
  let overlapPct      = null;
  let dataSource      = 'live_computed';
  let precomputedMonths = null;

  const progEntry = _prog[from.slug];
  if (progEntry) {
    const nextEntry = (progEntry.next_roles || []).find(
      (nr) => nr.role === to.slug
    );
    if (nextEntry) {
      missingSkills     = nextEntry.skills_to_learn || [];
      overlapPct        = nextEntry.skill_overlap_pct;
      precomputedMonths = nextEntry.estimated_learning_time_months;
      dataSource        = 'progression_map';

      // Derive transferable from live comparison
      const { transferable: t } = _computeGapDirect(from, to);
      transferable = t;
    }
  }

  // ── 2. Fallback: compute gap live ──
  if (missingSkills === null) {
    const gap = _computeGapDirect(from, to);
    missingSkills = gap.missing;
    transferable  = gap.transferable;
    overlapPct    = gap.overlapPct;
  }

  // ── 3. Enrich skills + estimate time ──
  const skillsDetail = missingSkills.map(_enrichSkill);
  const timeResult   = _calcTime(skillsDetail, from, to);

  // Prefer pre-computed months if available (uses richer model with seniority)
  const finalMonths = precomputedMonths ?? timeResult.estimated_months;

  return {
    from_role:             from.slug,
    from_title:            from.title,
    from_category:         from.category,
    to_role:               to.slug,
    to_title:              to.title,
    to_category:           to.category,
    is_cross_department:   from.category !== to.category,
    difficulty:            _difficulty(missingSkills.length),
    missing_skills:        missingSkills,
    missing_skill_count:   missingSkills.length,
    estimated_time_months: finalMonths,
    skills_detail:         skillsDetail,
    transferable_skills:   transferable,
    transferable_count:    transferable.length,
    skill_overlap_pct:     overlapPct,
    salary_delta: {
      from_mean: from.salary_uk?.mean   ?? null,
      to_mean:   to.salary_uk?.mean     ?? null,
      difference: (from.salary_uk?.mean && to.salary_uk?.mean)
        ? to.salary_uk.mean - from.salary_uk.mean
        : null,
    },
    data_source: dataSource,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generate the full step-by-step career learning journey from a given role.
 *
 * Walks the progression graph, selecting the most direct next role at each
 * step (direct_path roles take priority). Stops when:
 *   - No further progressions exist, or
 *   - Maximum depth (8 hops) is reached, or
 *   - A cycle is detected.
 *
 * Each step includes: the role, the skills to learn, estimated time, and a
 * running cumulative total.
 *
 * @param   {string} role          Starting role — slug or title
 * @param   {object} [opts]
 * @param   {number} [opts.maxSteps=8]      Maximum hops to trace
 * @param   {boolean}[opts.directOnly=true]  Prefer direct career-ladder paths
 * @returns {object}
 *   {
 *     starting_role,
 *     total_steps,
 *     total_estimated_months,
 *     path: [{ step, role, title, skills_to_learn, estimated_months, cumulative_months }]
 *   }
 *
 * @example
 * lp.getLearningPath('junior-data-analyst');
 * lp.getLearningPath('software-engineer', { maxSteps: 5 });
 * lp.getLearningPath('marketing executive');
 */
function getLearningPath(role, opts = {}) {
  _guard();

  const { maxSteps = 8, directOnly = true } = opts;

  const startNode = _resolveRole(role);
  if (!startNode) {
    return { error: `Role not found: "${role}"` };
  }

  const visited  = new Set([startNode.slug]);
  const pathSteps = [];
  let   current   = startNode;
  let   cumulativeMonths = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const progEntry = _prog[current.slug];
    if (!progEntry || !progEntry.next_roles || progEntry.next_roles.length === 0) break;

    const candidates = progEntry.next_roles.filter(
      (nr) => !visited.has(nr.role) && _roleMap[nr.role]
    );
    if (candidates.length === 0) break;

    // Selection priority:
    //   1. Direct path same-department roles (clearest progression)
    //   2. Direct path cross-department roles
    //   3. Any non-direct path with highest overlap
    const direct     = candidates.filter((c) => c.is_direct_path && !c.is_cross_department);
    const directCross= candidates.filter((c) => c.is_direct_path &&  c.is_cross_department);
    const indirect   = candidates.filter((c) => !c.is_direct_path);

    let chosen;
    if (direct.length > 0) {
      // Among direct same-dept, pick fewest missing skills
      chosen = direct.sort((a, b) => a.skills_to_learn_count - b.skills_to_learn_count)[0];
    } else if (!directOnly && directCross.length > 0) {
      chosen = directCross[0];
    } else if (!directOnly && indirect.length > 0) {
      chosen = indirect.sort((a, b) => b.skill_overlap_pct - a.skill_overlap_pct)[0];
    } else if (directCross.length > 0) {
      chosen = directCross[0];
    } else {
      break;
    }

    const targetRole  = _roleMap[chosen.role];
    const months      = chosen.estimated_learning_time_months;
    cumulativeMonths += months;

    visited.add(chosen.role);

    pathSteps.push({
      step,
      role:                  chosen.role,
      title:                 chosen.title || targetRole?.title,
      category:              chosen.target_category || targetRole?.category,
      seniority:             targetRole?.seniority,
      is_direct_path:        chosen.is_direct_path,
      is_cross_department:   chosen.is_cross_department,
      difficulty:            chosen.difficulty,
      skills_to_learn:       chosen.skills_to_learn || [],
      skills_to_learn_count: chosen.skills_to_learn_count || 0,
      estimated_months:      months,
      cumulative_months:     cumulativeMonths,
      salary_uk:             targetRole?.salary_uk ?? null,
    });

    current = targetRole;
  }

  // Total time with a modest overlap discount for continuous upskilling
  const totalMonths = snapToMilestone(cumulativeMonths * 0.9);

  return {
    starting_role:         startNode.slug,
    starting_title:        startNode.title,
    starting_category:     startNode.category,
    starting_seniority:    startNode.seniority,
    starting_salary:       startNode.salary_uk,
    total_steps:           pathSteps.length,
    total_estimated_months:totalMonths,
    path:                  pathSteps,
    note: pathSteps.length === 0
      ? 'No further career progressions found from this role in the dataset.'
      : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Estimate how long it will take to learn a specific list of skills.
 *
 * Each skill's learning time is weighted by its rarity in the job market
 * (role_count from skills-index). Common foundational skills have abundant
 * resources; unique specialist skills require deeper immersion.
 *
 * A concurrency discount is applied beyond the 3rd skill, reflecting
 * realistic parallel learning (e.g. a Kubernetes course also builds
 * some Docker and cloud knowledge).
 *
 * @param   {string[]} skillList         Array of skill names (case-insensitive)
 * @param   {object}   [opts]
 * @param   {boolean}  [opts.verbose=false]  Include per-skill breakdown
 * @returns {object}
 *   {
 *     skill_count,
 *     estimated_time_months,
 *     total_weeks,
 *     skills: [{ skill, rarity, weeks, found_in_index }],
 *     unknown_skills: string[]    // skills not found in index
 *   }
 *
 * @example
 * lp.estimateLearningTime(['python', 'machine learning', 'pytorch']);
 * lp.estimateLearningTime(['kubernetes', 'terraform', 'ci/cd', 'go'], { verbose: true });
 * lp.estimateLearningTime(['stakeholder management', 'team leadership']);
 */
function estimateLearningTime(skillList, opts = {}) {
  _guard();

  const { verbose = false } = opts;

  if (!Array.isArray(skillList) || skillList.length === 0) {
    return {
      skill_count:            0,
      estimated_time_months:  0,
      total_weeks:            0,
      skills:                 [],
      unknown_skills:         [],
    };
  }

  // Deduplicate (case-insensitive)
  const seen   = new Set();
  const deduped = skillList
    .map(_norm)
    .filter((s) => s && !seen.has(s) && seen.add(s));

  const skillsDetail  = deduped.map(_enrichSkill);
  const unknownSkills = skillsDetail
    .filter((s) => !_skillsIdx[s.skill])
    .map((s) => s.skill);

  const timeResult = _calcTime(skillsDetail);

  return {
    skill_count:            deduped.length,
    estimated_time_months:  timeResult.estimated_months,
    total_weeks:            timeResult.total_weeks,
    breakdown: {
      raw_weeks:           timeResult.raw_weeks,
      concurrency_discount: timeResult.concurrency_discount,
      final_weeks:         timeResult.total_weeks,
    },
    skills: verbose
      ? skillsDetail.map((s) => ({
          skill:          s.skill,
          found_in_index: !!_skillsIdx[s.skill],
          rarity:         s.rarity,
          role_count:     s.role_count,
          estimated_weeks:s.weeks,
        }))
      : skillsDetail.map((s) => ({
          skill:  s.skill,
          rarity: s.rarity,
          weeks:  s.weeks,
        })),
    unknown_skills: unknownSkills,
    assumptions: [
      'Part-time upskilling alongside existing role',
      'Mix of online courses, projects, and practice',
      `Concurrency discount of ${Math.round((1 - CONCURRENCY_FACTOR) * 100)}% applied per skill beyond the 3rd`,
    ],
  };
}

// ── Time calculation (shared internal) ───────────────────────────────────────

/**
 * Calculate total learning time from a list of enriched skill objects.
 * Applies concurrency discount beyond the 3rd skill.
 *
 * @private
 */
function _calcTime(skillsDetail, fromRole = null, toRole = null) {
  if (skillsDetail.length === 0) {
    return { raw_weeks: 0, concurrency_discount: 0, total_weeks: 0, estimated_months: 0 };
  }

  // Sort skills hardest-first so the easy ones get the discount
  const sorted = [...skillsDetail].sort((a, b) => b.weeks - a.weeks);

  let totalWeeks = 0;
  for (let i = 0; i < sorted.length; i++) {
    const factor = i < 3 ? 1.0 : CONCURRENCY_FACTOR;
    totalWeeks  += sorted[i].weeks * factor;
  }

  const rawWeeks          = sorted.reduce((s, sk) => s + sk.weeks, 0);
  const concurrencyDiscount = Math.round(rawWeeks - totalWeeks);
  const totalWeeksRounded   = Math.round(totalWeeks);
  const rawMonths           = totalWeeksRounded / 4.33;

  // Add context penalties if roles supplied
  let bonus = 0;
  if (fromRole && toRole) {
    if (fromRole.category !== toRole.category) bonus += 4 / 4.33; // cross-dept ~4 weeks

    const SENIORITY_RANK = {
      Entry: 0, Junior: 1, Mid: 2, Senior: 3,
      Lead: 4, Manager: 4, Head: 5, Director: 6, 'C-Level': 7,
    };
    const fRank = SENIORITY_RANK[fromRole.seniority] ?? 2;
    const tRank = SENIORITY_RANK[toRole.seniority]   ?? 2;
    const jump  = Math.max(0, tRank - fRank);
    bonus += jump * (3 / 4.33); // 3 weeks per level
  }

  const finalMonths     = rawMonths + bonus;
  const estimatedMonths = snapToMilestone(finalMonths);

  return {
    raw_weeks:            rawWeeks,
    concurrency_discount: concurrencyDiscount,
    total_weeks:          totalWeeksRounded,
    estimated_months:     estimatedMonths,
  };
}

// ── Utility functions ─────────────────────────────────────────────────────────

/**
 * Return full metadata for a single skill from the skills index.
 * Useful for understanding a specific skill's market presence.
 *
 * @param   {string} skill
 * @returns {object|null}
 *
 * @example
 * lp.getSkillInfo('kubernetes');
 * // { skill: 'kubernetes', role_count: 27, rarity: 'niche', weeks: 5, top_categories: [...] }
 */
function getSkillInfo(skill) {
  _guard();
  const entry = _skillsIdx[_norm(skill)];
  if (!entry) return { skill: _norm(skill), found: false };
  return {
    skill:          entry.skill,
    found:          true,
    role_count:     entry.role_count,
    rarity:         _enrichSkill(entry.skill).rarity,
    estimated_weeks: WEEKS_BY_RARITY(entry.role_count),
    top_categories: entry.top_categories,
    avg_salary:     entry.avg_salary_roles,
    industries:     entry.industries,
  };
}

/**
 * Return all pre-computed next-role progressions for a role.
 * Lower-level accessor used internally; useful for building UIs.
 *
 * @param   {string} role
 * @returns {object|null}
 */
function getProgression(role) {
  _guard();
  const node = _resolveRole(role);
  if (!node) return { error: `Role not found: "${role}"` };
  const entry = _prog[node.slug];
  if (!entry) return { role: node.slug, next_roles: [] };
  return {
    role:       node.slug,
    title:      node.title,
    category:   node.category,
    seniority:  node.seniority,
    next_roles: entry.next_roles || [],
  };
}

/**
 * Compare learning paths between two potential target roles,
 * helping a user decide which path is faster/easier.
 *
 * @param   {string}   fromRole     Current role
 * @param   {string[]} targetRoles  Two or more target roles to compare
 * @returns {object}                Ranked comparison of paths
 *
 * @example
 * lp.comparePaths('data-analyst', ['data-engineer', 'data-scientist', 'analytics-manager']);
 */
function comparePaths(fromRole, targetRoles) {
  _guard();

  if (!Array.isArray(targetRoles) || targetRoles.length < 2) {
    return { error: 'Provide at least 2 target roles to compare.' };
  }

  const results = targetRoles
    .map((t) => findSkillsToMove(fromRole, t))
    .filter((r) => !r.error)
    .sort((a, b) => a.estimated_time_months - b.estimated_time_months);

  return {
    from_role: results[0]?.from_role || fromRole,
    ranked_paths: results.map((r, i) => ({
      rank:                  i + 1,
      to_role:               r.to_role,
      to_title:              r.to_title,
      difficulty:            r.difficulty,
      missing_skills:        r.missing_skills,
      missing_skill_count:   r.missing_skill_count,
      estimated_time_months: r.estimated_time_months,
      is_cross_department:   r.is_cross_department,
      salary_delta:          r.salary_delta,
    })),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Bootstrap
  load,

  // ── Core ─────────────────────
  findSkillsToMove,     // Skills + time to move from Role A → Role B
  getLearningPath,      // Full step-by-step journey from a starting role
  estimateLearningTime, // How long to learn a given list of skills

  // ── Extended ─────────────────
  comparePaths,         // Rank multiple target roles by learning effort
  getSkillInfo,         // Rarity + time estimate for a single skill
  getProgression,       // Raw pre-computed next-roles for a role
};
