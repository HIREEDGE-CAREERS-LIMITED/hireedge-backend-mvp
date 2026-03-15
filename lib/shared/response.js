export function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

export function fail(res, error = "Request failed", status = 500) {
  return res.status(status).json({ ok: false, error });
}
