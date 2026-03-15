// ============================================================================
// lib/copilot/intentDetector.js
// HireEdge — AI Career Intelligence Platform
//
// Deterministic intent classifier and entity extractor.
// Parses natural-language career queries into structured intents and entities
// using pattern matching and the role index — no LLM required.
//
// Supported intents:
//   transition    — "How do I move from X to Y?"
//   explore       — "What can I do next?" / "What are my options?"
//   skills_gap    — "What skills do I need for X?"
//   salary        — "What does X pay?" / "Compare salaries"
//   interview     — "Help me prepare for interviews"
//   resume        — "Help with my resume / CV"
//   linkedin      — "Optimise my LinkedIn"
//   visa          — "Can I get a UK visa?" / "Visa eligibility"
//   career_pack   — "Give me a full career pack"
//   role_info     — "Tell me about X role"
//   compare       — "Compare X and Y"
//   general       — fallback
// ============================================================================

import { getRoleBySlug, searchRoles, getRoleMap } from "../dataset/roleIndex.js";

/** @typedef {'transition'|'explore'|'skills_gap'|'salary'|'interview'|'resume'|'linkedin'|'visa'|'career_pack'|'role_info'|'compare'|'general'} Intent */

/**
 * Detect the user's intent and extract structured entities from a message.
 *
 * @param {string} message - Raw user message
 * @param {object} [context] - Optional session context { role, target, skills, yearsExp }
 * @returns {{ intent: Intent, confidence: number, entities: object, raw: string }}
 */
export function detectIntent(message, context = {}) {
  const raw = (message || "").trim();
  const lower = raw.toLowerCase();

  // ── Extract entities first (needed by intent rules) ──────────────────────
  const entities = extractEntities(raw, context);

  // ── Intent classification (ordered by specificity, first match wins) ─────
  const intent = _classifyIntent(lower, entities);

  return {
    intent: intent.name,
    confidence: intent.confidence,
    entities,
    raw,
  };
}

/**
 * Extract structured entities from a message + optional context.
 *
 * @param {string} raw
 * @param {object} context
 * @returns {{ currentRole: string|null, targetRole: string|null, skills: string[], yearsExp: number|null, mentionedRoles: object[] }}
 */
