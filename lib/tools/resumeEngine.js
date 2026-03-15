export function buildResumeEnginePayload(input = {}) {
  return {
    engine: "resume",
    status: "scaffolded",
    input,
  };
}
