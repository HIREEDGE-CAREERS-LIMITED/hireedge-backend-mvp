// ============================================================================
// api/tools/resume-docx.js
// HireEdge Backend — Premium DOCX resume export
// Upgraded: proper typography hierarchy, bullet points, spacing, header layout
// ============================================================================

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  HeadingLevel, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, convertInchesToTwip,
  NumberingConfig, LevelFormat, UnderlineType,
} from "docx";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
];

// ── Colour palette ──────────────────────────────────────────────────────────
const TEAL    = "059669";  // accent
const DARK    = "1a1a2e";  // near-black for name
const MID     = "374151";  // body text
const LIGHT   = "6B7280";  // secondary / dates
const RULE    = "D1D5DB";  // section dividers

// ── Font sizes (half-points) ────────────────────────────────────────────────
const PT = (n) => n * 2;   // e.g. PT(11) = 22 half-points

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
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

    const sections = _parseCVText(resumeText);
    const children = _buildDocumentContent(sections);

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: PT(11), color: MID },
          },
        },
      },
      numbering: {
        config: [
          {
            reference: "bullet-list",
            levels: [
              {
                level: 0,
                format: LevelFormat.BULLET,
                text: "\u2022",
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.15) } },
                  run: { font: "Calibri", size: PT(10.5) },
                },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top:    convertInchesToTwip(0.75),
                bottom: convertInchesToTwip(0.75),
                left:   convertInchesToTwip(0.85),
                right:  convertInchesToTwip(0.85),
              },
            },
          },
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="HireEdge-CV.docx"');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("resume-docx error", err);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: "Failed to generate DOCX" });
  }
}

// ===========================================================================
// Document builder
// ===========================================================================

function _buildDocumentContent(sections) {
  const children = [];

  // ── Candidate name (first non-empty line that isn't a section heading) ───
  const nameLine = sections.name;
  if (nameLine) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({
            text:  nameLine,
            bold:  true,
            size:  PT(18),
            color: DARK,
            font:  "Calibri",
          }),
        ],
      })
    );
  }

  // ── Contact line ─────────────────────────────────────────────────────────
  if (sections.contact) {
    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [
          new TextRun({
            text:  sections.contact,
            size:  PT(10),
            color: LIGHT,
            font:  "Calibri",
          }),
        ],
      })
    );
  }

  // ── Named sections ────────────────────────────────────────────────────────
  const SECTION_ORDER = [
    "PROFESSIONAL SUMMARY",
    "CORE SKILLS",
    "EXPERIENCE",
    "EDUCATION",
    "ADDITIONAL",
  ];

  for (const heading of SECTION_ORDER) {
    const content = sections.body[heading];
    if (!content || content.length === 0) continue;

    // Section heading with teal underline rule
    children.push(_sectionHeading(heading));

    // Section content
    for (const line of content) {
      if (!line.trim()) continue;

      const isBullet  = line.trimStart().startsWith("•") || line.trimStart().startsWith("-");
      const isSubhead = _isRoleHeader(line); // "Title | Company | Dates"

      if (isBullet) {
        const bulletText = line.replace(/^[\s•\-]+/, "").trim();
        children.push(_bulletParagraph(bulletText));
      } else if (isSubhead && heading === "EXPERIENCE") {
        children.push(_roleHeader(line));
      } else if (heading === "CORE SKILLS") {
        // Skills as flowing text, bold labels
        children.push(_skillsLine(line));
      } else {
        children.push(
          new Paragraph({
            spacing: { before: 40, after: 40, line: 276 },
            children: [
              new TextRun({ text: line.trim(), size: PT(10.5), color: MID, font: "Calibri" }),
            ],
          })
        );
      }
    }

    children.push(_spacer(80));
  }

  return children;
}

// ===========================================================================
// Paragraph builders
// ===========================================================================

function _sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 4 },
    },
    children: [
      new TextRun({
        text,
        bold:  true,
        size:  PT(12),
        color: TEAL,
        font:  "Calibri",
        allCaps: true,
        characterSpacing: 40,
      }),
    ],
  });
}

function _roleHeader(line) {
  // "Job Title | Company | Location | Dates"
  const parts = line.split("|").map((p) => p.trim());
  const runs  = [];

  parts.forEach((p, i) => {
    if (i === 0) {
      // Job title — bold
      runs.push(new TextRun({ text: p, bold: true, size: PT(11), color: DARK, font: "Calibri" }));
    } else if (i === parts.length - 1) {
      // Dates — right-aligned via tab / italics secondary
      runs.push(new TextRun({ text: "  |  ", size: PT(10.5), color: LIGHT, font: "Calibri" }));
      runs.push(new TextRun({ text: p, italics: true, size: PT(10.5), color: LIGHT, font: "Calibri" }));
    } else {
      runs.push(new TextRun({ text: "  |  ", size: PT(10.5), color: LIGHT, font: "Calibri" }));
      runs.push(new TextRun({ text: p, size: PT(10.5), color: MID, font: "Calibri" }));
    }
  });

  return new Paragraph({ spacing: { before: 160, after: 40 }, children: runs });
}

function _bulletParagraph(text) {
  return new Paragraph({
    numbering: { reference: "bullet-list", level: 0 },
    spacing: { before: 30, after: 30, line: 264 },
    children: [
      new TextRun({ text, size: PT(10.5), color: MID, font: "Calibri" }),
    ],
  });
}

function _skillsLine(line) {
  // "Skill A | Skill B | Skill C"  →  spaced pill-like flow
  return new Paragraph({
    spacing: { before: 40, after: 60, line: 276 },
    children: [
      new TextRun({
        text: line.trim(),
        size:  PT(10.5),
        color: MID,
        font:  "Calibri",
      }),
    ],
  });
}

function _spacer(after = 120) {
  return new Paragraph({ spacing: { after }, children: [] });
}

// ===========================================================================
// CV text parser
// ===========================================================================

function _parseCVText(raw) {
  const lines   = raw.split(/\r?\n/);
  const result  = { name: null, contact: null, body: {} };
  const HEADINGS = ["PROFESSIONAL SUMMARY","CORE SKILLS","EXPERIENCE","EDUCATION","ADDITIONAL"];

  let current   = null;
  let headerDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeading = HEADINGS.includes(trimmed.toUpperCase());

    if (!headerDone && !isHeading) {
      // First non-empty line = name
      if (!result.name) { result.name = trimmed; continue; }
      // Second group = contact
      if (!result.contact && _looksLikeContact(trimmed)) { result.contact = trimmed; continue; }
    }

    if (isHeading) {
      headerDone = true;
      current = trimmed.toUpperCase();
      result.body[current] = [];
      continue;
    }

    if (current) {
      result.body[current].push(line);
    }
  }

  return result;
}

function _looksLikeContact(line) {
  return (
    line.includes("@") ||
    line.includes("|") ||
    /\+?\d[\d\s\-]{7,}/.test(line) ||
    /london|manchester|birmingham|uk|united kingdom/i.test(line)
  );
}

function _isRoleHeader(line) {
  return line.includes("|") && line.split("|").length >= 2 && !line.trimStart().startsWith("•");
}
