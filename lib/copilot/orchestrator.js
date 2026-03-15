export function orchestrateCopilotRequest(input = {}) {
  return {
    status: "scaffolded",
    orchestration: true,
    input,
  };
}
