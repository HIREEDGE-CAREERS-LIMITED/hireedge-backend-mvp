export function buildRoadmapEnginePayload(input = {}) {
  return {
    engine: "roadmap",
    status: "scaffolded",
    input,
  };
}
