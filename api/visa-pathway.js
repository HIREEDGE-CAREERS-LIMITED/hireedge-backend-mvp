// POST /api/visa-pathway
// Body: {
//   currentRole, targetRole, sector,
//   yearsExperience, highestEducation,
//   nationalityRegion, currentVisa,
//   salaryGBP, hasJobOffer, sponsorLicenceKnown,
//   wantsToStayYears
// }

module.exports = async (req, res) => {
  // CORS
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

      const {
        currentRole = "",
        targetRole = "",
        sector = "",
        yearsExperience = 0,
        highestEducation = "",
        nationalityRegion = "",
        currentVisa = "",
        salaryGBP = 0,
        hasJobOffer = false,
        sponsorLicenceKnown = "unknown", // "yes" | "no" | "unknown"
        wantsToStayYears = 3
      } = data;

      const cleanCurrentRole =
        currentRole && currentRole.trim().length > 0
          ? currentRole.trim()
          : "your current role";

      const cleanTargetRole =
        targetRole && targetRole.trim().length > 0
          ? targetRole.trim()
          : "your target role";

      const exp = Number(yearsExperience) || 0;
      const salary = Number(salaryGBP) || 0;
      const stayYears = Number(wantsToStayYears) || 3;

      // --- Simple SOC guess based on words ---
      const roleText =
        (currentRole + " " + targetRole + " " + sector).toLowerCase();

      let socCodeGuess = {
        code: "Unknown",
        label: "General professional / graduate-level role",
        reason:
          "Could not confidently map your role to a specific SOC group, so using a general professional category."
      };

      if (roleText.includes("nurse") || roleText.includes("healthcare assistant")) {
        socCodeGuess = {
          code: "2231–2239",
          label: "Nursing and other healthcare professionals",
          reason:
            "Your role contains healthcare / nursing keywords, so grouped under registered/associate health professionals."
        };
      } else if (
        roleText.includes("care worker") ||
        roleText.includes("carer") ||
        roleText.includes("support worker")
      ) {
        socCodeGuess = {
          code: "6145",
          label: "Care workers and home carers",
          reason:
            "Your role suggests direct care work, which usually falls under care worker SOC codes."
        };
      } else if (roleText.includes("software") || roleText.includes("developer")) {
        socCodeGuess = {
          code: "2136",
          label: "Programmers and software development professionals",
          reason:
            "Your profile mentions software / development, which maps to programmer / software professional SOC codes."
        };
      } else if (
        roleText.includes("data") &&
        (roleText.includes("analyst") || roleText.includes("scientist"))
      ) {
        socCodeGuess = {
          code: "2425 / 2135",
          label: "Data analysts / data scientists",
          reason:
            "Your role mentions data analysis / data science, which aligns with data professional SOC groups."
        };
      } else if (
        roleText.includes("sales manager") ||
        (roleText.includes("sales") && roleText.includes("manager"))
      ) {
        socCodeGuess = {
          code: "1132",
          label: "Marketing and sales directors / managers",
          reason:
            "Your role references sales management, which usually maps to marketing and sales management SOC codes."
        };
      } else if (roleText.includes("sales")) {
        socCodeGuess = {
          code: "7121 / 7122",
          label: "Sales / retail supervisors or salespersons",
          reason:
            "Your role includes sales in a general or retail sense, mapped to sales / retail supervisory codes."
        };
      } else if (
        roleText.includes("project manager") ||
        roleText.includes("project management")
      ) {
        socCodeGuess = {
          code: "2424",
          label: "Business and financial project management professionals",
          reason:
            "Project management roles often fall into business project management SOC groups."
        };
      }

      // --- Salary assessment (very rough, not legal advice) ---
      let salaryAssessment = {
        meetsTypical: false,
        comment:
          "No salary information provided, so cannot assess against typical Skilled Worker thresholds."
      };

      if (salary > 0) {
        if (salary >= 38000) {
          salaryAssessment = {
            meetsTypical: true,
            comment:
              "Your stated salary is around or above many general Skilled Worker thresholds for experienced workers (exact rules depend on SOC code and time)."
          };
        } else if (salary >= 26000) {
          salaryAssessment = {
            meetsTypical: false,
            comment:
              "Your salary is in a middle band. It may work for some discounted routes (new entrants, shortage roles, health/care), but it is below many standard thresholds."
          };
        } else {
          salaryAssessment = {
            meetsTypical: false,
            comment:
              "Your salary appears below most standard thresholds. Sponsorship is still possible in some limited cases, but employers may find it harder to sponsor at this level."
          };
        }
      }

      // --- Determine possible visa routes (high level) ---
      const suggestedRoutes = [];

      const isHealthOrCare =
        roleText.includes("nurse") ||
        roleText.includes("care") ||
        roleText.includes("nhs") ||
        sector.toLowerCase().includes("health");

      const isTech =
        roleText.includes("software") ||
        roleText.includes("developer") ||
        roleText.includes("engineer") ||
        roleText.includes("data") ||
        sector.toLowerCase().includes("tech") ||
        sector.toLowerCase().includes("it");

      const hasDegree =
        highestEducation.toLowerCase().includes("bachelor") ||
        highestEducation.toLowerCase().includes("master") ||
        highestEducation.toLowerCase().includes("degree");

      // Skilled Worker (general)
      let skilledWorkerSuitability = "medium";
      let skilledWorkerReason = [];

      if (!hasJobOffer) {
        skilledWorkerReason.push(
          "You do not yet have a UK job offer, which is mandatory for Skilled Worker."
        );
      } else {
        skilledWorkerReason.push(
          "You have a job offer, which is a key requirement for Skilled Worker."
        );
      }

      if (salaryAssessment.meetsTypical) {
        skilledWorkerReason.push(
          "Your salary looks in range for many Skilled Worker roles (depending on SOC and exact rules)."
        );
      } else {
        skilledWorkerReason.push(
          salaryAssessment.comment
        );
      }

      if (sponsorLicenceKnown === "yes") {
        skilledWorkerReason.push(
          "Your employer is (or you believe they are) on the sponsor licence list, which is essential."
        );
      } else if (sponsorLicenceKnown === "no") {
        skilledWorkerSuitability = "low";
        skilledWorkerReason.push(
          "The employer does not hold a sponsor licence currently, making this route less realistic unless they apply."
        );
      } else {
        skilledWorkerReason.push(
          "You are not sure if the employer has a sponsor licence – this needs to be checked."
        );
      }

      if (exp < 1) {
        skilledWorkerReason.push(
          "With under 1 year of experience you may be assessed as a more junior / new entrant profile."
        );
      } else {
        skilledWorkerReason.push(
          `With around ${exp} years of experience, you fit a ${exp >= 3 ? "mid" : "early"}-career profile.`
        );
      }

      suggestedRoutes.push({
        route: isHealthOrCare ? "Skilled Worker (Health & Care)" : "Skilled Worker",
        suitability: isHealthOrCare ? "high" : skilledWorkerSuitability,
        reason:
          (isHealthOrCare
            ? "Your profile looks connected to the health/care sector, which has specific Skilled Worker provisions. "
            : "") + skilledWorkerReason.join(" "),
        keySteps: [
          "Confirm your target role maps to an eligible SOC occupation.",
          "Confirm the employer holds (or can obtain) a sponsor licence.",
          "Check that the salary in the offer is at or above the going rate / general threshold.",
          "Prepare documents: passport, degree (if relevant), English language evidence, TB test if needed.",
          "Discuss Certificate of Sponsorship (CoS) with employer once they are ready to sponsor."
        ],
        riskLevel: sponsorLicenceKnown === "no" ? "higher" : "normal"
      });

      // Graduate / Student extension (if currently in UK study routes)
      if (
        currentVisa.toLowerCase().includes("student") ||
        currentVisa.toLowerCase().includes("graduate")
      ) {
        suggestedRoutes.push({
          route: currentVisa.toLowerCase().includes("graduate")
            ? "UK Graduate Route (time-limited)"
            : "Switch from Student to Skilled Worker / Graduate",
          suitability: "context-dependent",
          reason:
            "You are on a UK study-related visa, so you may be able to use remaining time on Graduate Route or switch into Skilled Worker from inside the UK, depending on your course and provider.",
          keySteps: [
            "Check your BRP / digital status for visa type and expiry.",
            "Confirm if your course and institution allowed you to access the Graduate Route.",
            "Plan whether to first use Graduate Route or switch directly to Skilled Worker (if you have an offer).",
            "Work out a timeline so there is no gap between visa expiry and new route."
          ],
          riskLevel: "depends-on-timeline"
        });
      }

      // Innovator / Start-up-style routes (business)
      if (sector.toLowerCase().includes("startup") || sector.toLowerCase().includes("founder")) {
        suggestedRoutes.push({
          route: "Innovator Founder-style business route",
          suitability: "specialist",
          reason:
            "Your profile mentions founding / startups. Business routes are possible if you have a genuinely innovative, viable and scalable business idea with endorsement.",
          keySteps: [
            "Clarify your business model and how it is innovative compared with the market.",
            "Prepare a lean but detailed business plan (market, product, traction, financials).",
            "Research UK endorsing bodies that match your sector.",
            "Plan funding, timelines and how you will support yourself while building the venture."
          ],
          riskLevel: "high - endorsement required"
        });
      }

      // Global Talent angle (very rough hint)
      if (isTech && exp >= 5) {
        suggestedRoutes.push({
          route: "Global Talent (digital / tech) – long-term option",
          suitability: "long-term / stretch",
          reason:
            "You have a strong tech-style profile with several years of experience. In future, you might explore Global Talent-type routes if you can demonstrate significant achievements and recognition.",
          keySteps: [
            "Build a strong portfolio: open source, leadership roles, notable projects.",
            "Collect evidence: recommendations, media mention, conference talks.",
            "Review UK guidance for Global Talent criteria with an immigration professional."
          ],
          riskLevel: "high - evidence heavy"
        });
      }

      // Red flags
      const redFlags = [];

      if (!hasJobOffer && stayYears > 2) {
        redFlags.push(
          "You want a multi-year stay but do not yet have a UK job offer – most work routes require an offer or endorsement."
        );
      }

      if (salary > 0 && salary < 22000) {
        redFlags.push(
          "Salary appears low compared with many sponsored roles, which may limit Skilled Worker options unless for specific shortage or part-time scenarios."
        );
      }

      if (!hasDegree && !isHealthOrCare && exp < 3) {
        redFlags.push(
          "Limited experience and no degree may make sponsorship harder outside health/care or shortage roles."
        );
      }

      if (!currentVisa && nationalityRegion.toLowerCase().includes("non-uk") && !hasJobOffer) {
        redFlags.push(
          "Outside the UK with no job offer yet – most work routes require securing an offer before applying."
        );
      }

      const summary = {
        headline: `High-level sponsorship pathway for ${cleanTargetRole}`,
        note:
          "This is a planning tool only and not legal advice. Immigration rules change frequently – always cross-check with official UK guidance or a qualified immigration adviser."
      };

      return res.status(200).json({
        ok: true,
        summary,
        socCodeGuess,
        salaryAssessment,
        suggestedRoutes,
        redFlags
      });
    });
  } catch (err) {
    console.error("visa-pathway error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
