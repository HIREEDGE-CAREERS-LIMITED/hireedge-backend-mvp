// /api/gap-explainer.js
import OpenAI from "openai";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  "https://hireedge-backend-mvp.vercel.app",
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────
// Existing helpers  (unchanged)
// ─────────────────────────────────────────────────────────────

/**
 * Maps loose frontend labels to internal gap type codes.
 * Accepts both display labels ("Relocation / Moved abroad") and
 * internal codes ("relocation") — unchanged from original.
 */
function normalizeGapType(input) {
  const s = String(input || "").trim().toLowerCase();
  if (s.includes("relocation") || s.includes("moved"))          return "relocation";
  if (s.includes("study")      || s.includes("cert"))           return "study";
  if (s.includes("health")     || s.includes("personal"))       return "health";
  if (s.includes("caring")     || s.includes("family"))         return "family";
  if (s.includes("job search") || s.includes("redund"))         return "job_search";
  if (s.includes("travel")     || s.includes("sabbat"))         return "travel";
  if (s.includes("career transition") || s.includes("career change")) return "career_change";
  if (["study","relocation","family","health","job_search","career_change","travel","other"].includes(s)) return s;
  return "other";
}

function safeStr(x) {
  return typeof x === "string" ? x.trim() : "";
}

// ─────────────────────────────────────────────────────────────
// JSON parsing  (improved: sync, no async needed, fence-safe)
// ─────────────────────────────────────────────────────────────

/**
 * Strips markdown fences and parses JSON safely.
 * Returns { ok: true, data } or { ok: false, raw }.
 * Never throws.
 *
 * @param {string} raw
 * @returns {{ ok: boolean, data?: object, raw?: string }}
 */
function safeParseJson(raw) {
  let text = (raw || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return { ok: true, data: JSON.parse(match[0]) }; }
      catch { /* fall through */ }
    }
    return { ok: false, raw: text };
  }
}

// ─────────────────────────────────────────────────────────────
// Career Intelligence Layer helpers
// ─────────────────────────────────────────────────────────────

/**
 * Converts a free-text role name into a normalised kebab-case slug.
 * "Senior Data Analyst" → "senior-data-analyst"
 *
 * @param {string} value
 * @returns {string}
 */
