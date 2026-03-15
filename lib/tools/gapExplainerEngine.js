export function buildGapExplainerPayload(input = {}) {
  return {
    engine: "gap-explainer",
    status: "scaffolded",
    input,
  };
}