export function extractEntities(raw, context = {}) {
  const lower = raw.toLowerCase();

  // ── Roles mentioned in the message ───────────────────────────────────────
  const mentionedRoles = _extractRolesFromText(lower);

  // ── Current role: context > "from X to Y" pattern > "I am a..." > first mentioned ──
  let currentRole = context.role || null;
  if (!currentRole) {
    // "from X to Y" pattern
    const fromToMatch = lower.match(/from\s+(?:a\s+|an\s+)?(.+?)\s+to\s+(?:a\s+|an\s+)?(.+?)(?:\?|\.|,|$)/);
    if (fromToMatch) {
      const fromFound = _fuzzyMatchRole(fromToMatch[1].trim());
      if (fromFound) currentRole = fromFound.slug;
    }
  }
  if (!currentRole) {
    const iAmMatch = lower.match(/i(?:'m| am) (?:a |an |currently (?:a |an )?)?(.+?)(?:\.|,|$| and| with| who| looking| trying| wanting)/);
    if (iAmMatch) {
      const found = _fuzzyMatchRole(iAmMatch[1].trim());
      if (found) currentRole = found.slug;
    }
  }
  if (!currentRole && mentionedRoles.length >= 1) {
    // If two roles mentioned, first is current, second is target
    if (mentionedRoles.length >= 2) {
      currentRole = mentionedRoles[0].slug;
    } else {
      currentRole = mentionedRoles[0].slug;
    }
  }

  // ── Target role: pattern matching "become/move to/transition to X" ───────
  let targetRole = context.target || null;
  if (!targetRole) {
    const targetPatterns = [
      /(?:become|move to|transition to|switch to|pivot to|get into|land a|apply for|aiming for|targeting|interested in becoming)(?: a| an)? (.+?)(?:\?|\.|,|$| role| position| job)/,
      /(?:how (?:do|can|would) i (?:get|become|move|transition|switch)(?: to)?(?: a| an)?) (.+?)(?:\?|\.|,|$)/,
      /(?:from .+? to) (.+?)(?:\?|\.|,|$)/,
    ];
    for (const pat of targetPatterns) {
      const m = lower.match(pat);
      if (m) {
        const found = _fuzzyMatchRole(m[1].trim());
        if (found) { targetRole = found.slug; break; }
      }
    }
  }
  // If two roles mentioned and no target yet, second is likely the target
  if (!targetRole && mentionedRoles.length >= 2) {
    targetRole = mentionedRoles[1].slug;
    if (!currentRole) currentRole = mentionedRoles[0].slug;
  }

  // ── Skills from context or message ───────────────────────────────────────
  let skills = context.skills || [];
  if (skills.length === 0) {
    const skillMatch = lower.match(/(?:skills?(?:et)?|know|experience (?:in|with))[:\s]+(.+?)(?:\.|$)/);
    if (skillMatch) {
      skills = skillMatch[1].split(/[,;&]+/).map((s) => s.trim()).filter(Boolean);
    }
  }

  // ── Years of experience ──────────────────────────────────────────────────
  let yearsExp = context.yearsExp ?? null;
  if (yearsExp === null) {
    const yrMatch = lower.match(/(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s*)?(?:experience|exp)?/);
    if (yrMatch) yearsExp = parseInt(yrMatch[1], 10);
  }

  return {
    currentRole,
    targetRole,
    skills: skills.map((s) => s.trim()).filter(Boolean),
    yearsExp,
    mentionedRoles,
  };
}

// ===========================================================================
// Intent classification rules
// ===========================================================================

function _classifyIntent(lower, entities) {
  // Career pack (explicit request)
  if (_match(lower, ["career pack", "full pack", "complete pack", "full career", "everything i need", "give me everything", "full report"])) {
    return { name: "career_pack", confidence: 0.95 };
  }

  // Visa
  if (_match(lower, ["visa", "immigration", "sponsor", "work permit", "right to work", "uk visa", "skilled worker"])) {
    return { name: "visa", confidence: 0.92 };
  }

  // Interview
  if (_match(lower, ["interview", "prepare for", "questions", "star method", "behavioural question", "technical question", "salary negotiat"])) {
    return { name: "interview", confidence: 0.90 };
  }

  // Resume / CV
  if (_match(lower, ["resume", "cv ", "curriculum vitae", "ats ", "cover letter", "resume optimis", "cv optimis"])) {
    return { name: "resume", confidence: 0.90 };
  }

  // LinkedIn
  if (_match(lower, ["linkedin", "profile optimis", "headline", "about section"])) {
    return { name: "linkedin", confidence: 0.90 };
  }

  // Salary (must be before role_info to catch "what does X earn")
  if (_match(lower, ["salary", "pay ", "compensation", "earning", " earn", "how much", "remuneration", "pay range", "salary range", "does a .* earn"])) {
    return { name: "salary", confidence: 0.88 };
  }

  // Compare two roles
  if (entities.mentionedRoles.length >= 2 && _match(lower, ["compare", "vs", "versus", "difference between", "which is better"])) {
    return { name: "compare", confidence: 0.88 };
  }

  // Skills gap (explicit — must be before transition fallback)
  if (_match(lower, ["skills? gap", "what skills", "skills? do i need", "skills? i need", "missing skills?", "upskill", "skills? required", "skills? for", "my skills gap", "about my skills"])) {
    return { name: "skills_gap", confidence: 0.88 };
  }

  // Transition (from → to)
  if (entities.currentRole && entities.targetRole && entities.currentRole !== entities.targetRole) {
    return { name: "transition", confidence: 0.92 };
  }
  if (_match(lower, ["move to", "transition to", "become a", "become an", "switch to", "pivot to", "get into", "how do i become", "how can i become", "path to", "route to", "move from"])) {
    if (entities.targetRole) return { name: "transition", confidence: 0.88 };
    return { name: "transition", confidence: 0.70 };
  }

  // Role info (single role enquiry)
  if (_match(lower, ["tell me about", "what is a", "what does a", "describe the", "role of", "overview of"]) && entities.mentionedRoles.length >= 1) {
    return { name: "role_info", confidence: 0.85 };
  }

  // Explore / what next
  if (_match(lower, ["what can i do", "what are my options", "next step", "career options", "what should i do", "where can i go", "what's next", "career move", "next move", "explore"])) {
    return { name: "explore", confidence: 0.85 };
  }

  // If a target role is mentioned but nothing else matched, likely a skills gap or transition
  if (entities.targetRole) {
    return { name: "skills_gap", confidence: 0.65 };
  }

  // If current role present, explore options
  if (entities.currentRole) {
    return { name: "explore", confidence: 0.55 };
  }

  return { name: "general", confidence: 0.3 };
}

// ===========================================================================
// Role extraction helpers
// ===========================================================================

/**
 * Search for role mentions in text by attempting substring matches
 * against the role title index.
 */
function _extractRolesFromText(lower) {
  const roleMap = getRoleMap();
  const found = [];
  const seen = new Set();

  // Build an array of [slug, titleLower] sorted by title length DESC
  // so longer titles match first ("senior data analyst" before "data analyst")
  if (!_extractRolesFromText._cache) {
    _extractRolesFromText._cache = [];
    for (const [slug, role] of roleMap) {
      _extractRolesFromText._cache.push({ slug, titleLower: role.title.toLowerCase() });
    }
    _extractRolesFromText._cache.sort((a, b) => b.titleLower.length - a.titleLower.length);
  }

  for (const { slug, titleLower } of _extractRolesFromText._cache) {
    if (lower.includes(titleLower) && !seen.has(slug)) {
      seen.add(slug);
      found.push({ slug, title: getRoleBySlug(slug).title, matchedText: titleLower });
      if (found.length >= 4) break; // cap
    }
  }

  return found;
}

/**
 * Fuzzy match a text fragment to a role via searchRoles.
 */
function _fuzzyMatchRole(text) {
  // Direct slug attempt
  const slug = text.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const direct = getRoleBySlug(slug);
  if (direct) return direct;

  // Search
  const results = searchRoles(text, { limit: 1 });
  return results.length > 0 ? results[0] : null;
}

/**
 * Check if lower-cased text matches any of the given patterns.
 */
function _match(lower, patterns) {
  return patterns.some((p) => {
    if (p.includes("?")) {
      // Treat ? as regex optional char
      return new RegExp(p).test(lower);
    }
    return lower.includes(p);
  });
}
