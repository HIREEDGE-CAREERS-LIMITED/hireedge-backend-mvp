// pages/api/career-intelligence/blind-spot.js

let _rolesMap = null;
let _skillFreq = null;

function ensureIndex() {
  if (_rolesMap) return;
  const raw = require('../../../data/roles-enriched.json');
  const roles = raw.roles;
  _rolesMap = {};
  _skillFreq = {};

  for (const role of roles) {
    _rolesMap[role.slug] = role;
    for (const skill of role.skills || []) {
      _skillFreq[skill] = (_skillFreq[skill] || 0) + 1;
    }
  }
}

function getSalary(role) {
  const s = role?.salary_uk;
  if (!s) return 0;
  return s.mean || s.max || s.min || 0;
}

function weightedJaccard(skillsA, skillsB) {
  const setA = new Set(skillsA || []);
  const setB = new Set(skillsB || []);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;

  let inter = 0;
  let total = 0;

  for (const s of union) {
    const w = 1 / ((_skillFreq[s] || 0) + 1);
    total += w;
    if (setA.has(s) && setB.has(s)) inter += w;
  }

  return total === 0 ? 0 : inter / total;
}

function bfsReachable(startSlug, maxHops) {
  const visited = new Set([startSlug]);
  const queue = [{ slug: startSlug, distance: 0 }];
  const results = [];

  while (queue.length) {
    const { slug, distance } = queue.shift();
    if (distance >= maxHops) continue;

    const node = _rolesMap[slug];
    if (!node) continue;

    const nextEdges = node.transitions?.next || [];

    for (const edge of nextEdges) {
      const targetSlug = edge.role_slug || edge.slug || edge.to || null;
      if (!targetSlug || visited.has(targetSlug) || !_rolesMap[targetSlug]) continue;

      visited.add(targetSlug);
      results.push({ slug: targetSlug, distance: distance + 1, edge });
      queue.push({ slug: targetSlug, distance: distance + 1 });
    }
  }

  return results;
}

function edgeDifficultyScore(edge) {
  if (!edge) return 0.5;

  if (typeof edge.difficulty_score === 'number') {
    const ds = edge.difficulty_score;
    return ds > 1 ? Math.max(0, 1 - ds / 100) : Math.max(0, 1 - ds);
  }

  const label = (edge.difficulty_label || '').toLowerCase();
  const labelMap = {
    low: 1.0,
    easy: 1.0,
    simple: 1.0,
    medium: 0.6,
    moderate: 0.6,
    hard: 0.3,
    difficult: 0.3,
    high: 0.3,
    stretch: 0.1,
    very_hard: 0.1,
  };

  if (labelMap[label] !== undefined) return labelMap[label];

  if (typeof edge.estimated_years === 'number') {
    if (edge.estimated_years <= 1) return 1.0;
    if (edge.estimated_years <= 2) return 0.6;
    if (edge.estimated_years <= 4) return 0.3;
    return 0.1;
  }

  return 0.5;
}

function edgeDifficultyLabel(edge) {
  if (!edge) return 'medium';
  if (edge.difficulty_label) return edge.difficulty_label.toLowerCase();

  const score = edgeDifficultyScore(edge);
  if (score >= 0.8) return 'low';
  if (score >= 0.5) return 'medium';
  if (score >= 0.2) return 'hard';
  return 'stretch';
}

function edgeConfidence(edge) {
  if (!edge) return 0.3;

  let score = 0.3;
  if (edge.difficulty_label) score += 0.2;
  if (edge.difficulty_score) score += 0.1;
  if (edge.estimated_years) score += 0.2;
  if (edge.salary_growth_pct) score += 0.1;
  if (edge.frequency) score = Math.min(edge.frequency / 50, 1.0);

  return Math.min(score, 1.0);
}

function computeEdgexScore({ overlap, salaryNorm, hops, diffScore, confidence }) {
  return Math.round((
    0.35 * overlap +
    0.25 * salaryNorm +
    0.20 * (1 / Math.max(hops, 1)) +
    0.12 * diffScore +
    0.08 * confidence
  ) * 1000) / 10;
}

function buildMissingSkills(targetRole, currentSet) {
  const total = Object.keys(_rolesMap).length;

  return (targetRole.skills || [])
    .filter((s) => !currentSet.has(s))
    .map((s) => {
      const density = (_skillFreq[s] || 1) / total;
      const criticality =
        targetRole.skill_criticality?.[s] ||
        (density > 0.30 ? 'critical' : density > 0.10 ? 'important' : 'nice-to-have');

      return { skill: s, criticality };
    })
    .sort((a, b) => {
      const order = { critical: 0, important: 1, 'nice-to-have': 2 };
      return (order[a.criticality] ?? 3) - (order[b.criticality] ?? 3);
    });
}

