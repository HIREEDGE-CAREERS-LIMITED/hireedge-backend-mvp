// api/resume-docx.js
// POST /api/resume-docx
// Body: { resumeText: string }

const {
  Document,
  Packer,
  Paragraph,
  TextRun
} = require("docx");

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

  req.on("end", async () => {
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

    try {
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
              size: 22 // 11pt
            })
          ]
        });
      });

      const doc = new Document({
        sections: [
          {
            properties: {},
            children: paragraphs
          }
        ]
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
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  req.on("error", (err) => {
    console.error("resume-docx stream error", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });
};
