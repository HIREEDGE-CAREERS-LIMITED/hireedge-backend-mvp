// POST /api/interview-prep
// Body: { jobDescription, cvText, role?, experienceLevel? }

module.exports = async (req, res) => {
  // ---- CORS HEADERS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      let data = {};
      try {
        data = JSON.parse(body || "{}");
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }

      const { jobDescription, cvText, role = "", experienceLevel = "mid" } =
        data;

      if (!jobDescription || !cvText) {
        return res
          .status(400)
          .json({ error: "jobDescription and cvText are required" });
      }

      const cleanRole =
        role && role.trim().length > 0 ? role.trim() : "this role";

      const expLabel =
        experienceLevel === "junior"
          ? "early-career"
          : experienceLevel === "senior"
          ? "senior-level"
          : "mid-level";

      // Very light keyword extraction from JD
      const jdLower = jobDescription.toLowerCase();
      const mentionsSales = jdLower.includes("sales");
      const mentionsManager = jdLower.includes("manager");
      const mentionsKpi = jdLower.includes("kpi");
      const mentionsCustomer = jdLower.includes("customer");
      const mentionsData = jdLower.includes("data");
      const mentionsTeam = jdLower.includes("team");
      const mentionsStakeholder = jdLower.includes("stakeholder");

      const jdFocus = [
        mentionsSales && "sales performance",
        mentionsKpi && "KPIs & targets",
        mentionsCustomer && "customer experience",
        mentionsData && "data & reporting",
        mentionsTeam && "teamwork / leadership",
        mentionsStakeholder && "stakeholder management"
      ]
        .filter(Boolean)
        .join(", ");

      // Simple CV context
      const cvLower = cvText.toLowerCase();
      const hasLeadership = cvLower.includes("lead") || cvLower.includes("manager");
      const hasTargets =
        cvLower.includes("target") ||
        cvLower.includes("kpi") ||
        cvLower.includes("revenue");
      const hasCustomer =
        cvLower.includes("customer") || cvLower.includes("client");
      const hasProjects = cvLower.includes("project");

      // Helper to build STAR answer template
      const makeStarAnswer = (topic, resultImpact) => {
        return (
          `Situation: I was working as a ${cleanRole} where ${topic} was a key part of my role.\n` +
          `Task: I was responsible for improving or resolving this area.\n` +
          `Action: I analysed the situation, spoke with stakeholders and took practical steps to fix the issue, keeping communication clear and structured.\n` +
          `Result: As a result, ${resultImpact}. I also documented what worked so the team could repeat it.`
        );
      };

      // 5 general questions
      const generalQuestions = [
        {
          type: "general",
          question: `Can you walk me through your background and how it led you to apply for ${cleanRole}?`,
          answer:
            "Give a 2–3 minute summary that links your education, key roles and achievements directly to this role. Finish by explaining why this specific company and position make sense as the next step."
        },
        {
          type: "general",
          question: "What would you say are your top 3 strengths in a work setting?",
          answer:
            "Pick strengths that clearly match the job description (for example: communication, ownership, analytical thinking). For each one, give a very short example: situation + result."
        },
        {
          type: "general",
          question: "Tell me about a time you made a mistake at work and what you learned.",
          answer:
            "Choose a real but low-risk mistake. Explain what happened, accept responsibility, and focus most of the answer on what you changed afterwards so it doesn’t happen again."
        },
        {
          type: "general",
          question: "How do you like to receive feedback and work with your manager?",
          answer:
            "Explain that you appreciate clear, direct feedback and you see it as a chance to improve. Mention that you like regular check-ins, and you share updates proactively so there are no surprises."
        },
        {
          type: "general",
          question: "Why should we hire you for this position?",
          answer:
            `Summarise 3 points: (1) your ${expLabel} experience, (2) 2–3 skills that directly fit the JD, and (3) your motivation and reliability. Finish with a confident line like: “I will treat this role as my long-term path, not just a job.”`
        }
      ];

      // 5 role-specific questions
      const roleQuestions = [];

      roleQuestions.push({
        type: "role-specific",
        question: `In this ${cleanRole} role, what would you focus on in your first 90 days?`,
        answer:
          "Split your answer into: first 30 days (learning, shadowing, understanding systems), next 30 (taking ownership of small tasks / accounts), final 30 (owning clear outcomes and suggesting improvements). Always link back to the JD."
      });

      if (mentionsSales || mentionsKpi) {
        roleQuestions.push({
          type: "role-specific",
          question:
            "How have you managed targets or KPIs in your previous roles?",
          answer:
            "Give a specific example: state the target, what actions you took (prioritising pipeline, follow-ups, relationship building), and the final performance (for example, 110% of target for 3 months)."
        });
      }

      if (mentionsCustomer) {
        roleQuestions.push({
          type: "role-specific",
          question:
            "Tell me about a time you turned around a difficult customer situation.",
          answer: makeStarAnswer(
            "a customer was unhappy or about to leave",
            "the customer decided to stay with us and gave positive feedback"
          )
        });
      }

      if (mentionsTeam || hasLeadership) {
        roleQuestions.push({
          type: "role-specific",
          question:
            "Can you describe a situation where you had to influence or lead others without formal authority?",
          answer: makeStarAnswer(
            "the team was not aligned or was resistant to a change",
            "the team moved forward with the plan and performance improved"
          )
        });
      }

      if (mentionsData || hasProjects) {
        roleQuestions.push({
          type: "role-specific",
          question:
            "Give an example of using data or numbers to make a better decision at work.",
          answer: makeStarAnswer(
            "you used reports, KPIs or basic analysis to understand a problem",
            "you made a decision that improved performance or saved time"
          )
        });
      }

      // Ensure we have 5 role questions (fallbacks)
      while (roleQuestions.length < 5) {
        roleQuestions.push({
          type: "role-specific",
          question: `What does success look like for you in a ${cleanRole} position in the first year?`,
          answer:
            "Talk about meeting or beating targets, building strong relationships, becoming the person your manager can rely on, and actively suggesting improvements instead of just waiting for instructions."
        });
      }

      // 5 behavioural (STAR) questions
      const behaviouralQuestions = [
        {
          type: "behavioural",
          question: "Describe a time when you had to manage several priorities at once.",
          answer: makeStarAnswer(
            "there were multiple deadlines or tasks competing for your time",
            "all key deadlines were met without quality dropping"
          )
        },
        {
          type: "behavioural",
          question: "Tell me about a time you disagreed with a colleague or manager.",
          answer: makeStarAnswer(
            "you had a different view from your colleague / manager",
            "you reached a solution that protected the relationship and delivered a good outcome"
          )
        },
        {
          type: "behavioural",
          question: "Describe a time you showed initiative without being asked.",
          answer: makeStarAnswer(
            "you saw a problem or opportunity that was not clearly owned",
            "your initiative saved time, improved quality or helped the team"
          )
        },
        {
          type: "behavioural",
          question: "Tell me about a time you worked with someone very different from you.",
          answer: makeStarAnswer(
            "you had to adapt your communication style to work well with them",
            "you built a productive working relationship and delivered the result together"
          )
        },
        {
          type: "behavioural",
          question: "Describe a situation where you had to learn something quickly.",
          answer: makeStarAnswer(
            "you needed to learn a new system, process or product in a short time",
            "you became confident enough to work independently and help others"
          )
        }
      ];

      const summary =
        jdFocus.length > 0
          ? `This interview pack is tuned to a role that emphasises: ${jdFocus}.`
          : "This interview pack is tuned to your role and overall experience.";

      const weakAreas = [];
      if (mentionsLeadership && !hasLeadership) {
        weakAreas.push(
          "JD mentions leadership but your CV does not clearly show team leadership examples."
        );
      }
      if (mentionsKpi && !hasTargets) {
        weakAreas.push(
          "JD mentions KPIs/targets but your CV could show more numbers and outcomes."
        );
      }
      if (mentionsCustomer && !hasCustomer) {
        weakAreas.push(
          "JD is customer-focused but your CV does not highlight enough client or customer-facing work."
        );
      }

      return res.status(200).json({
        ok: true,
        role: cleanRole,
        experienceLevel,
        summary,
        generalQuestions,
        roleQuestions,
        behaviouralQuestions,
        weakAreas
      });
    });
  } catch (err) {
    console.error("interview-prep error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
