// ============================================================================
// lib/copilot/planner.js
// HireEdge — AI Career Intelligence Platform
//
// Action planner. Generates concrete next_actions that the frontend can
// render as clickable buttons, follow-up prompts, or API calls.
// Each action maps to an existing HireEdge endpoint.
// ============================================================================

/**
 * @typedef {Object} NextAction
 * @property {string} label        - Button / link text
 * @property {string} type         - tool | question | link
 * @property {string} [endpoint]   - API endpoint to call
 * @property {object} [params]     - Query params for the endpoint
 * @property {string} [prompt]     - Suggested follow-up message for chat
 */

/**
 * Generate next_actions based on intent, insights, and context.
 *
 * @param {string} intent
 * @param {object} insights
 * @param {object} context
 * @returns {NextAction[]}
 */
export function planNextActions(intent, insights, context) {
  const actions = [];
  const role = context.role;
  const target = context.target;
  const skills = context.skills || [];
  const yearsExp = context.yearsExp;

  switch (intent) {
    case "transition": {
      if (role && target) {
        actions.push({
          label: "View full roadmap",
          type: "tool",
          endpoint: "/api/tools/career-roadmap",
          params: { action: "build", from: role, to: target, strategy: "fastest" },
        });
        actions.push({
          label: "Prepare for interviews",
          type: "question",
          prompt: `Help me prepare for ${_titleOf(target, insights)} interviews`,
        });
        if (skills.length > 0) {
          actions.push({
            label: "Optimise my resume",
            type: "question",
            prompt: `Help me optimise my resume for ${_titleOf(target, insights)}`,
          });
        }
        actions.push({
          label: "Get full Career Pack",
          type: "tool",
          endpoint: "/api/career-pack/build",
          params: { role, target, skills: skills.join(","), yearsExp },
        });
      }
      break;
    }

    case "explore": {
      const nextMoves = insights.next_moves || [];
      for (const move of nextMoves.slice(0, 3)) {
        actions.push({
          label: `Explore: ${move.title}`,
          type: "question",
          prompt: `How do I move from ${_titleOf(role, insights)} to ${move.title}?`,
        });
      }
      if (role) {
        actions.push({
          label: "View career graph",
          type: "tool",
          endpoint: "/api/career-intelligence/role-graph",
          params: { slug: role, depth: 2 },
        });
      }
      break;
    }

    case "skills_gap": {
      const gapTarget = target || role;
      if (gapTarget) {
        actions.push({
          label: "Build a learning roadmap",
          type: "question",
          prompt: `Build me a roadmap to close my skill gaps for ${_titleOf(gapTarget, insights)}`,
        });
        if (skills.length > 0) {
          actions.push({
            label: "Find roles matching my skills",
            type: "tool",
            endpoint: "/api/career-intelligence/skills-gap",
            params: { action: "match", skills: skills.join(","), limit: "10" },
          });
        }
      }
      break;
    }

    case "salary": {
      if (role) {
        actions.push({
          label: "See top-paying roles in my category",
          type: "tool",
          endpoint: "/api/career-intelligence/salary-intelligence",
          params: { action: "top", limit: "10" },
        });
      }
      if (role && !target) {
        actions.push({
          label: "Explore career moves for higher salary",
          type: "question",
          prompt: "What career moves would give me the biggest salary increase?",
        });
      }
      break;
    }

    case "interview": {
      const t = target || role;
      if (t) {
        actions.push({
          label: "View full interview prep",
          type: "tool",
          endpoint: "/api/tools/interview-prep",
          params: { target: t, skills: skills.join(","), current: role, yearsExp },
        });
        actions.push({
          label: "Check salary negotiation range",
          type: "question",
          prompt: `What salary should I negotiate for ${_titleOf(t, insights)}?`,
        });
      }
      break;
    }

    case "resume": {
      const t = target || role;
      if (t && skills.length > 0) {
        actions.push({
          label: "View full resume blueprint",
          type: "tool",
          endpoint: "/api/tools/resume-optimiser",
          params: { action: "blueprint", target: t, skills: skills.join(","), current: role },
        });
        actions.push({
          label: "Also optimise my LinkedIn",
          type: "question",
          prompt: "Help me optimise my LinkedIn profile",
        });
      }
      break;
    }

    case "linkedin": {
      if (role) {
        actions.push({
          label: "View full LinkedIn plan",
          type: "tool",
          endpoint: "/api/tools/linkedin-optimiser",
          params: { role, skills: skills.join(","), yearsExp, target },
        });
        actions.push({
          label: "Also help with my resume",
          type: "question",
          prompt: "Help me optimise my resume",
        });
      }
      break;
    }

    case "visa": {
      const t = target || role;
      if (t) {
        actions.push({
          label: "View detailed visa assessment",
          type: "tool",
          endpoint: "/api/tools/visa-eligibility",
          params: { action: "assess", role: t, skills: skills.join(",") },
        });
        actions.push({
          label: "Compare visa eligibility across roles",
          type: "question",
          prompt: "Compare visa eligibility for my next career moves",
        });
      }
      break;
    }

    case "career_pack": {
      if (role && target) {
        actions.push({
          label: "Download Career Pack",
          type: "tool",
          endpoint: "/api/career-pack/export",
          params: { role, target, skills: skills.join(","), yearsExp },
        });
      }
      break;
    }

    case "role_info": {
      const slug = insights.role_profile?.slug || target || role;
      if (slug) {
        actions.push({
          label: "See career paths from this role",
          type: "question",
          prompt: `What career moves can I make from ${_titleOf(slug, insights)}?`,
        });
        actions.push({
          label: "Check salary details",
          type: "question",
          prompt: `What does a ${_titleOf(slug, insights)} earn?`,
        });
      }
      break;
    }

    case "compare": {
      const mentioned = insights.comparison;
      if (mentioned) {
        actions.push({
          label: "See transition between these roles",
          type: "question",
          prompt: `How do I move from ${mentioned.role_a?.title || "Role A"} to ${mentioned.role_b?.title || "Role B"}?`,
        });
      }
      break;
    }

    default: {
      actions.push({
        label: "Tell me your current role",
        type: "question",
        prompt: "I am a [your role] with skills in [your skills]",
      });
      actions.push({
        label: "Explore career options",
        type: "question",
        prompt: "What career options are available to me?",
      });
      break;
    }
  }

  return actions.slice(0, 6);
}

// ===========================================================================
// Internal
// ===========================================================================
function _titleOf(slug, insights) {
  // Try to get title from insights first
  if (insights.role_profile?.slug === slug) return insights.role_profile.title;
  if (insights.target_profile?.slug === slug) return insights.target_profile.title;
  // Fallback: slug → humanised
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
