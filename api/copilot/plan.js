export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    route: "copilot/plan",
    status: "scaffolded",
    message: "Planning endpoint scaffold created.",
  });
}
