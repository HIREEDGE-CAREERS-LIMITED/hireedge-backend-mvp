export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    route: "copilot/chat",
    status: "scaffolded",
    message: "Copilot chat endpoint scaffold created. Orchestration wiring pending.",
  });
}
