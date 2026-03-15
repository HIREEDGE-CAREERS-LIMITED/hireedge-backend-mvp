import { buildGraphIndex } from "../dataset/graphIndex.js";

export function buildRoleGraph(rootSlug, depth = 2) {
  const bySlug = buildGraphIndex();
  const visited = new Set();
  const nodes = [];
  const links = [];
  const queue = [{ slug: rootSlug, level: 0 }];

  while (queue.length) {
    const { slug, level } = queue.shift();
    if (!slug || visited.has(slug) || level > depth) continue;

    visited.add(slug);

    const entry = bySlug.get(slug);
    if (!entry) continue;

    nodes.push(entry.role);

    for (const next of entry.next_roles) {
      links.push({ source: slug, target: next, type: "next" });
      if (!visited.has(next)) queue.push({ slug: next, level: level + 1 });
    }
  }

  return { nodes, links };
}
