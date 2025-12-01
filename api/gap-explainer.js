// /api/gap-explainer.js

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000"
];

export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const {
      gapType,
      duration = "",
      previousRole = "",
      targetRole = "",
      reasonDetails = ""
    } = req.body || {};

    if (!gapType) {
      return res.status(200).json({
        ok: false,
        error: "gapType is required"
      });
    }

    const fromRole = previousRole || "my previous role";
    const toRole = targetRole || "this role";

    let cvLine = "";
    let interviewAnswer = "";
    let emailParagraph = "";

    const extra =
      reasonDetails && reasonDetails.trim().length > 0
        ? ` I used this time for ${reasonDetails.trim()}.`
        : "";

    switch (gapType) {
      case "study":
        cvLine = `Took a planned break from ${fromRole} to focus on full-time study and skill development${extra}.`;
        interviewAnswer =
          `I took a planned break from work to focus on my studies and building stronger skills for ${toRole}.` +
          extra +
          " I kept a routine, stayed close to industry news, and now I’m ready to apply what I’ve learned in a stable, long-term role.";
        emailParagraph =
          `During this period I stepped away from full-time work to focus on further study and development relevant to ${toRole}.` +
          extra +
          " I am now ready to return to full-time employment and bring that learning into your team.";
        break;

      case "relocation":
        cvLine = `Career break due to relocation and settling into a new country, while preparing to re-enter work in ${toRole}.`;
        interviewAnswer =
          "I relocated, which meant I had to focus on settling, understanding the local job market and arranging the right documents. " +
          "I used the time to understand expectations in the UK market, update my CV and improve my skills. Now I am settled and ready to commit fully to a long-term role.";
        emailParagraph =
          "There is a gap on my CV due to relocating and settling in a new country. During this time I focused on understanding the local job market and preparing to return to work. I am now fully settled and available for full-time employment.";
        break;

      case "family":
        cvLine = `Temporary break from work for family responsibilities, now fully available to return to full-time work.`;
        interviewAnswer =
          "I took a temporary break from work to manage important family responsibilities. " +
          "It was a planned decision, and once the situation was stable I started preparing to return – updating my skills, reviewing the market and planning my next steps. Now I’m in a position to focus fully on my career again.";
        emailParagraph =
          "The gap on my CV is due to a planned period where I had to focus on family responsibilities. That situation is now stable, and I am fully committed to returning to full-time work.";
        break;

      case "health":
        cvLine = `Short break from work for health reasons (now resolved) and cleared to return to full-time employment.`;
        interviewAnswer =
          "I had a health issue which required me to step back from work for a period. It has been treated and I have medical clearance to work full-time again. " +
          "I’m happy to focus the rest of the conversation on how I can perform in this role now.";
        emailParagraph =
          "There is a short gap on my CV due to a health matter which has since been resolved. I am fully fit to work and ready to focus on adding value in a long-term role.";
        break;

      case "job_search":
        cvLine = `Focused period on targeted job search and upskilling towards roles in ${toRole}.`;
        interviewAnswer =
          "After my last role I made a deliberate decision to look for a position that was the right long-term fit. " +
          "During this time I treated job search like a project – improving my CV, learning about the market, and building skills that match roles like this one.";
        emailParagraph =
          "The recent gap reflects a deliberate job search period where I focused on finding a role aligned with my long-term direction and improving my skills to match positions like this.";
        break;

      case "career_change":
        cvLine = `Transition period to move from ${fromRole} into ${toRole}, including self-study and practical projects.`;
        interviewAnswer =
          `I chose to transition from ${fromRole} into ${toRole}. I used this time to study, complete small projects and understand how my existing skills transfer.` +
          " Now I’m ready to bring both my past experience and new skills into this role.";
        emailParagraph =
          `The gap is linked to my transition from ${fromRole} into ${toRole}, where I invested time into learning, building projects and aligning my profile with this direction.`;
        break;

      default:
        cvLine = `Short break from formal employment, now returning to full-time work focused on ${toRole}.`;
        interviewAnswer =
          "There is a short gap on my CV where I was not in formal employment. I used the time to reflect, learn and plan my next step, and now I’m focused on a long-term role like this.";
        emailParagraph =
          "You may notice a short gap on my CV. This was a period between roles which I used to prepare for my next long-term opportunity. I am now fully available and motivated to return to full-time work.";
    }

    const durationText = duration ? `Approximate duration: ${duration}.` : "";

    return res.status(200).json({
      ok: true,
      gapType,
      duration,
      cvLine,
      interviewAnswer,
      emailParagraph,
      note:
        "These are templates for explaining your gap in a clear, honest and professional way. Adjust wording to match your personal situation.",
      durationText
    });
  } catch (err) {
    console.error("gap-explainer error", err);
    return res.status(200).json({
      ok: false,
      error: "Server error while generating gap explanation"
    });
  }
}
