export function applyCors(req, res, allowedOrigins = []) {
  const origin = req.headers.origin;
  const allowedOrigin = allowedOrigins.includes(origin)
    ? origin
    : (allowedOrigins[0] || "*");

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}