function buildWhy(target, source, delta, hops, edge) {
  if (target.why_this_role) return target.why_this_role;

  const targetSkillSet = new Set(target.skills || []);
  const shared = (source.skills || []).filter((s) => targetSkillSet.has(s));
  const topShared = shared.slice(0, 3).join(', ') || 'overlapping skills';
  const hopStr = hops === 1 ? 'one transition' : `${hops} transitions`;
  const salStr =
    delta > 0
      ? `a salary uplift of £${Math.round(delta).toLocaleString('en-GB')}`
      : 'a comparable salary level';

  let edgeStr = '';
  if (edge?.estimated_years) {
    edgeStr = ` Typical transition time is ${edge.estimated_years} year${edge.estimated_years === 1 ? '' : 's'}.`;
  }
  if (edge?.salary_growth_pct) {
    edgeStr += ` Salary growth on this path averages ${edge.salary_growth_pct}%.`;
  }

  return (
    `EDGEX identified strong skill overlap through ${topShared}. ` +
    `This role is ${hopStr} away in the career graph with ${salStr}. ` +
    `It sits in a different career category — a genuine blind spot you would never search for.` +
    edgeStr
  );
}

function buildNextStep(missing, target, edge) {
  if (target.recommended_next_step) return target.recommended_next_step;

  const critical = missing
    .filter((m) => m.criticality === 'critical')
    .slice(0, 2)
    .map((m) => m.skill);

  if (edge?.estimated_years) {
    const yr = edge.estimated_years;
    const gap = critical.length
      ? ` Focus on ${critical.join(' and ')} to accelerate this.`
      : '';
    return `EDGEX estimates this transition takes around ${yr} year${yr === 1 ? '' : 's'}.${gap}`;
  }

  return critical.length
    ? `Focus on closing your critical gaps: ${critical.join(' and ')}. A hands-on project in these areas is your fastest route to being competitive for ${target.title} roles.`
    : `Your skill overlap is already strong. Use the Career Path tool to map the exact route to ${target.title}.`;
}

function buildResult(rank, target, source, distance, overlap, maxDelta, edge) {
  const currentMean = getSalary(source);
  const targetMean = getSalary(target);
  const delta = targetMean - currentMean;
  const currentSet = new Set(source.skills || []);
  const missing = buildMissingSkills(target, currentSet);

  const diffScore = edgeDifficultyScore(edge);
  const diffLabel = edgeDifficultyLabel(edge);
  const confidence = edgeConfidence(edge);
  const salaryNorm = maxDelta > 0 ? Math.min(delta / maxDelta, 1) : 0;

  const evidence = {};
  if (edge?.frequency) evidence.known_transitions = edge.frequency;
  if (edge?.estimated_years) evidence.estimated_years = edge.estimated_years;
  if (edge?.salary_growth_pct) evidence.salary_growth_pct = edge.salary_growth_pct;
  if (edge?.difficulty_label) evidence.difficulty_label = edge.difficulty_label;

  const targetSkillSet = new Set(target.skills || []);
  const sharedSkills = (source.skills || []).filter((s) => targetSkillSet.has(s));

  return {
    rank,
    role_slug: target.slug,
    role_title: target.title,
    category: target.category || 'Unknown',
    graph_distance: distance,
    skill_overlap_score: Math.round(overlap * 1000) / 1000,
    salary_delta: {
      current_mean: currentMean,
      target_mean: targetMean,
      delta: Math.round(delta),
      delta_percent: currentMean > 0 ? Math.round((delta / currentMean) * 1000) / 10 : 0,
    },
    transition_difficulty: diffLabel,
    confidence_score: Math.round(confidence * 1000) / 1000,
    edgex_score: computeEdgexScore({ overlap, salaryNorm, hops: distance, diffScore, confidence }),
    why_this_role: buildWhy(target, source, delta, distance, edge),
    shared_skills: sharedSkills,
    missing_skills: missing,
    recommended_next_step: buildNextStep(missing, target, edge),
    salary_trajectory: targetMean
      ? {
          year_1: Math.round(targetMean * 0.93),
          year_2: targetMean,
          year_3: Math.round(targetMean * 1.10),
        }
      : null,
    transition_evidence: evidence,
  };
}

