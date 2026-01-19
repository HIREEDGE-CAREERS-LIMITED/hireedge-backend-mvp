// /api/resume-pdf.js
// POST /api/resume-pdf
// Body: { resumeText: string }

import PDFDocument from "pdfkit";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
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

  if (req.method === "OPTIONS") return res.status(200).end();
  // ----- END CORS -----

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { resumeText } = req.body || {};

    if (!resumeText || typeof resumeText !== "string") {
      return res.status(200).json({
        ok: false,
        error: "resumeText is required and must be a string",
      });
    }

    // PDF headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="HireEdge-Resume.pdf"'
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
    });

    // Stream PDF to response
    doc.pipe(res);
    doc.font("Helvetica");
    doc.fontSize(11);
    doc.text(resumeText, { align: "left" });
    doc.end();
  } catch (err) {
    console.error("resume-pdf error", err);
    if (!res.headersSent) {
      return res.status(200).json({
        ok: false,
        error: "Internal server error while generating PDF",
      });
    }
  }
}
