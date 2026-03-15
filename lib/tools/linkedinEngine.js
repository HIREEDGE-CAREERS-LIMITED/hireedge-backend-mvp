export function buildLinkedinEnginePayload(input = {}) {
  return {
    engine: "linkedin",
    status: "scaffolded",
    input,
  };
}