function findBlindSpots(source, { minOverlap, minSalaryDelta, maxHops, limit }) {
  const currentCategory = source.category || '';
  const currentMean = getSalary(source);
  const reachable = bfsReachable(source.slug, maxHops);
  const candidates = [];

  for (const { slug, distance, edge } of reachable) {
    const target = _rolesMap[slug];
    if (!target) continue;
    if ((target.category || '') === currentCategory) continue;

    const overlap = weightedJaccard(source.skills || [], target.skills || []);
    if (overlap < minOverlap) continue;

    const delta = getSalary(target) - currentMean;
    if (delta < minSalaryDelta) continue;

    candidates.push({ target, distance, overlap, delta, edge });
  }

  const maxDelta = Math.max(...candidates.map((c) => c.delta), 1);

  return candidates
    .map((c) => ({
      ...c,
      score: computeEdgexScore({
        overlap: c.overlap,
        salaryNorm: Math.min(c.delta / maxDelta, 1),
        hops: c.distance,
        diffScore: edgeDifficultyScore(c.edge),
        confidence: edgeConfidence(c.edge),
      }),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c, i) => buildResult(i + 1, c.target, source, c.distance, c.overlap, maxDelta, c.edge));
}

function findWithFallback(source, params) {
  let results = findBlindSpots(source, params);
  if (results.length) return { results, fallback: false, fallback_reason: null };

  results = findBlindSpots(source, { ...params, minOverlap: 0.45 });
  if (results.length) {
    return {
      results,
      fallback: true,
      fallback_reason: 'Overlap threshold relaxed to 0.45 — limited strong matches for this role.',
    };
  }

  results = findBlindSpots(source, { ...params, minOverlap: 0.45, maxHops: Math.max(params.maxHops, 4) });
  if (results.length) {
    return {
      results,
      fallback: true,
      fallback_reason: 'Graph traversal extended to 4 hops — sparse transition data for this role.',
    };
  }

  const maxDelta = 50000;
  const adjacent = Object.values(_rolesMap)
    .filter((r) => r.slug !== source.slug)
    .filter((r) => Array.isArray(r.skills) && r.skills.length > 0)
    .map((r) => ({ r, overlap: weightedJaccard(source.skills || [], r.skills) }))
    .filter(({ overlap }) => overlap > 0.35)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, params.limit)
    .map(({ r, overlap }, i) => buildResult(i + 1, r, source, 1, overlap, maxDelta, null));

  return {
    results: adjacent,
    fallback: true,
    fallback_reason: 'Insufficient cross-category transition data. Showing closest high-overlap roles.',
  };
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'METHOD_NOT_ALLOWED',
      message: 'Only GET requests are supported.',
    });
  }

  const role = (req.query.role || '').trim().toLowerCase();
  if (!role) {
    return res.status(400).json({
      error: 'MISSING_ROLE_PARAM',
      message: 'Missing required parameter: role',
      status: 400,
    });
  }

  try {
    ensureIndex();
  } catch (err) {
    console.error('[EDGEX blind-spot] Failed to load knowledge graph:', err);
    return res.status(500).json({
      error: 'GRAPH_UNAVAILABLE',
      message: 'The career knowledge graph is temporarily unavailable.',
      status: 500,
    });
  }

  const source = _rolesMap[role];
  if (!source) {
    return res.status(404).json({
      error: 'ROLE_NOT_FOUND',
      message: `Role slug "${role}" does not exist in the knowledge graph.`,
      status: 404,
    });
  }

  const params = {
    minOverlap: parseFloat(req.query.min_overlap) || 0.55,
    minSalaryDelta: parseInt(req.query.min_salary_delta, 10) || 0,
    maxHops: Math.min(Math.max(parseInt(req.query.max_hops, 10) || 3, 1), 4),
    limit: Math.min(Math.max(parseInt(req.query.limit, 10) || 3, 1), 10),
  };

  const { results, fallback, fallback_reason } = findWithFallback(source, params);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  return res.status(200).json({
    feature: 'career_blind_spot',
    version: '1.1',
    generated_by: 'EDGEX',
    current_role: {
      slug: source.slug,
      title: source.title,
      category: source.category || 'Unknown',
      salary_mean: getSalary(source),
    },
    blind_spot_roles: results,
    ...(fallback && { fallback: true, fallback_reason }),
    metadata: {
      total_roles_scanned: Object.keys(_rolesMap).length,
      graph_depth_searched: params.maxHops,
      params_used: params,
      generated_at: new Date().toISOString(),
    },
  });
}
