export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    route: "dashboard/saved-roles",
    status: "scaffolded",
    message: "Saved roles scaffold created.",
  });
}
