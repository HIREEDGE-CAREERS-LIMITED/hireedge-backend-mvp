import { buildGraphIndex } from "../dataset/graphIndex.js";

export function findCareerPath(from, to, maxDepth = 10) {
  const graph = buildGraphIndex();
  if (from === to) return [from];

  const queue = [[from]];
  const visited = new Set([from]);

  while (queue.length) {
    const path = queue.shift();
    if (path.length > maxDepth) continue;

    const current = path[path.length - 1];
    const entry = graph.get(current);
    if (!entry) continue;

    for (const next of entry.next_roles) {
      if (visited.has(next)) continue;
      const newPath = [...path, next];
      if (next === to) return newPath;
      visited.add(next);
      queue.push(newPath);
    }
  }

  return null;
}
