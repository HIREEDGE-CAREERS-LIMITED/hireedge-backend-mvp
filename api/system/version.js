export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    service: "hireedge-backend-mvp",
    version: "2.0.0",
    architecture: "modular",
  });
}
