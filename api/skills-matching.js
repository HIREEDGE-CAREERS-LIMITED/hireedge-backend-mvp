// pages/skills.js
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../contexts/AuthContext";

const HE_API_BASE = "https://hireedge-backend-mvp.vercel.app";
const CHECKOUT_API = "/api/stripe/create-checkout";

export default function SkillsGapPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [targetRole, setTargetRole] = useState("");
  const [cvSnapshot, setCvSnapshot] = useState("");
  const [jobDescription, setJobDescription] = useState("");

  const [hasAccess, setHasAccess] = useState(false);
  const [hasConsumedRun, setHasConsumedRun] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [loading, setLoading] = useState(false);
  const [resultsVisible, setResultsVisible] = useState(false);

  const [overallFit, setOverallFit] = useState(null);
  const [gapSummary, setGapSummary] = useState(
    "Paste a job and CV to see your overall fit summary here."
  );
  const [matchedSkills, setMatchedSkills] = useState([]);
  const [partialSkills, setPartialSkills] = useState([]);
  const [missingSkills, setMissingSkills] = useState([]);
  const [learningPlan, setLearningPlan] = useState([]);

  const isLoggedIn = !!user;
  const userEmail = user?.email || "";

  // ----- draft helpers -----
  function saveDraft() {
    if (typeof window === "undefined") return;
    try {
      const payload = { targetRole, cvSnapshot, jobDescription };
      window.localStorage.setItem("he-skills-draft", JSON.stringify(payload));
    } catch (e) {
      console.warn("Skills draft save failed:", e);
    }
  }

  function restoreDraft() {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("he-skills-draft");
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.targetRole) setTargetRole(d.targetRole);
      if (d.cvSnapshot) setCvSnapshot(d.cvSnapshot);
      if (d.jobDescription) setJobDescription(d.jobDescription);
    } catch (e) {
      console.warn("Skills draft restore failed:", e);
    }
  }

  async function runSkillsEngine(isAuto = false) {
    if (!targetRole.trim() || !cvSnapshot.trim()) {
      if (!isAuto) {
        alert("Please fill Target role & your CV / skills snapshot.");
      }
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${HE_API_BASE}/api/skills-matching`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRole: targetRole.trim(),
          cvText: cvSnapshot.trim(),
          jobDescription: jobDescription.trim(),
        }),
      });

      const data = await res.json();
      console.log("Skills engine result:", data);

      if (!data.ok) {
        alert(data.error || "Something went wrong. Please try again.");
        return;
      }

      setResultsVisible(true);
      const fit = data.overallFit ?? null;
      setOverallFit(fit);
      setGapSummary(
        data.gapSummary ||
          "The engine has analysed your skills vs the target role and highlighted matched, partial and missing skills below."
      );
      setMatchedSkills(data.matchedSkills || []);
      setPartialSkills(data.partialMatchSkills || []);
      setMissingSkills(data.missingSkills || []);
      setLearningPlan(data.learningPlan || []);

      if (hasAccess) setHasConsumedRun(true);
    } catch (err) {
      console.error("Skills engine network error:", err);
      alert("Network error – please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function goToStripeCheckout() {
    saveDraft();
    setLoading(true);
    try {
      const res = await fetch(CHECKOUT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineId: "skills" }),
      });

      const data = await res.json();
      console.log("Stripe skills session:", data);

      if (!data.ok || !data.url) {
        alert(data.error || "Unable to start payment. Please try again.");
        setLoading(false);
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error("Stripe checkout error (skills):", err);
      alert("Payment could not be started. Please try again.");
      setLoading(false);
    }
  }

  function redirectToLogin() {
    saveDraft();
    const currentUrl =
      typeof window !== "undefined"
        ? window.location.href
        : "/skills-match-gap-engine";
    router.push(`/login?redirect=${encodeURIComponent(currentUrl)}`);
  }

  async function handleRunClick() {
    if (!targetRole.trim() || !cvSnapshot.trim()) {
      alert("Please fill Target role & your CV / skills snapshot.");
      return;
    }

    if (hasAccess && hasConsumedRun) {
      alert(
        "You’ve already used this Skills Gap run. To run again, please purchase another single run."
      );
      return;
    }

    if (!isLoggedIn) {
      redirectToLogin();
      return;
    }

    if (hasAccess) {
      await runSkillsEngine(false);
    } else {
      await goToStripeCheckout();
    }
  }

  // ----- Stripe return + access detection -----
  useEffect(() => {
    if (!router.isReady) return;
    if (authLoading) return;

    try {
      let paidParam = false;
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        paidParam = params.get("paid") === "1";
      }

      if (isLoggedIn && paidParam) {
        setHasAccess(true);
        restoreDraft();

        // Auto run once, then clean URL
        runSkillsEngine(true).then(() => {
          router.replace("/skills", undefined, { shallow: true });
        });
      } else {
        setHasAccess(false);
      }
    } catch (e) {
      console.warn("Skills auth / Stripe init failed:", e);
      setHasAccess(false);
    } finally {
      setCheckingAuth(false);
    }
  }, [router.isReady, authLoading, isLoggedIn]);

  const buttonLabel = loading
    ? "Running…"
    : hasAccess && !hasConsumedRun
    ? "View Skills Gap Report"
    : hasAccess && hasConsumedRun
    ? "Skills run used"
    : "Pay & Run Skills Engine (£1.49)";

  // ----- shared styles -----
  return (
    <>
      <style jsx global>{`
        body {
          background: #020617;
        }
        .he-tool-wrap {
          width: 100%;
          min-height: calc(100vh - 200px);
          padding: 110px 0 120px;
          background: radial-gradient(
              circle at top left,
              rgba(56, 189, 248, 0.28),
              transparent 55%
            ),
            radial-gradient(
              circle at bottom right,
              rgba(129, 140, 248, 0.32),
              transparent 55%
            ),
            #020617;
          display: flex;
          justify-content: center;
          box-sizing: border-box;
          font-family: system-ui, -apple-system, BlinkMacSystemFont,
            "SF Pro Text", "Segoe UI", sans-serif;
          color: #e5e7eb;
        }
        .he-tool-inner {
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
          padding: 0 24px;
        }
        .he-tool-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          padding: 5px 12px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          background: rgba(15, 23, 42, 0.94);
          color: #9ca3af;
          margin-bottom: 10px;
        }
        .he-tool-chip span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.35);
        }
        .he-tool-title {
          font-size: 30px;
          font-weight: 650;
          line-height: 1.2;
          margin-bottom: 10px;
          letter-spacing: -0.03em;
        }
        .he-tool-subtitle {
          font-size: 14px;
          line-height: 1.7;
          max-width: 560px;
          color: #9ca3af;
          margin-bottom: 18px;
        }
        .he-tool-bullets {
          list-style: none;
          padding: 0;
          margin: 0 0 18px;
          font-size: 13px;
          color: #cbd5e1;
        }
        .he-tool-bullets li {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }
        .he-tool-bullets li span:first-child {
          font-size: 15px;
        }
        .he-tool-tags-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 26px;
        }
        .he-tag-pill {
          padding: 5px 12px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          font-size: 11px;
          background: rgba(15, 23, 42, 0.95);
          color: #e5e7eb;
        }
        .he-tag-pill--accent {
          background: radial-gradient(
              circle at 0 0,
              rgba(52, 211, 153, 0.25),
              rgba(15, 23, 42, 0.95)
            );
          border-color: #22c55e;
          color: #bbf7d0;
        }
        .he-tool-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
          gap: 32px;
        }
        .he-tool-card {
          border-radius: 22px;
          padding: 22px 22px 20px;
          background: radial-gradient(
              circle at 0 0,
              rgba(59, 130, 246, 0.55),
              rgba(30, 58, 138, 0.95)
            );
          box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.55),
            0 28px 70px rgba(0, 0, 0, 0.75);
        }
        .he-tool-card-title {
          font-size: 13px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #c7d2fe;
          margin-bottom: 6px;
        }
        .he-tool-card-note {
          font-size: 11px;
          color: #a5b4fc;
          margin-bottom: 12px;
        }
        .he-input-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 12px;
        }
        .he-input-label {
          font-size: 12px;
          display: flex;
          justify-content: space-between;
          color: #e5e7eb;
        }
        .he-input-label span {
          font-size: 11px;
          color: #9ca3af;
        }
        .he-textarea {
          width: 100%;
          min-height: 92px;
          border-radius: 12px;
          border: 1px solid rgba(191, 219, 254, 0.6);
          background: rgba(15, 23, 42, 0.96);
          color: #eef2ff;
          font-size: 13px;
          padding: 9px 10px;
          resize: vertical;
        }
        .he-textarea:focus {
          border-color: #38bdf8;
          box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.7);
        }
        .he-primary-btn {
          width: 100%;
          padding: 11px 16px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: white;
          background: radial-gradient(
              circle at 0 0,
              rgba(52, 211, 153, 0.35),
              transparent 40%
            ),
            linear-gradient(135deg, #22c55e, #6366f1);
          box-shadow: 0 0 0 1px rgba(191, 219, 254, 0.7),
            0 26px 48px rgba(37, 99, 235, 0.6);
        }
        .he-primary-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .he-tool-helper {
          margin-top: 6px;
          font-size: 11px;
          color: #cbd5f5;
        }
        .he-overview-card {
          border-radius: 22px;
          padding: 22px 22px 20px;
          background: radial-gradient(
              circle at 0 0,
              rgba(56, 189, 248, 0.55),
              rgba(15, 23, 42, 0.98)
            );
          box-shadow: 0 0 0 1px rgba(129, 140, 248, 0.6),
            0 28px 70px rgba(0, 0, 0, 0.75);
          font-size: 12px;
        }
        .he-overview-title {
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: #bfdbfe;
          margin-bottom: 4px;
        }
        .he-overview-section-title {
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .he-overview-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 18px;
        }
        .he-overview-col-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.13em;
          color: #c7d2fe;
          margin-bottom: 4px;
        }
        .he-overview-col-body {
          font-size: 12px;
          color: #e5e7eb;
          line-height: 1.55;
        }
        .he-overview-list {
          padding-left: 16px;
          margin: 6px 0 10px;
        }
        .he-overview-list li {
          margin-bottom: 5px;
        }
        .he-results {
          margin-top: 18px;
        }
        .he-results-card {
          border-radius: 18px;
          padding: 16px 16px 14px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(148, 163, 184, 0.6);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.9);
          font-size: 12px;
        }
        .he-results-heading {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .he-results-score {
          font-size: 22px;
          font-weight: 650;
          margin-bottom: 4px;
        }
        .he-results-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }
        .he-results-col {
          border-radius: 12px;
          padding: 10px 11px 9px;
          background: rgba(15, 23, 42, 0.96);
        }
        .he-results-col-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 6px;
        }
        .he-results-col-title--good {
          color: #bbf7d0;
        }
        .he-results-col-title--mid {
          color: #fde68a;
        }
        .he-results-col-title--bad {
          color: #fecaca;
        }
        .he-results-list {
          list-style: disc;
          padding-left: 16px;
          margin: 0;
        }
        .he-results-list li {
          margin-bottom: 4px;
          font-size: 12px;
        }
        .he-learning-list {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .he-learning-item {
          border-radius: 12px;
          padding: 10px 11px 9px;
          background: rgba(15, 23, 42, 0.96);
          border: 1px solid rgba(148, 163, 184, 0.4);
        }
        .he-learning-skill {
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .he-learning-actions {
          list-style: disc;
          padding-left: 16px;
          margin: 0;
          font-size: 12px;
        }
        .he-login-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          margin-bottom: 12px;
        }
        .he-login-pill--logged-in {
          background: rgba(22, 163, 74, 0.15);
          border: 1px solid rgba(22, 163, 74, 0.7);
          color: #bbf7d0;
        }
        .he-login-pill--logged-out {
          background: rgba(30, 64, 175, 0.25);
          border: 1px solid rgba(59, 130, 246, 0.7);
          color: #bfdbfe;
          cursor: pointer;
        }
        .he-login-pill-email {
          color: #e5e7eb;
        }
        @media (max-width: 991px) {
          .he-tool-layout {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 767px) {
          .he-tool-title {
            font-size: 24px;
          }
          .he-overview-grid {
            grid-template-columns: 1fr;
          }
          .he-results-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <section className="he-tool-wrap">
        <div className="he-tool-inner">
          <div className="he-tool-chip">
            <span /> AI MICRO ENGINE • SKILLS MATCH &amp; GAP
          </div>

          {/* login pill */}
          {checkingAuth ? (
            <div className="he-login-pill he-login-pill--logged-out">
              Checking your account…
            </div>
          ) : isLoggedIn ? (
            <div className="he-login-pill he-login-pill--logged-in">
              <span>Signed in</span>
              {userEmail && (
                <span className="he-login-pill-email">{userEmail}</span>
              )}
            </div>
          ) : (
            <div
              className="he-login-pill he-login-pill--logged-out"
              onClick={redirectToLogin}
            >
              <span>Not signed in</span>
              <span>Click to log in or create an account.</span>
            </div>
          )}

          <div className="he-tool-title">Skills Match &amp; Gap Engine</div>
          <div className="he-tool-subtitle">
            Compare your skills and experience against a target role to
            understand strengths, gaps, and what to improve before applying.
          </div>

          <ul className="he-tool-bullets">
            <li>
              <span>📊</span>
              <span>Get a clear match score vs your target role.</span>
            </li>
            <li>
              <span>🧩</span>
              <span>See strengths, weak areas, and missing skills instantly.</span>
            </li>
            <li>
              <span>🪜</span>
              <span>
                Auto-generate an action plan for the next 3–12 months.
              </span>
            </li>
          </ul>

          <div className="he-tool-tags-row">
            <div className="he-tag-pill">Single run from £1.49</div>
            <div className="he-tag-pill he-tag-pill--accent">
              Included in Career Pro &amp; Career Elite
            </div>
            <div className="he-tag-pill">Part of the AI Builder Career Pack</div>
          </div>

          <div className="he-tool-layout">
            {/* LEFT */}
            <div>
              <div className="he-tool-card">
                <div className="he-tool-card-title">Paste your inputs</div>
                <div className="he-tool-card-note">
                  Connects to the Skills Match &amp; Gap API.
                </div>

                <div className="he-input-group">
                  <label className="he-input-label">
                    Target role &amp; level
                    <span>e.g., Export Sales Manager — UK &amp; Europe</span>
                  </label>
                  <textarea
                    className="he-textarea"
                    placeholder="Describe the role you’re aiming for..."
                    value={targetRole}
                    onChange={(e) => setTargetRole(e.target.value)}
                  />
                </div>

                <div className="he-input-group">
                  <label className="he-input-label">
                    Your CV / skills snapshot
                    <span>Paste from CV or LinkedIn</span>
                  </label>
                  <textarea
                    className="he-textarea"
                    placeholder="Experience, skills, tools, certifications..."
                    value={cvSnapshot}
                    onChange={(e) => setCvSnapshot(e.target.value)}
                  />
                </div>

                <div className="he-input-group">
                  <label className="he-input-label">
                    Job description (optional)
                    <span>Paste the full job ad if available</span>
                  </label>
                  <textarea
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
                  disabled={loading || checkingAuth}
                >
                  {buttonLabel}
                </button>

                <div className="he-tool-helper">
                  {hasAccess && !hasConsumedRun
                    ? "Payment confirmed. Paste your details and run your Skills Match & Gap report."
                    : hasAccess && hasConsumedRun
                    ? "You’ve used this Skills run. To run again, please purchase another single run."
                    : "Paste your target role + CV snapshot. We’ll guide you to log in and pay securely before running the engine."}
                </div>
              </div>

              {resultsVisible && (
                <div className="he-results">
                  <div className="he-results-card" style={{ marginTop: 14 }}>
                    <div className="he-results-heading">Overall Fit</div>
                    <div className="he-results-score">
                      {overallFit !== null
                        ? `${overallFit}% skills match`
                        : "Skills match unavailable"}
                    </div>
                    <div>{gapSummary}</div>
                  </div>

                  <div className="he-results-grid" style={{ marginTop: 10 }}>
                    <div className="he-results-col">
                      <div className="he-results-col-title he-results-col-title--good">
                        Matched Skills
                      </div>
                      <ul className="he-results-list">
                        {(matchedSkills || []).length ? (
                          matchedSkills.map((s, i) => <li key={i}>{s}</li>)
                        ) : (
                          <li>None detected yet.</li>
                        )}
                      </ul>
                    </div>
                    <div className="he-results-col">
                      <div className="he-results-col-title he-results-col-title--mid">
                        Partially Matched
                      </div>
                      <ul className="he-results-list">
                        {(partialSkills || []).length ? (
                          partialSkills.map((s, i) => <li key={i}>{s}</li>)
                        ) : (
                          <li>No partial matches yet.</li>
                        )}
                      </ul>
                    </div>
                    <div className="he-results-col">
                      <div className="he-results-col-title he-results-col-title--bad">
                        Missing Skills
                      </div>
                      <ul className="he-results-list">
                        {(missingSkills || []).length ? (
                          missingSkills.map((s, i) => <li key={i}>{s}</li>)
                        ) : (
                          <li>No clear gaps identified.</li>
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="he-results-card" style={{ marginTop: 10 }}>
                    <div className="he-results-heading">
                      Learning Plan to Close Gaps
                    </div>
                    <div className="he-learning-list">
                      {(learningPlan || []).length ? (
                        learningPlan.map((entry, i) => (
                          <div key={i} className="he-learning-item">
                            <div className="he-learning-skill">
                              {entry.skill || "Skill focus"}
                            </div>
                            <ul className="he-learning-actions">
                              {(entry.actions || []).map((a, j) => (
                                <li key={j}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        ))
                      ) : (
                        <div>
                          No specific learning actions generated for this run.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT overview */}
            <aside className="he-overview-card">
              <div className="he-overview-title">Engine Overview</div>
              <div className="he-overview-section-title">
                What this engine does
              </div>

              <div className="he-overview-grid">
                <div>
                  <div className="he-overview-col-title">Best for</div>
                  <div className="he-overview-col-body">
                    Checking how well you match a target role.
                    <br />
                    Planning next skills to learn.
                    <br />
                    Understanding short-term vs long-term fit.
                  </div>
                </div>
                <div>
                  <div className="he-overview-col-title">Inputs</div>
                  <div className="he-overview-col-body">
                    Target role &amp; level
                    <br />
                    CV / skills snapshot
                    <br />
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
