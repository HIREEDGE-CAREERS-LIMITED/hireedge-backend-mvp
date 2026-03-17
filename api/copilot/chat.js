// ============================================================================
// pages/api/copilot/chat.js
// HireEdge Frontend — Copilot chat API route
//
// This is the endpoint that copilotService.js calls via POST /api/copilot/chat.
//
// In production, this should proxy to the real HireEdge backend.
// For now, it returns a working response so the chat UI functions.
//
// Request body: { message: string, context: object }
// Response: { ok: true, data: { reply, intent, recommendations, next_actions, context } }
// ============================================================================

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, context } = req.body || {};
  const userMessage = (message || "").trim().toLowerCase();

  // ── Simple intent detection ────────────────────────────────────────────

  let intent = { name: "general_query", confidence: 0.7 };
  let reply = "";
  let recommendations = [];
  let next_actions = [];

  if (userMessage.includes("salary") || userMessage.includes("pay") || userMessage.includes("earn")) {
    intent = { name: "salary_inquiry", confidence: 0.9 };
    reply = `Salary data is available through our Salary Insights tool. You can search for any role to see UK salary ranges, benchmarks against category averages, and progression paths to higher-paying positions. Would you like to explore salary data for a specific role?`;
    next_actions = [
      { type: "link", label: "Open Salary Insights", prompt: null, endpoint: "/intelligence/salary" },
      { type: "question", label: "Compare two roles", prompt: "Compare salaries for data analyst and data engineer" },
    ];
  } else if (userMessage.includes("skill") || userMessage.includes("gap") || userMessage.includes("learn")) {
    intent = { name: "skills_gap", confidence: 0.85 };
    reply = `I can help you identify skills gaps. Our Skills Gap tool compares your current skills against any target role's requirements, showing what you already have and what you need to learn — with a prioritised learning path. Want to run a skills gap analysis?`;
    next_actions = [
      { type: "tool", label: "Run Skills Gap Analysis", prompt: "Analyse my skills gap", endpoint: "/intelligence/skills-gap" },
      { type: "question", label: "What skills are trending?", prompt: "What are the most in-demand skills right now?" },
    ];
  } else if (userMessage.includes("interview") || userMessage.includes("prepare") || userMessage.includes("question")) {
    intent = { name: "interview_prep", confidence: 0.88 };
    reply = `Our Interview Prep tool generates competency, technical, and behavioural questions tailored to your target role. It also provides STAR framework preparation, salary negotiation intel, and weakness strategies. Ready to prep for a specific role?`;
    next_actions = [
      { type: "tool", label: "Start Interview Prep", prompt: null, endpoint: "/tools/interview" },
      { type: "question", label: "Common interview mistakes", prompt: "What are the most common interview mistakes?" },
    ];
  } else if (userMessage.includes("resume") || userMessage.includes("cv")) {
    intent = { name: "resume_optimisation", confidence: 0.9 };
    reply = `The Resume Optimiser generates an ATS-optimised blueprint for your target role. It analyses keyword coverage, identifies critical missing terms, and provides section-by-section guidance including bullet templates. Want to optimise your resume for a specific role?`;
    next_actions = [
      { type: "tool", label: "Optimise Resume", prompt: null, endpoint: "/tools/resume" },
    ];
  } else if (userMessage.includes("linkedin") || userMessage.includes("profile")) {
    intent = { name: "linkedin_optimisation", confidence: 0.87 };
    reply = `Our LinkedIn Optimiser scores your profile strength and provides headline variants, about section blueprints, skills strategy, and keyword recommendations. Would you like to optimise your LinkedIn for a specific role?`;
    next_actions = [
      { type: "tool", label: "Optimise LinkedIn", prompt: null, endpoint: "/tools/linkedin" },
    ];
  } else if (userMessage.includes("visa") || userMessage.includes("sponsor") || userMessage.includes("immigra")) {
    intent = { name: "visa_assessment", confidence: 0.85 };
    reply = `The Visa Eligibility tool assesses your options across UK visa routes — Skilled Worker, Global Talent, Graduate, and High Potential Individual. It checks salary thresholds, SOC codes, and eligibility requirements. Want to check visa eligibility for a role?`;
    next_actions = [
      { type: "tool", label: "Check Visa Eligibility", prompt: null, endpoint: "/tools/visa" },
    ];
  } else if (userMessage.includes("roadmap") || userMessage.includes("path") || userMessage.includes("become") || userMessage.includes("how do i")) {
    intent = { name: "career_path", confidence: 0.85 };
    reply = `I can map out a step-by-step career path for you. Our Career Roadmap tool finds the shortest route between any two roles, showing estimated time, salary growth, difficulty, and skills needed at each step. What role are you targeting?`;
    next_actions = [
      { type: "tool", label: "Build Career Roadmap", prompt: null, endpoint: "/tools/roadmap" },
      { type: "question", label: "What roles can I reach?", prompt: "What career options do I have from my current role?" },
    ];
  } else if (userMessage.includes("compare") || userMessage.includes("vs") || userMessage.includes("versus") || userMessage.includes("difference")) {
    intent = { name: "role_comparison", confidence: 0.8 };
    reply = `I can compare roles across salary, skills, seniority, and career paths. Use the Role Explorer to view detailed profiles, or ask me to compare specific roles. Which roles would you like to compare?`;
    next_actions = [
      { type: "link", label: "Open Role Explorer", prompt: null, endpoint: "/intelligence" },
      { type: "question", label: "Compare two roles", prompt: "Compare data analyst and data engineer" },
    ];
  } else if (userMessage.includes("career pack") || userMessage.includes("full report") || userMessage.includes("everything")) {
    intent = { name: "career_pack", confidence: 0.82 };
    reply = `The Career Pack is a comprehensive report that combines all seven intelligence engines in one go: roadmap, skills gap, resume blueprint, LinkedIn optimisation, interview prep, salary insight, and visa assessment. Want to build one?`;
    next_actions = [
      { type: "link", label: "Build Career Pack", prompt: null, endpoint: "/career-pack" },
    ];
  } else if (userMessage.includes("hello") || userMessage.includes("hi") || userMessage.includes("hey")) {
    intent = { name: "greeting", confidence: 0.95 };
    reply = `Hello! I'm your HireEdge Career Copilot. I can help you with career paths, skills analysis, salary benchmarks, interview preparation, resume optimisation, and more. What would you like to explore?`;
    next_actions = [
      { type: "question", label: "What can you do?", prompt: "What can you help me with?" },
      { type: "question", label: "Explore my options", prompt: "What are my career options?" },
    ];
  } else if (userMessage.includes("what can") || userMessage.includes("help") || userMessage.includes("feature")) {
    intent = { name: "capabilities", confidence: 0.9 };
    reply = `Here's what I can help with:\n\n• Career Paths — find step-by-step routes between any two roles\n• Skills Gap — see what you have vs. what you need\n• Salary Insights — UK benchmarks, ranges, and progression data\n• Resume Optimiser — ATS-ready blueprints for your target role\n• LinkedIn Optimiser — headlines, skills strategy, and profile scoring\n• Interview Prep — questions, STAR framework, and salary negotiation\n• Visa Eligibility — UK visa route assessment\n• Career Pack — all of the above in one report\n\nJust tell me your current role and where you want to go, and I'll guide you.`;
    next_actions = [
      { type: "question", label: "Build a roadmap", prompt: "How do I become a data architect?" },
      { type: "question", label: "Check my skills", prompt: "What skills do I need for product manager?" },
      { type: "question", label: "Prep for interviews", prompt: "Help me prepare for interviews" },
    ];
  } else {
    reply = `I can help you explore that. For the best results, try telling me:\n\n• Your current role (e.g. "I'm a data analyst")\n• Your target role (e.g. "I want to become a data engineer")\n• Your skills (e.g. "I know SQL, Python, and Excel")\n\nI'll then guide you through career paths, skills gaps, salary data, and preparation tools tailored to your situation.`;
    next_actions = [
      { type: "question", label: "Explore career paths", prompt: "What are my career options as a data analyst?" },
      { type: "question", label: "Check salary data", prompt: "What's the salary for a senior data engineer?" },
      { type: "tool", label: "Build Career Pack", prompt: null, endpoint: "/career-pack" },
    ];
  }

  // ── Build response matching the contract expected by copilotService.js ──

  return res.status(200).json({
    ok: true,
    data: {
      reply,
      intent,
      insights: null,
      recommendations,
      next_actions,
      context: {
        ...(context || {}),
        lastIntent: intent.name,
      },
    },
  });
}
