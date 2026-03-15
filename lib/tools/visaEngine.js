export function buildVisaEnginePayload(input = {}) {
  return {
    engine: "visa",
    status: "scaffolded",
    input,
  };
}