function slugifyRole(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derives the base URL for internal API calls from the incoming
 * request's headers. Works across local dev and Vercel deployments.
 *
 * @param {object} req
 * @returns {string}
 */
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host  = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Fetches role intelligence for a single slug.
 * Returns parsed data or null on any failure. Never throws.
 *
 * @param {string} slug
 * @param {string} baseUrl
 * @returns {Promise<object|null>}
 */
async function fetchRoleIntelligence(slug, baseUrl) {
  if (!slug) return null;
  try {
    const res = await fetch(
      `${baseUrl}/api/role-intelligence?slug=${encodeURIComponent(slug)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.error ? null : data;
  } catch {
    return null;
  }
}

/**
 * Fetches the career path between two roles.
 * Returns parsed path data or null on any failure. Never throws.
 *
 * @param {string} fromSlug
 * @param {string} toSlug
 * @param {string} baseUrl
 * @returns {Promise<object|null>}
 */
async function fetchRolePath(fromSlug, toSlug, baseUrl) {
  if (!fromSlug || !toSlug) return null;
  try {
    const res = await fetch(
      `${baseUrl}/api/role-path?from=${encodeURIComponent(fromSlug)}&to=${encodeURIComponent(toSlug)}`,
      { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.error || !data?.path ? null : data;
  } catch {
    return null;
  }
}

/**
 * Builds the Career Intelligence prompt section for the gap explainer.
 * Each block is only emitted when its data is actually available —
 * partial failures produce a gracefully reduced section.
 *
 * @param {{
 *   prevRoleData:  object|null,
 *   targetRoleData: object|null,
 *   pathData:       object|null,
 * }} ctx
 * @returns {string}  Ready-to-embed prompt block (may be empty string)
 */
function buildGapContextSection({ prevRoleData, targetRoleData, pathData }) {
  const lines = [];

  // ── Previous role context ────────────────────────────────
  if (prevRoleData) {
    lines.push("PREVIOUS ROLE CONTEXT (structured data):");
    lines.push(`  Title:     ${prevRoleData.title     || ""}`);
    lines.push(`  Category:  ${prevRoleData.category  || ""}`);
    lines.push(`  Seniority: ${prevRoleData.seniority || ""}`);
    if (prevRoleData.skills?.length) {
      lines.push(`  Skills held: ${prevRoleData.skills.slice(0, 8).join(", ")}`);
    }
    lines.push("");
  }

  // ── Target role context ──────────────────────────────────
  if (targetRoleData) {
    lines.push("TARGET ROLE CONTEXT (structured data):");
    lines.push(`  Title:     ${targetRoleData.title     || ""}`);
    lines.push(`  Category:  ${targetRoleData.category  || ""}`);
    lines.push(`  Seniority: ${targetRoleData.seniority || ""}`);
    if (targetRoleData.skills?.length) {
      lines.push(`  Required skills: ${targetRoleData.skills.join(", ")}`);
    }
    if (targetRoleData.career_paths?.previous_roles?.length) {
      lines.push(`  Common entry routes into this role: ${targetRoleData.career_paths.previous_roles.slice(0, 3).join(", ")}`);
    }
    lines.push("");
  }

  // ── Transition realism ───────────────────────────────────
  if (prevRoleData && targetRoleData) {
    const sameCat = prevRoleData.category === targetRoleData.category;
    const transition = sameCat
      ? `same-category progression (${prevRoleData.category})`
      : `cross-category move (${prevRoleData.category} → ${targetRoleData.category})`;
    lines.push(`TRANSITION TYPE: ${transition}.`);
    lines.push("Use this to calibrate how significant the career pivot is when framing the gap narrative.");
    lines.push("");
  }

  // ── Structured career path ───────────────────────────────
  if (pathData?.path?.length) {
    lines.push("STRUCTURED CAREER PATH (from role graph):");
    lines.push(`  ${pathData.path.join(" → ")}`);
    if (pathData.steps != null) {
      lines.push(`  Steps: ${pathData.steps}`);
    }
    lines.push("Use this path to make the transition explanation sound realistic and grounded.");
    lines.push("");
  }

  return lines.join("\n").trim();
}

// ─────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // ── CORS  (unchanged) ─────────────────────────────────────
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    // ── Input parsing  (unchanged) ────────────────────────
    const gapTypeRaw    = body.gapType;
    const duration      = safeStr(body.duration);
    const previousRole  = safeStr(body.previousRole);
    const targetRole    = safeStr(body.targetRole);
    const reasonDetails = safeStr(body.reasonDetails || body.whatDidYouDo);
    const gapType       = normalizeGapType(gapTypeRaw);

    if (!gapTypeRaw) {
      return res.status(200).json({ ok: false, error: "gapType is required" });
    }
    if (!reasonDetails) {
      return res.status(200).json({ ok: false, error: "Please describe what you did during the gap." });
    }

    // ── Fallback templates  (unchanged) ───────────────────
    const fromRole = previousRole || "my previous role";
    const toRole   = targetRole   || "this role";
    const dur      = duration ? ` (${duration})` : "";

    const fallback = {
      cvLine:          `Planned career break${dur} to focus on ${reasonDetails}, now returning to full-time work aligned with ${toRole}.`,
      interviewAnswer: `I took a planned break${dur} to focus on ${reasonDetails}. I stayed structured, kept learning, and I'm now ready to bring that focus back into a full-time role aligned with ${toRole}.`,
      recruiterEmail:  `You may notice a short gap${dur}. During this time, I focused on ${reasonDetails}. I'm now fully available and actively seeking a long-term opportunity aligned with ${toRole}.`,
      guidanceNote:    "Keep it honest, positive, and future-focused. Avoid over-explaining; emphasise what you learned and why you're ready now.",
    };

    // ── No OpenAI key: enriched fallback ─────────────────
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        gapType,
        duration,
        ...fallback,
        emailParagraph: fallback.recruiterEmail,
        note:           fallback.guidanceNote,
      });
    }

    // ── Career Intelligence Layer lookups ─────────────────
    //
    //  Both role intelligence fetches + path fetch run in
    //  parallel. All resolve to data or null — failures are
    //  silently swallowed and never block the engine.
    //
    const baseUrl    = getBaseUrl(req);
    const prevSlug   = slugifyRole(previousRole);
    const targetSlug = slugifyRole(targetRole);

    const [prevRoleData, targetRoleData, pathData] = await Promise.all([
      fetchRoleIntelligence(prevSlug,   baseUrl),
      fetchRoleIntelligence(targetSlug, baseUrl),
      (prevSlug && targetSlug)
        ? fetchRolePath(prevSlug, targetSlug, baseUrl)
        : Promise.resolve(null),
    ]);

    // ── Build role context prompt section ─────────────────
    const gapContextSection = buildGapContextSection({
      prevRoleData,
      targetRoleData,
      pathData,
    });

    // ── AI prompts ────────────────────────────────────────
    const systemPrompt = `
You are "HireEdge Career Gap Coach".

Generate premium, recruiter-ready gap explanations.
Tone: confident, honest, positive, concise (UK job market).
Never mention "I was unemployed". Use "career break" / "planned break" / "transition period".
Avoid medical detail. Avoid personal oversharing.
${gapContextSection
  ? "Use the structured Career Intelligence data provided to make the transition narrative realistic and specific."
  : ""}

Return ONLY JSON in this schema:

{
  "cvLine": string,
  "cvLineOptions": string[],
  "interviewAnswer": string,
  "interviewAnswerOptions": string[],
  "recruiterEmail": string,
  "coverLetterLine": string,
  "linkedinLine": string,
  "keyStrengthsToHighlight": string[],
  "doDont": { "do": string[], "dont": string[] },
  "tailoringTips": string[]
}

Rules:
- cvLine <= 180 chars, ATS-friendly.
- interview answers 120–180 words.
- recruiterEmail is a short paragraph (3–5 lines).
- Make it specific to the target role and what they did.
- No markdown, no backticks, JSON only.
`.trim();

    const userPrompt = `
GAP TYPE: ${gapType}
DURATION: ${duration || "Not specified"}
PREVIOUS ROLE: ${previousRole || "Not specified"}
TARGET ROLE: ${targetRole || "Not specified"}

WHAT I DID DURING THE GAP:
${reasonDetails}
${gapContextSection ? `\nCAREER INTELLIGENCE DATA\n${gapContextSection}` : ""}

Generate premium outputs for CV + interview + recruiter email + LinkedIn.
`.trim();

    // ── OpenAI call ───────────────────────────────────────
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    });

    const raw    = response.output?.[0]?.content?.[0]?.text ?? "";
    const parsed = safeParseJson(raw);

    // If model returned bad JSON, fall back gracefully
    if (!parsed.ok) {
      console.error("gap-explainer parse error:", raw.slice(0, 300));
      return res.status(200).json({
        ok: true,
        gapType,
        duration,
        ...fallback,
        emailParagraph: fallback.recruiterEmail,
        note:           fallback.guidanceNote,
      });
    }

    const p = parsed.data;

    // ── Build response  (all existing keys preserved) ─────
    return res.status(200).json({
      ok: true,
      gapType,
      duration,

      // ── Core frontend keys  (unchanged) ─────────────────
      cvLine:          safeStr(p.cvLine)          || fallback.cvLine,
      interviewAnswer: safeStr(p.interviewAnswer)  || fallback.interviewAnswer,
      recruiterEmail:  safeStr(p.recruiterEmail)   || fallback.recruiterEmail,
      guidanceNote:    fallback.guidanceNote,

      // ── Premium extras ────────────────────────────────
      cvLineOptions:            Array.isArray(p.cvLineOptions)            ? p.cvLineOptions.filter(Boolean)            : [],
      interviewAnswerOptions:   Array.isArray(p.interviewAnswerOptions)   ? p.interviewAnswerOptions.filter(Boolean)   : [],
      coverLetterLine:          safeStr(p.coverLetterLine),
      linkedinLine:             safeStr(p.linkedinLine),
      keyStrengthsToHighlight:  Array.isArray(p.keyStrengthsToHighlight)  ? p.keyStrengthsToHighlight.filter(Boolean)  : [],
      doDont: (p.doDont && typeof p.doDont === "object")
        ? p.doDont
        : { do: [], dont: [] },
      tailoringTips:            Array.isArray(p.tailoringTips)            ? p.tailoringTips.filter(Boolean)            : [],

      // ── Backward compatible keys  (unchanged) ─────────
      emailParagraph: safeStr(p.recruiterEmail) || fallback.recruiterEmail,
      note:           fallback.guidanceNote,
      durationText:   duration ? `Approximate duration: ${duration}.` : "",

      // ── Optional role context meta ─────────────────────
      //    Tells the frontend which roles were resolved —
      //    does not break any existing key.
      roleContext: (prevRoleData || targetRoleData) ? {
        previousRole: prevRoleData
          ? { slug: prevRoleData.slug, title: prevRoleData.title, category: prevRoleData.category }
          : null,
        targetRole: targetRoleData
          ? { slug: targetRoleData.slug, title: targetRoleData.title, category: targetRoleData.category }
          : null,
        pathFound: !!pathData,
      } : undefined,
    });

  } catch (err) {
    console.error("gap-explainer error:", err?.message || err);
    return res.status(200).json({
      ok:    false,
      error: "Server error while generating gap explanation",
    });
  }
}
