// ============================================================================
// api/tools/resume-pdf.js
// HireEdge Backend — Premium PDF resume export
// Upgraded: proper typography hierarchy, teal section rules, bullet points
// ============================================================================

import PDFDocument from "pdfkit";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
  "https://hireedge.co.uk",
  "https://www.hireedge.co.uk",
];

// ── Design tokens ───────────────────────────────────────────────────────────
const COLORS = {
  name:     "#111827",  // near-black
  teal:     "#059669",  // EDGEX accent — section headings
  body:     "#374151",  // body text
  light:    "#6B7280",  // secondary, dates
  rule:     "#D1D5DB",  // light rule lines
};

const FONTS = {
  regular: "Helvetica",
  bold:    "Helvetica-Bold",
  italic:  "Helvetica-Oblique",
};

const MARGIN   = 50;
const BODY_W   = 595 - MARGIN * 2;  // A4 width minus margins

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

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="HireEdge-CV.pdf"');

    const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true });
    doc.pipe(res);

    _renderCV(doc, resumeText);

    doc.end();
  } catch (err) {
    console.error("resume-pdf error", err);
    if (!res.headersSent) return res.status(500).json({ ok: false, error: "Failed to generate PDF" });
  }
}

// ===========================================================================
// CV renderer
// ===========================================================================

function _renderCV(doc, raw) {
  const sections = _parseCVText(raw);
  const SECTION_ORDER = ["PROFESSIONAL SUMMARY","CORE SKILLS","EXPERIENCE","EDUCATION","ADDITIONAL"];

  // ── Name ──────────────────────────────────────────────────────────────────
  if (sections.name) {
    doc.font(FONTS.bold)
       .fontSize(18)
       .fillColor(COLORS.name)
       .text(sections.name, MARGIN, MARGIN, { width: BODY_W });
    doc.moveDown(0.2);
  }

  // ── Contact line ──────────────────────────────────────────────────────────
  if (sections.contact) {
    doc.font(FONTS.regular)
       .fontSize(9)
       .fillColor(COLORS.light)
       .text(sections.contact, { width: BODY_W });
    doc.moveDown(0.6);

    // Thin rule under header
    _rule(doc, COLORS.rule);
    doc.moveDown(0.5);
  }

  // ── Sections ──────────────────────────────────────────────────────────────
  for (const heading of SECTION_ORDER) {
    const content = sections.body[heading];
    if (!content || content.length === 0) continue;

    // Section heading
    _sectionHeading(doc, heading);

    for (const line of content) {
      if (!line.trim()) continue;

      const isBullet   = line.trimStart().startsWith("•") || line.trimStart().startsWith("-");
      const isRoleHead = line.includes("|") && line.split("|").length >= 2 && !isBullet;

      if (isBullet) {
        _bulletLine(doc, line.replace(/^[\s•\-]+/, "").trim());
      } else if (isRoleHead && heading === "EXPERIENCE") {
        _roleHeaderLine(doc, line);
      } else if (heading === "CORE SKILLS") {
        _skillsLine(doc, line);
      } else {
        doc.font(FONTS.regular)
           .fontSize(10.5)
           .fillColor(COLORS.body)
           .text(line.trim(), { width: BODY_W, lineGap: 2 });
        doc.moveDown(0.15);
      }
    }

    doc.moveDown(0.5);
  }
}

// ===========================================================================
// Paragraph helpers
// ===========================================================================

function _sectionHeading(doc, text) {
  doc.moveDown(0.3);
  doc.font(FONTS.bold)
     .fontSize(11)
     .fillColor(COLORS.teal)
     .text(text.toUpperCase(), { width: BODY_W, characterSpacing: 0.8 });

  // Teal underline rule
  const y = doc.y + 2;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + BODY_W, y)
     .strokeColor(COLORS.teal).lineWidth(1).stroke();
  doc.moveDown(0.4);
}

function _roleHeaderLine(doc, line) {
  // "Job Title | Company | Location | Dates"
  const parts = line.split("|").map((p) => p.trim());
  doc.moveDown(0.3);

  // Job title (bold left) + dates (italic right)
  const title = parts[0] || "";
  const rest  = parts.slice(1, -1).join("  |  ");
  const dates = parts[parts.length - 1] || "";

  // Title
  doc.font(FONTS.bold).fontSize(11).fillColor(COLORS.name).text(title, { continued: rest || dates ? false : false });

  // Company / location + dates on same visual line via columns
  if (rest || dates) {
    const sub = [rest, dates].filter(Boolean).join("   |   ");
    doc.font(FONTS.italic).fontSize(9.5).fillColor(COLORS.light).text(sub, { width: BODY_W });
  }
  doc.moveDown(0.15);
}

function _bulletLine(doc, text) {
  const bulletX = MARGIN + 10;
  const textX   = MARGIN + 22;
  const y       = doc.y;

  // Bullet dot
  doc.font(FONTS.regular).fontSize(10.5).fillColor(COLORS.teal).text("•", MARGIN, y, { continued: false });

  // Bullet text — positioned right of bullet
  doc.font(FONTS.regular).fontSize(10.5).fillColor(COLORS.body)
     .text(text, textX, y, { width: BODY_W - 22, lineGap: 2 });
  doc.moveDown(0.1);
}

function _skillsLine(doc, line) {
  doc.font(FONTS.regular)
     .fontSize(10.5)
     .fillColor(COLORS.body)
     .text(line.trim(), { width: BODY_W, lineGap: 2 });
  doc.moveDown(0.2);
}

function _rule(doc, color = COLORS.rule) {
  const y = doc.y;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + BODY_W, y)
     .strokeColor(color).lineWidth(0.5).stroke();
}

// ===========================================================================
// CV text parser (same logic as DOCX)
// ===========================================================================

function _parseCVText(raw) {
  const lines   = raw.split(/\r?\n/);
  const result  = { name: null, contact: null, body: {} };
  const HEADINGS = ["PROFESSIONAL SUMMARY","CORE SKILLS","EXPERIENCE","EDUCATION","ADDITIONAL"];

  let current    = null;
  let headerDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeading = HEADINGS.includes(trimmed.toUpperCase());

    if (!headerDone && !isHeading) {
      if (!result.name)    { result.name = trimmed; continue; }
      if (!result.contact && _looksLikeContact(trimmed)) { result.contact = trimmed; continue; }
    }

    if (isHeading) {
      headerDone = true;
      current    = trimmed.toUpperCase();
      result.body[current] = [];
      continue;
    }

    if (current) result.body[current].push(line);
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
