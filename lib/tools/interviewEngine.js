export function buildInterviewEnginePayload(input = {}) {
  return {
    engine: "interview",
    status: "scaffolded",
    input,
  };
}
