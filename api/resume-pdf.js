// api/resume-pdf.js
// POST /api/resume-pdf
// Body: { resumeText: string }

const PDFDocument = require("pdfkit");

module.exports = (req, res) => {
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

  let body = "";

  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", () => {
    let data = {};
    try {
      data = JSON.parse(body || "{}");
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const { resumeText } = data;

    if (!resumeText || typeof resumeText !== "string") {
      return res
        .status(400)
        .json({ error: "resumeText is required and must be a string" });
    }

    // PDF headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="HireEdge-Resume.pdf"'
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 50
    });

    // Stream PDF to response
    doc.pipe(res);
    doc.font("Helvetica");
    doc.fontSize(11);
    doc.text(resumeText, { align: "left" });
    doc.end();
  });

  req.on("error", (err) => {
    console.error("resume-pdf error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
