// /api/resume-docx.js
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

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

    const lines = resumeText.split(/\r?\n/);

    const paragraphs = lines.map((line) => {
      if (!line.trim()) {
        return new Paragraph({ text: "" });
      }
      return new Paragraph({
        children: [
          new TextRun({
            text: line,
            font: "Calibri",
            size: 22, // 11pt
          }),
        ],
      });
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="HireEdge-Resume.docx"'
    );

    return res.status(200).send(buffer);
  } catch (err) {
    console.error("resume-docx error", err);
    // For docx failures we can still send JSON error
    if (!res.headersSent) {
      return res.status(200).json({
        ok: false,
        error: "Internal server error while generating DOCX",
      });
    }
  }
}
