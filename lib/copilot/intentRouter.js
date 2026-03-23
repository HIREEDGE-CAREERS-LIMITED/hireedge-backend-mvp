// ============================================================================
// lib/copilot/intentRouter.js
// HireEdge -- EDGEX Tool Routing Engine
//
// Pipeline:
//   1. detectIntent(message, context)  -> { intent, confidence, slots }
//   2. routeTool(intent, slots)        -> { tool, endpoint, params } | null
//   3. callTool(endpoint, params)      -> { ok, data } | { ok: false, error }
//
// Intent -> Tool map:
//   career_transition -> /api/tools/career-roadmap
//   skill_gap         -> /api/tools/career-gap-explainer
//   salary_benchmark  -> /api/tools/salary-benchmark
//   visa_eligibility  -> /api/tools/visa-intelligence
//   resume_optimise   -> /api/tools/resume-optimiser
//   linkedin_optimise -> /api/tools/linkedin-optimiser
//   general_career    -> null (LLM answers directly)
//   unclear           -> null (clarification required)
// ============================================================================

const BACKEND = process.env.BACKEND_BASE_URL || "https://hireedge-backend-mvp.vercel.app";

//  Intent signal patterns 

const INTENT_PATTERNS = [
  {
    intent: "skill_gap",
    weight: 10,
    patterns: [
      /skill.?gap/i, /missing skill/i, /what.?skill/i, /skills.?need/i,
      /gap analysis/i, /qualify for/i, /skills.?required/i, /lacking/i,
      /skills.?to.?get/i, /upskill/i, /reskill/i,
    ],
  },
  {
    intent: "visa_eligibility",
    weight: 10,
    patterns: [
      /\bvisa\b/i, /immigrat/i, /work permit/i, /skilled worker/i,
      /sponsorship/i, /right to work/i, /tier 2/i, /global talent/i,
      /move to uk/i, /work in uk/i, /relocat/i,
    ],
  },
  {
    intent: "salary_benchmark",
    weight: 9,
    patterns: [
      /salary/i, /\bpay\b/i, /\bearn/i, /compensation/i, /\bwage/i,
      /how much.*(make|earn|paid)/i, /salary range/i, /salary benchmark/i,
      /market rate/i, /pay rise/i, /pay hike/i, /salary hike/i,
    ],
  },
  {
    intent: "resume_optimise",
    weight: 9,
    patterns: [
      /\bcv\b/i, /\bresume\b/i, /\bats\b/i, /fix.*(cv|resume)/i,
      /cv.*(review|check|improve|optimis|rewrite)/i,
      /resume.*(review|check|improve|optimis|rewrite)/i,
      /tailor.*(cv|resume)/i,
    ],
  },
  {
    intent: "linkedin_optimise",
    weight: 9,
    patterns: [
      /linkedin/i, /profile.*(optimis|improve|rewrite|update)/i,
      /linkedin.*(profile|headline|summary|about)/i,
      /recruiter.*profile/i, /profile.*recruiter/i,
    ],
  },
  {
    intent: "career_transition",
    weight: 8,
    patterns: [
      /career.*(transition|change|switch|move|plan)/i,
      /transition.*(plan|roadmap|path)/i,
      /switch.*(role|career|field|industry)/i,
      /career roadmap/i, /90.day/i, /30.day/i, /action plan/i,
      /how.*(become|get into|move into|transition)/i,
      /from.*to.*(role|career|job)/i,
      /career path/i, /next step/i, /career plan/i,
    ],
  },
];

//  Intent detection 

export function detectIntent(message, context) {
  const t = (message || "").toLowerCase().trim();

  const scores = {};
  for (const { intent, weight, patterns } of INTENT_PATTERNS) {
    const hits = patterns.filter(p => p.test(t)).length;
    if (hits > 0) scores[intent] = (scores[intent] || 0) + hits * weight;
  }

  // Boost intents that match context
  if (context?.lastIntent && scores[context.lastIntent]) {
    scores[context.lastIntent] = (scores[context.lastIntent] || 0) + 3;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    // General career questions -- let LLM handle
    const isGeneralCareer = /career|job|role|work|hire|recruit|interview|industry|market|skill/i.test(t);
    return {
      intent: isGeneralCareer ? "general_career" : "unclear",
      confidence: isGeneralCareer ? 0.5 : 0.2,
      slots: extractSlots(message, context),
    };
  }

  const [topIntent, topScore] = sorted[0];
  const confidence = Math.min(0.99, topScore / 30);

  return {
    intent: topIntent,
    confidence,
    slots: extractSlots(message, context),
    allScores: scores,
  };
}

//  Slot extraction 

