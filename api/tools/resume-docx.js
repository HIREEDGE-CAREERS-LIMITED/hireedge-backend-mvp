// ============================================================================
// api/tools/resume-docx.js
// HireEdge Backend — Premium DOCX resume export
//
// DELIBERATELY avoids the docx numbering/LevelFormat API — it behaves
// differently across v7 and v8 and causes runtime failures. Instead, bullet
// paragraphs use a manual indent + "•  " prefix which is visually identical
// and works in every version of the docx library.
//
// Safe imports only: Document, Packer, Paragraph, TextRun, BorderStyle,
// AlignmentType, convertInchesToTwip — all stable across docx v7+.
// ============================================================================

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  AlignmentType,
  convertInchesToTwip,
} from "docx";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
];

// ── Design tokens ────────────────────────────────────────────────────────────
const TEAL  = "059669";
const DARK  = "111827";
const MID   = "374151";
const LIGHT = "6B7280";
const PT    = (n) => n * 2; // docx uses half-points

// ── Margin in twips ──────────────────────────────────────────────────────────
const M = {
  page:        convertInchesToTwip(0.85),
  pageTop:     convertInchesToTwip(0.75),
  bulletLeft:  360,   // twips (~0.25 inch)
  bulletHang:  180,   // twips
};

export default async function handler(req, res) {
  const origin        = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin",  allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { resumeText } = req.body || {};

    if (!resumeText || typeof resumeText !== "string") {
      return res.status(200).json({ ok: false, error: "resumeText is required" });
    }

    const normalised = _normaliseBullets(resumeText);
    const sections   = _parseCVText(normalised);
    const children   = _buildContent(sections);

    // No `numbering` key — completely removed to avoid version-specific errors
    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top:    M.pageTop,
                bottom: M.pageTop,
                left:   M.page,
                right:  M.page,
              },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="HireEdge-CV.docx"');
    return res.status(200).send(buffer);

  } catch (err) {
    console.error("[resume-docx]", err);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: "Failed to generate DOCX: " + err.message });
    }
  }
}

// ===========================================================================
// Document content builder
// ===========================================================================

function _buildContent(sections) {
  const ch = [];

  // ── Name ──────────────────────────────────────────────────────────────────
  if (sections.name) {
    ch.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({
        text:  sections.name,
        bold:  true,
        size:  PT(18),
        color: DARK,
        font:  "Calibri",
      })],
    }));
  }

  // ── Contact line ──────────────────────────────────────────────────────────
  if (sections.contact) {
    ch.push(new Paragraph({
      spacing: { after: 180 },
      children: [new TextRun({
        text:  sections.contact,
        size:  PT(9.5),
        color: LIGHT,
        font:  "Calibri",
      })],
    }));
  }

  // ── Named sections ─────────────────────────────────────────────────────────
  const ORDER = [
    "PROFESSIONAL SUMMARY",
    "CORE SKILLS",
    "EXPERIENCE",
    "EDUCATION",
    "ADDITIONAL",
  ];

  for (const heading of ORDER) {
    const lines = sections.body[heading];
    if (!lines || lines.length === 0) continue;

    // Section heading with teal bottom border
    ch.push(new Paragraph({
      spacing: { before: 220, after: 100 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 4 },
      },
      children: [new TextRun({
        // allCaps removed — use toUpperCase() instead (version-safe)
        text:  heading.toUpperCase(),
        bold:  true,
        size:  PT(11.5),
        color: TEAL,
        font:  "Calibri",
      })],
    }));

    for (const line of lines) {
      if (!line.trim()) continue;

      const isBullet   = /^[\s]*[•]/.test(line);
      const isRoleHead = heading === "EXPERIENCE" && line.includes("|") && !isBullet;

      if (isBullet) {
        // Manual indent bullet — works in all docx versions, no numbering API needed
        const text = line.replace(/^[\s•]+/, "").trim();
        ch.push(new Paragraph({
          indent:  { left: M.bulletLeft, hanging: M.bulletHang },
          spacing: { before: 30, after: 30, line: 264 },
          children: [new TextRun({
            text:  "\u2022  " + text,
            size:  PT(10.5),
            color: MID,
            font:  "Calibri",
          })],
        }));

      } else if (isRoleHead) {
        // "Job Title | Company | Location | Dates"
        const parts = line.split("|").map((p) => p.trim());
        const runs  = [];

        parts.forEach((p, i) => {
          if (i === 0) {
            // Job title — bold
            runs.push(new TextRun({ text: p, bold: true, size: PT(11), color: DARK, font: "Calibri" }));
          } else {
            runs.push(new TextRun({ text: "   |   ", size: PT(10), color: LIGHT, font: "Calibri" }));
            runs.push(new TextRun({
              text:    p,
              italics: i === parts.length - 1,
              size:    PT(10),
              color:   LIGHT,
              font:    "Calibri",
            }));
          }
        });

        ch.push(new Paragraph({ spacing: { before: 180, after: 50 }, children: runs }));

      } else {
        // Regular body text
        ch.push(new Paragraph({
          spacing: { before: 40, after: 40, line: 276 },
          children: [new TextRun({
            text:  line.trim(),
            size:  PT(10.5),
            color: MID,
            font:  "Calibri",
          })],
        }));
      }
    }
  }

  return ch;
}

// ===========================================================================
// Text utilities — shared with resume-pdf.js
// ===========================================================================

function _normaliseBullets(text) {
  return text
    .split("\n")
    .map((line) =>
      /^(\s*)[\-\*]\s/.test(line)
        ? line.replace(/^(\s*)[\-\*]\s/, "$1• ")
        : line
    )
    .join("\n");
}

function _parseCVText(raw) {
  const HEADINGS = [
    "PROFESSIONAL SUMMARY",
    "CORE SKILLS",
    "EXPERIENCE",
    "EDUCATION",
    "ADDITIONAL",
  ];

  const result = { name: null, contact: null, body: {} };
  let current    = null;
  let headerDone = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed   = line.trim();
    if (!trimmed)   continue;
    const upperLine = trimmed.toUpperCase();
    const isHeading = HEADINGS.includes(upperLine);

    if (!headerDone && !isHeading) {
      if (!result.name) {
        result.name = trimmed;
        continue;
      }
      if (!result.contact && _isContact(trimmed)) {
        result.contact = trimmed;
        continue;
      }
    }

    if (isHeading) {
      headerDone = true;
      current    = upperLine;
      if (!result.body[current]) result.body[current] = [];
      continue;
    }

    if (current) result.body[current].push(line);
  }

  return result;
}

function _isContact(line) {
  return (
    line.includes("@") ||
    line.includes("|") ||
    /\+?\d[\d\s\-]{7,}/.test(line) ||
    /london|manchester|birmingham|uk|united kingdom/i.test(line)
  );
}
