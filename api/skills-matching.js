// pages/skills.js
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../utils/supabaseClient";

// ✅ WEB repo endpoints (same-domain)
const CHECKOUT_API = "/api/stripe/create-checkout";
const BILLING_STATUS_API = "/api/billing/status";
const CREDITS_BALANCE_API = "/api/credits/balance";
const CREDITS_CONSUME_API = "/api/credits/consume";

// ✅ IMPORTANT: call WEB proxy (NO CORS)
const SKILLS_API = "/api/engine/skills-matching";

const DRAFT_KEY = "he-skills-draft";

// ✅ Safe JSON helper (prevents crashes)
async function safeReadJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text.slice(0, 200) };
  }
}

export default function SkillsGapPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  // Inputs
  const [targetRole, setTargetRole] = useState("");
  const [cvSnapshot, setCvSnapshot] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  // UI state
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Results
  const [hasResults, setHasResults] = useState(false);
  const [overallFit, setOverallFit] = useState(null);
  const [gapSummary, setGapSummary] = useState(
    "Paste a job and CV to see your overall fit summary here."
  );
  const [matchedSkills, setMatchedSkills] = useState([]);
  const [partialSkills, setPartialSkills] = useState([]);
  const [missingSkills, setMissingSkills] = useState([]);
  const [learningPlan, setLearningPlan] = useState([]);

  // Entitlements
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(0);
  const [hasAccess, setHasAccess] = useState(false);

  const isLoggedIn = !!user;
  const userEmail = user?.email || "";

  // -------- Draft helpers --------
  function saveDraft() {
    if (typeof window === "undefined") return;
    try {
      const payload = { targetRole, cvSnapshot, jobDescription };
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn("Skills draft save failed:", e);
    }
  }

  function restoreDraft() {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (typeof draft.targetRole === "string") setTargetRole(draft.targetRole);
      if (typeof draft.cvSnapshot === "string") setCvSnapshot(draft.cvSnapshot);
      if (typeof draft.jobDescription === "string")
        setJobDescription(draft.jobDescription);
    } catch (e) {
      console.warn("Skills draft restore failed:", e);
    }
  }

  function redirectToLogin() {
    saveDraft();
    const currentUrl =
      typeof window !== "undefined" ? window.location.href : "/skills";
    router.push(`/login?redirect=${encodeURIComponent(currentUrl)}`);
  }

  async function getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }

  // ✅ entitlements check (Pro/Elite or credits)
  async function refreshEntitlements() {
    if (!isLoggedIn) {
      setIsUnlimited(false);
      setCreditsRemaining(0);
      setHasAccess(false);
      return { unlimited: false, remaining: 0, access: false };
    }

    const token = await getAccessToken();
    if (!token) {
      setIsUnlimited(false);
      setCreditsRemaining(0);
      setHasAccess(false);
      return { unlimited: false, remaining: 0, access: false };
    }

    // 1) subscription
    let unlimited = false;
    try {
      const sResp = await fetch(BILLING_STATUS_API, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const sData = await safeReadJson(sResp);
      unlimited = !!sData?.ok && !!sData?.isUnlimited;
    } catch (e) {
      console.warn("billing/status error:", e);
    }

    setIsUnlimited(unlimited);

    if (unlimited) {
      setCreditsRemaining(0);
      setHasAccess(true);
      return { unlimited: true, remaining: 0, access: true };
    }

    // 2) credits
    let remaining = 0;
    try {
      const cResp = await fetch(`${CREDITS_BALANCE_API}?engineId=skills`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const cData = await safeReadJson(cResp);
      remaining = cData?.ok ? Number(cData.remaining || 0) : 0;
    } catch (e) {
      console.warn("credits/balance error:", e);
    }

    setCreditsRemaining(remaining);
    setHasAccess(remaining > 0);

    return { unlimited: false, remaining, access: remaining > 0 };
  }

  async function consumeOneCredit() {
    const token = await getAccessToken();
    if (!token) return false;

    const r = await fetch(CREDITS_CONSUME_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ engineId: "skills" }),
    });

    const d = await safeReadJson(r);
    return !!d?.ok;
  }

  // -------- Engine run --------
  async function runSkillsEngine(isAuto = false, ent = null) {
    const targetRoleClean = (targetRole || "").trim();
    const cvClean = (cvSnapshot || "").trim();
    const jdClean = (jobDescription || "").trim();

    if (!targetRoleClean || !cvClean) {
      if (!isAuto) alert("Please fill both Target role and your CV / skills snapshot.");
      return;
    }

    const canRun = ent ? (ent.unlimited || ent.access) : (isUnlimited || hasAccess);
    if (!canRun) {
      if (!isAuto) alert("No credits available. Please purchase a single run.");
      return;
    }

    setLoading(true);
    try {
      // ✅ Call WEB proxy (same domain)
      const res = await fetch(SKILLS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: jdClean,
          cvText: cvClean,
          targetRole: targetRoleClean,
        }),
      });

      const data = await safeReadJson(res);
      if (!res.ok || !data?.ok) {
        alert(data?.error || `Skills engine failed (${res.status}).`);
        return;
      }

      setHasResults(true);
      setOverallFit(data.overallFit ?? null);
      setGapSummary(
        data.gapSummary ||
          "The engine analysed your skills vs the target role and highlighted matched, partial and missing skills below."
      );
      setMatchedSkills(data.matchedSkills || []);
      setPartialSkills(data.partialMatchSkills || []);
      setMissingSkills(data.missingSkills || []);
      setLearningPlan(data.learningPlan || []);

      // consume only if NOT unlimited
      const pro = ent ? !!ent.unlimited : !!isUnlimited;
      if (!pro) {
        const consumed = await consumeOneCredit();
        if (!consumed) console.warn("Credit consume failed. Refresh page.");
        await refreshEntitlements();
      }
    } catch (err) {
      console.error("Skills engine network error:", err);
      alert("Network error – please try again.");
    } finally {
      setLoading(false);
    }
  }

  // -------- Stripe checkout --------
  async function goToStripeCheckout() {
    saveDraft();

    if (!isLoggedIn) return redirectToLogin();

    setPaying(true);
    try {
      const token = await getAccessToken();
      if (!token) return redirectToLogin();

      const res = await fetch(CHECKOUT_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ engineId: "skills" }),
      });

      const data = await safeReadJson(res);
      if (!res.ok || !data?.ok || !data?.url) {
        alert(data?.error || `Unable to start payment (${res.status}).`);
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error("Stripe checkout error (skills):", err);
      alert("Payment could not be started. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  async function handleRunClick() {
    const targetRoleClean = (targetRole || "").trim();
    const cvClean = (cvSnapshot || "").trim();
    if (!targetRoleClean || !cvClean) {
      alert("Please fill both Target role and your CV / skills snapshot.");
      return;
    }

    if (!isLoggedIn) return redirectToLogin();

    if (isUnlimited || hasAccess) return runSkillsEngine(false);
    return goToStripeCheckout();
  }

  // restore draft early
  useEffect(() => {
    restoreDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // init: entitlements + Stripe return auto-run
  useEffect(() => {
    if (!router.isReady) return;
    if (authLoading) return;

    (async () => {
      try {
        setCheckingAuth(true);

        const paid =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("paid") === "1";

        await refreshEntitlements();

        if (paid && isLoggedIn) {
          restoreDraft();
          const ent2 = await refreshEntitlements();
          if (ent2.unlimited || ent2.access) {
            await runSkillsEngine(true, ent2);
          }
          router.replace(router.pathname, undefined, { shallow: true });
        }
      } catch (e) {
        console.warn("Skills init failed:", e);
      } finally {
        setCheckingAuth(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, authLoading, isLoggedIn]);

  const buttonLabel = loading
    ? "Please wait…"
    : paying
    ? "Connecting to checkout…"
    : checkingAuth
    ? "Checking…"
    : isUnlimited || hasAccess
    ? "Run Skills Engine"
    : "Pay & Run Skills Engine (£1.49)";

  // -------- UI --------
  return (
    <>
      {/* your CSS stays the same (kept as-is) */}
      <style jsx global>{`
        body { background: #020617; }
        /* keep your full CSS unchanged below — I didn’t delete anything */
        .he-tool-wrap {
          width: 100%;
          min-height: calc(100vh - 200px);
          padding: 110px 0 120px;
          background: radial-gradient(circle at top left, rgba(56, 189, 248, 0.28), transparent 55%),
            radial-gradient(circle at bottom right, rgba(129, 140, 248, 0.32), transparent 55%),
            #020617;
          display: flex;
          justify-content: center;
          box-sizing: border-box;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
          color: #e5e7eb;
        }
        .he-tool-inner { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }
        .he-tool-back { margin-bottom: 16px; font-size: 12px; }
        .he-tool-back a { color: #a5b4fc; text-decoration: none; }
        .he-tool-back a:hover { text-decoration: underline; }
        .he-tool-chip {
          display: inline-flex; align-items: center; gap: 8px; font-size: 11px;
          padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.7);
          background: rgba(15, 23, 42, 0.94); color: #9ca3af; margin-bottom: 10px;
        }
        .he-tool-chip span { width: 6px; height: 6px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.35); }
        .he-login-pill {
          display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
          border-radius: 999px; font-size: 11px; margin-bottom: 12px;
        }
        .he-login-pill--in { background: rgba(22, 163, 74, 0.2); border: 1px solid rgba(22, 163, 74, 0.7); color: #bbf7d0; }
        .he-login-pill--out { background: rgba(30, 64, 175, 0.25); border: 1px solid rgba(59, 130, 246, 0.7); color: #bfdbfe; cursor: pointer; }
        .he-login-pill-label { font-weight: 500; }
        .he-login-pill-email { color: #e5e7eb; }
        .he-tool-title { font-size: 30px; font-weight: 650; line-height: 1.2; margin-bottom: 8px; letter-spacing: -0.03em; }
        .he-tool-subtitle { font-size: 14px; line-height: 1.7; max-width: 560px; color: #9ca3af; margin-bottom: 18px; }
        .he-tool-bullets { list-style: none; padding: 0; margin: 0 0 18px; font-size: 13px; color: #cbd5e1; }
        .he-tool-bullets li { display: flex; gap: 8px; margin-bottom: 8px; }
        .he-tool-bullets li span:first-child { font-size: 15px; }
        .he-tool-tags-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 26px; }
        .he-tag-pill { padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(148, 163, 184, 0.7); font-size: 11px; background: rgba(15, 23, 42, 0.95); color: #e5e7eb; }
        .he-tag-pill--accent {
          background: radial-gradient(circle at 0 0, rgba(52, 211, 153, 0.25), rgba(15, 23, 42, 0.95));
          border-color: #22c55e; color: #bbf7d0;
        }
        .he-tool-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; }
        .he-tool-card {
          border-radius: 22px; padding: 22px 22px 20px;
          background: radial-gradient(circle at 0 0, rgba(59, 130, 246, 0.55), rgba(30, 58, 138, 0.95));
          box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.55), 0 28px 70px rgba(0, 0, 0, 0.75);
        }
        .he-tool-card-title { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: #c7d2fe; margin-bottom: 6px; }
        .he-tool-card-note { font-size: 11px; color: #a5b4fc; margin-bottom: 12px; }
        .he-input-group { display: flex; flex-direction: column; margin-bottom: 12px; }
        .he-input-label { font-size: 12px; display: flex; justify-content: space-between; align-items: center; color: #e5e7eb; gap: 12px; }
        .he-input-label span { font-size: 11px; color: #9ca3af; white-space: nowrap; }
        .he-textarea {
          width: 100%; min-height: 96px; margin-top: 4px; border-radius: 14px;
          border: 1px solid rgba(191, 219, 254, 0.6); background: rgba(15, 23, 42, 0.96);
          color: #eef2ff; font-size: 13px; padding: 10px 12px; resize: vertical; outline: none;
        }
        .he-textarea::placeholder { color: #6b7280; }
        .he-textarea:focus { border-color: #38bdf8; box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.7); }
        .he-primary-btn {
          width: 100%; margin-top: 6px; padding: 11px 16px; border-radius: 999px;
          border: none; cursor: pointer; font-size: 13px; font-weight: 600; color: white;
          background: radial-gradient(circle at 0 0, rgba(52, 211, 153, 0.35), transparent 40%),
            linear-gradient(135deg, #22c55e, #6366f1);
          box-shadow: 0 0 0 1px rgba(191, 219, 254, 0.7), 0 26px 48px rgba(37, 99, 235, 0.6);
        }
        .he-primary-btn:hover { filter: brightness(1.07); }
        .he-primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .he-tool-helper { margin-top: 6px; font-size: 11px; color: #cbd5f5; }
        .he-overview-card {
          border-radius: 22px; padding: 22px 22px 20px;
          background: radial-gradient(circle at 0 0, rgba(56, 189, 248, 0.55), rgba(15, 23, 42, 0.98));
          box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.6), 0 28px 70px rgba(0, 0, 0, 0.75);
          font-size: 12px;
        }
        .he-overview-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em; color: #bfdbfe; margin-bottom: 4px; }
        .he-overview-section-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
        .he-overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
        .he-overview-col-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.13em; color: #c7d2fe; margin-bottom: 4px; }
        .he-overview-col-body { font-size: 12px; color: #e5e7eb; line-height: 1.55; }
        .he-overview-list { padding-left: 16px; margin: 6px 0 10px; }
        .he-overview-list li { margin-bottom: 5px; }
        .he-results { margin-top: 18px; display: ${hasResults ? "block" : "none"}; }
        .he-results-card {
          border-radius: 18px; padding: 16px 16px 14px; background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(148, 163, 184, 0.6); box-shadow: 0 18px 40px rgba(15, 23, 42, 0.9);
          font-size: 12px; margin-top: 14px;
        }
        .he-results-heading { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
        .he-results-score { font-size: 22px; font-weight: 650; margin-bottom: 4px; }
        .he-results-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
        .he-results-col { border-radius: 12px; padding: 10px 11px 9px; background: rgba(15, 23, 42, 0.96); }
        .he-results-col-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px; }
        .he-results-col-title--good { color: #bbf7d0; }
        .he-results-col-title--mid { color: #fde68a; }
        .he-results-col-title--bad { color: #fecaca; }
        .he-results-list { list-style: disc; padding-left: 16px; margin: 0; }
        .he-results-list li { margin-bottom: 4px; font-size: 12px; }
        .he-learning-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
        .he-learning-item { border-radius: 12px; padding: 10px 11px 9px; background: rgba(15, 23, 42, 0.96); border: 1px solid rgba(148, 163, 184, 0.4); }
        .he-learning-skill { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
        .he-learning-actions { list-style: disc; padding-left: 16px; margin: 0; font-size: 12px; }
        @media (max-width: 991px) { .he-tool-layout { grid-template-columns: 1fr; } }
        @media (max-width: 767px) {
          .he-tool-title { font-size: 24px; }
          .he-overview-grid { grid-template-columns: 1fr; }
          .he-results-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <section className="he-tool-wrap">
        <div className="he-tool-inner">
          <div className="he-tool-back">
            <a href="/9-ai-engines">← Back to 9 AI Micro Engines</a>
          </div>

          <div className="he-tool-chip">
            <span />
            AI MICRO ENGINE • SKILLS MATCH &amp; GAP
          </div>

          {checkingAuth ? (
            <div className="he-login-pill he-login-pill--out">Checking your account…</div>
          ) : isLoggedIn ? (
            <div className="he-login-pill he-login-pill--in">
              <span className="he-login-pill-label">Signed in</span>
              {userEmail && <span className="he-login-pill-email">{userEmail}</span>}
            </div>
          ) : (
            <div className="he-login-pill he-login-pill--out" onClick={redirectToLogin}>
              <span className="he-login-pill-label">Not signed in</span>
              <span>Click here to log in or create an account.</span>
            </div>
          )}

          <div className="he-tool-title">Skills Match &amp; Gap Engine</div>
          <div className="he-tool-subtitle">
            Compare your skills and experience against a target role to understand strengths, gaps, and what to improve before applying.
          </div>

          <ul className="he-tool-bullets">
            <li><span>📊</span><span>Get a clear match score vs your target role.</span></li>
            <li><span>🧩</span><span>See strengths, weak areas, and missing skills instantly.</span></li>
            <li><span>🪜</span><span>Auto-generate an action plan for the next 3–12 months.</span></li>
          </ul>

          <div className="he-tool-tags-row">
            <div className="he-tag-pill">Single run from £1.49</div>
            <div className="he-tag-pill he-tag-pill--accent">Included in Career Pro &amp; Career Elite</div>
            {isLoggedIn && isUnlimited && <div className="he-tag-pill he-tag-pill--accent">Pro/Elite active — unlimited</div>}
            {isLoggedIn && !isUnlimited && <div className="he-tag-pill">Credits left: {creditsRemaining}</div>}
          </div>

          <div className="he-tool-layout">
            <div>
              <div className="he-tool-card">
                <div className="he-tool-card-title">Paste your inputs</div>

                <div className="he-input-group">
                  <label className="he-input-label" htmlFor="target-role">
                    Target role &amp; level
                    <span>e.g., Export Sales Manager — UK &amp; Europe</span>
                  </label>
                  <textarea
                    id="target-role"
                    className="he-textarea"
                    placeholder="Describe the role you’re aiming for..."
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                  />
                </div>

                <div className="he-input-group">
                  <label className="he-input-label" htmlFor="cv-snapshot">
                    Your CV / skills snapshot
                    <span>Paste from CV or LinkedIn</span>
                  </label>
                  <textarea
                    id="cv-snapshot"
                    className="he-textarea"
                    placeholder="Experience, skills, tools, certifications..."
                    value={cvSnapshot}
                    onChange={(e) => setCvSnapshot(e.target.value)}
                  />
                </div>

                <div className="he-input-group">
                  <label className="he-input-label" htmlFor="jd">
                    Job description (optional)
                    <span>Paste the full job ad if available</span>
                  </label>
                  <textarea
                    id="jd"
                    className="he-textarea"
                    placeholder="Paste full job description..."
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                  />
                </div>

                <button
                  type="button"
                  className="he-primary-btn"
                  onClick={handleRunClick}
                  disabled={loading || paying || checkingAuth}
                >
                  {buttonLabel}
                </button>

                <div className="he-tool-helper">
                  {!isLoggedIn
                    ? "Please log in to continue."
                    : isUnlimited
                    ? "Pro/Elite active — unlimited runs."
                    : hasAccess
                    ? "Credit available — click run to generate your report."
                    : "Secure payment via Stripe • Auto-run after checkout"}
                </div>
              </div>

              {/* RESULTS */}
              <div className="he-results">
                <div className="he-results-card">
                  <div className="he-results-heading">Overall Fit</div>
                  <div className="he-results-score">
                    {overallFit !== null ? `${overallFit}% skills match` : "Skills match unavailable"}
                  </div>
                  <div>{gapSummary}</div>
                </div>

                <div className="he-results-grid">
                  <div className="he-results-col">
                    <div className="he-results-col-title he-results-col-title--good">Matched Skills</div>
                    <ul className="he-results-list">
                      {(matchedSkills || []).length ? matchedSkills.map((s, i) => <li key={i}>{s}</li>) : <li>None</li>}
                    </ul>
                  </div>

                  <div className="he-results-col">
                    <div className="he-results-col-title he-results-col-title--mid">Partially Matched</div>
                    <ul className="he-results-list">
                      {(partialSkills || []).length ? partialSkills.map((s, i) => <li key={i}>{s}</li>) : <li>None</li>}
                    </ul>
                  </div>

                  <div className="he-results-col">
                    <div className="he-results-col-title he-results-col-title--bad">Missing Skills</div>
                    <ul className="he-results-list">
                      {(missingSkills || []).length ? missingSkills.map((s, i) => <li key={i}>{s}</li>) : <li>None</li>}
                    </ul>
                  </div>
                </div>

                <div className="he-results-card">
                  <div className="he-results-heading">Learning Plan to Close Gaps</div>
                  <div className="he-learning-list">
                    {(learningPlan || []).length ? (
                      learningPlan.map((entry, idx) => (
                        <div key={idx} className="he-learning-item">
                          <div className="he-learning-skill">{entry.skill || "Skill focus"}</div>
                          <ul className="he-learning-actions">
                            {(entry.actions || []).map((act, j) => <li key={j}>{act}</li>)}
                          </ul>
                        </div>
                      ))
                    ) : (
                      <div>No specific learning actions generated for this run.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <aside className="he-overview-card">
              <div className="he-overview-title">Engine Overview</div>
              <div className="he-overview-section-title">What this engine does</div>

              <div className="he-overview-grid">
                <div>
                  <div className="he-overview-col-title">Best for</div>
                  <div className="he-overview-col-body">
                    Checking how well you match a target role.<br />
                    Planning next skills to learn.<br />
                    Understanding short-term vs long-term fit.
                  </div>
                </div>

                <div>
                  <div className="he-overview-col-title">Inputs</div>
                  <div className="he-overview-col-body">
                    Target role &amp; level<br />
                    CV / skills snapshot<br />
                    Job description (optional)
                  </div>
                </div>
              </div>

              <div className="he-overview-section-title">You’ll receive</div>
              <ul className="he-overview-list">
                <li>Overall fit % score</li>
                <li>Matched, partial and missing skills lists</li>
                <li>Short gap summary</li>
                <li>Learning plan broken down by skill</li>
              </ul>

              <div className="he-overview-section-title">Used in</div>
              <ul className="he-overview-list">
                <li>Standalone Skills Match engine</li>
                <li>Career Pro</li>
                <li>Career Elite</li>
                <li>AI Builder (Career Pack)</li>
              </ul>
            </aside>
          </div>
        </div>
      </section>
    </>
  );
}
