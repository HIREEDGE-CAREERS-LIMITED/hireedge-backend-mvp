import fs from "fs";
import path from "path";

const DATASET_PATH = path.join(process.cwd(), "data", "roles-enriched.json");

let cache = null;

function loadRoles() {
  if (cache) return cache;

  let raw;
  try {
    raw = fs.readFileSync(DATASET_PATH, "utf-8");
  } catch {
    throw new Error("Dataset file could not be read.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Dataset file is not valid JSON.");
  }

  const roles = Array.isArray(parsed) ? parsed : parsed?.roles;

  if (!Array.isArray(roles)) {
    throw new Error("Dataset does not contain a valid roles array.");
  }

  cache = roles;
  return cache;
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const roles = loadRoles();

    const query = String(req.query.q || "").trim().toLowerCase();
    const category = String(req.query.category || "").trim().toLowerCase();
    const seniority = String(req.query.seniority || "").trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit || 500), 1000);

    let results = roles.map((role) => ({
      slug: role.slug || "",
      title: role.title || "",
      category: role.category || "",
      seniority: role.seniority || "",
      skills_count: Array.isArray(role.skills) ? role.skills.length : 0,
    }));

    if (query) {
      results = results.filter((role) => {
        return (
          role.slug.toLowerCase().includes(query) ||
          role.title.toLowerCase().includes(query) ||
          role.category.toLowerCase().includes(query) ||
          role.seniority.toLowerCase().includes(query)
        );
      });
    }

    if (category) {
      results = results.filter(
        (role) => role.category.toLowerCase() === category
      );
    }

    if (seniority) {
      results = results.filter(
        (role) => role.seniority.toLowerCase() === seniority
      );
    }

    results = results
      .filter((role) => role.slug && role.title)
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, limit);

    return res.status(200).json({
      ok: true,
      total: results.length,
      roles: results,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load roles.",
    });
  }
}
