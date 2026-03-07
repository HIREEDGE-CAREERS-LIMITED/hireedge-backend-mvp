const fs = require("fs");
const path = require("path");

const FILE = path.join(process.cwd(), "data", "roles-enriched.json");

function loadRoles() {
  const raw = fs.readFileSync(FILE, "utf8");
  const data = JSON.parse(raw);
  const roles = data.roles || data.default?.roles || data;
  if (!Array.isArray(roles)) throw new Error("roles-enriched.json: roles array not found");
  return { data, roles };
}

function saveRoles(data, roles) {
  // Keep original shape: if file had {roles:[...]} keep it
  if (data.roles) data.roles = roles;
  else if (data.default?.roles) data.default.roles = roles;
  else {
    // fallback (unlikely)
    data.roles = roles;
  }
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function ensureNextRole(roles, fromSlug, toSlug) {
  const from = roles.find(r => r.slug === fromSlug);
  const to = roles.find(r => r.slug === toSlug);

  if (!from) return { ok: false, reason: `FROM missing: ${fromSlug}` };
  if (!to) return { ok: false, reason: `TO missing: ${toSlug}` };

  from.career_paths = from.career_paths || {};
  from.career_paths.next_roles = Array.isArray(from.career_paths.next_roles) ? from.career_paths.next_roles : [];

  if (!from.career_paths.next_roles.includes(toSlug)) {
    from.career_paths.next_roles.push(toSlug);
    return { ok: true, changed: true, from: fromSlug, to: toSlug };
  }
  return { ok: true, changed: false, from: fromSlug, to: toSlug };
}

(function main() {
  const { data, roles } = loadRoles();

  // BRIDGES (primary plan)
  const edges = [
    ["data-analyst", "business-analyst"],
    ["business-analyst", "product-analyst"],
    ["product-analyst", "product-manager"],
  ];

  // If business-analyst missing, fallback to: data-analyst -> product-analyst
  // If product-analyst missing, fallback to: business-analyst -> product-manager (or data-analyst -> product-manager)
  const results = [];

  for (const [a, b] of edges) {
    results.push(ensureNextRole(roles, a, b));
  }

  // Fallback logic
  const missingBA = results.find(r => r.reason?.includes("business-analyst"));
  const missingPA = results.find(r => r.reason?.includes("product-analyst"));

  if (missingBA) {
    results.push(ensureNextRole(roles, "data-analyst", "product-analyst"));
  }
  if (missingPA) {
    results.push(ensureNextRole(roles, "business-analyst", "product-manager"));
    results.push(ensureNextRole(roles, "data-analyst", "product-manager"));
  }

  saveRoles(data, roles);

  console.log("Bridge patch results:");
  for (const r of results) console.log(r);
})();