function extractSlots(message, context) {
  const slots = {
    role:     context?.role     || null,
    target:   context?.target   || null,
    country:  context?.country  || extractCountry(message),
    yearsExp: context?.yearsExp || null,
  };

  // Extract inline roles from message
  const fromMatch = message.match(/(?<![a-zA-Z])from\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)\s+(?:to|into)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+(?:role|as)\b)/i);
  if (fromMatch) {
    if (!slots.role)   slots.role   = fromMatch[1].trim();
    if (!slots.target) slots.target = fromMatch[2].trim();
  }

  const iAmMatch = message.match(/\bi\s+am\s+(?:currently\s+)?(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=\s+(?:and|looking|wanting|hoping|moving)\b|[,.]|$)/i);
  if (iAmMatch && !slots.role) slots.role = iAmMatch[1].trim();

  const becomeMatch = message.match(/want(?:ing)?\s+to\s+(?:be|become|transition\s+to|move\s+into)\s+(?:a |an )?([A-Za-z][A-Za-z -]{2,28}?)(?=[,.]|$|\?|\s+role\b)/i);
  if (becomeMatch && !slots.target) slots.target = becomeMatch[1].trim();

  return slots;
}

function extractCountry(message) {
  const COUNTRIES = {
    "uk": "UK", "united kingdom": "UK", "england": "UK", "britain": "UK",
    "usa": "USA", "united states": "USA", "america": "USA", "us": "USA",
    "canada": "Canada", "australia": "Australia", "germany": "Germany",
    "netherlands": "Netherlands", "singapore": "Singapore",
    "uae": "UAE", "dubai": "UAE", "ireland": "Ireland",
    "sweden": "Sweden", "denmark": "Denmark", "new zealand": "New Zealand",
  };
  const t = message.toLowerCase();
  for (const [key, val] of Object.entries(COUNTRIES)) {
    if (t.includes(key)) return val;
  }
  return null;
}

//  Tool router 

const TOOL_MAP = {
  career_transition: {
    endpoint: "/api/tools/career-roadmap",
    method:   "POST",
    required: ["role", "target"],
    buildParams: (slots) => ({
      currentRole: slots.role,
      targetRole:  slots.target,
      country:     slots.country || "UK",
      yearsExp:    slots.yearsExp || 3,
    }),
  },
  skill_gap: {
    endpoint: "/api/tools/career-gap-explainer",
    method:   "GET",
    required: ["role", "target"],
    buildParams: (slots) => ({
      action: "explain",
      from:   slugify(slots.role),
      to:     slugify(slots.target),
    }),
  },
  salary_benchmark: {
    endpoint: "/api/tools/salary-benchmark",
    method:   "POST",
    required: [],
    buildParams: (slots, message) => ({
      role:    slots.target || slots.role || extractRoleFromMessage(message),
      country: slots.country || "UK",
    }),
  },
  visa_eligibility: {
    endpoint: "/api/tools/visa-intelligence",
    method:   "POST",
    required: [],
    buildParams: (slots) => ({
      country:     slots.country || "UK",
      currentRole: slots.role    || "professional",
      targetRole:  slots.target  || slots.role || "professional",
      yearsExp:    slots.yearsExp || 3,
      education:   "bachelor",
    }),
  },
  resume_optimise: {
    endpoint: "/api/tools/resume-optimiser",
    method:   "POST",
    required: [],
    buildParams: (slots) => ({
      targetRole: slots.target || slots.role,
      country:    slots.country || "UK",
    }),
  },
  linkedin_optimise: {
    endpoint: "/api/tools/linkedin-optimiser",
    method:   "POST",
    required: [],
    buildParams: (slots) => ({
      targetRole:  slots.target || slots.role,
      currentRole: slots.role,
      country:     slots.country || "UK",
    }),
  },
};

export function routeTool(intent, slots) {
  const toolDef = TOOL_MAP[intent];
  if (!toolDef) return null;

  // Check required slots
  const missing = toolDef.required.filter(field => !slots[field]);
  if (missing.length > 0) {
    return { missing, canRoute: false };
  }

  return {
    canRoute:  true,
    endpoint:  toolDef.endpoint,
    method:    toolDef.method,
    params:    toolDef.buildParams(slots),
    toolDef,
  };
}

//  Tool API caller 

export async function callTool(route) {
  const { endpoint, method, params } = route;
  const url = BACKEND + endpoint;

  console.log("[intentRouter] calling tool:", endpoint, JSON.stringify(params));

  try {
    let res;
    if (method === "GET") {
      const qs = new URLSearchParams(params).toString();
      res = await fetch(url + "?" + qs, {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
    }

    const json = await res.json();
    console.log("[intentRouter] tool response status:", res.status, "ok:", json.ok);

    if (!res.ok || json.ok === false) {
      return { ok: false, error: json.error || "Tool returned an error.", status: res.status };
    }

    return { ok: true, data: json.data || json };
  } catch (err) {
    console.error("[intentRouter] tool call failed:", err.message);
    return { ok: false, error: "Tool unavailable: " + err.message };
  }
}

//  Helpers 

function slugify(str) {
  return (str || "").toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function extractRoleFromMessage(message) {
  const m = message.match(/salary.{0,20}(?:for |as (?:a |an )?)([A-Za-z][A-Za-z ]{2,28}?)(?:\?|$|,|\.| in )/i);
  return m ? m[1].trim() : null;
}
