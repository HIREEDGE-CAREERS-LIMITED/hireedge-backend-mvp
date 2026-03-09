import fs from "fs";
import path from "path";

const ALLOWED_ORIGINS = [
  "https://hireedge-mvp-web.vercel.app",
  "https://hireedge-2d4baa.webflow.io",
  "http://localhost:3000",
];

const DATA_PATH = path.join(process.cwd(), "data", "roles-enriched.json");

export default function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
    });
  }

  const { role } = req.query;

  if (!role) {
    return res.status(400).json({
      ok: false,
      error: "Role slug required",
    });
  }

  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

    const roles = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.roles)
      ? raw.roles
      : Array.isArray(raw.data)
      ? raw.data
      : [];

    if (!roles.length) {
      return res.status(500).json({
        ok: false,
        error: "Roles dataset is not in expected array format",
      });
    }

    const normalizedRole = String(role).trim().toLowerCase().replace(/\s+/g, "-");

    const currentRole = roles.find((r) => r.slug === normalizedRole);

    if (!currentRole) {
      return res.status(404).json({
        ok: false,
        error: "Role not found",
      });
    }

    const nextRoles = roles.filter((r) =>
      currentRole.career_paths?.next_roles?.includes(r.slug)
    );

    const previousRoles = roles.filter((r) =>
      currentRole.career_paths?.previous_roles?.includes(r.slug)
    );

    return res.status(200).json({
      ok: true,
      role: currentRole,
      nextRoles,
      previousRoles,
    });
  } catch (err) {
    console.error("role-explorer error:", err);
    return res.status(500).json({
      ok: false,
      error: "Failed to load role explorer data",
    });
  }
}
