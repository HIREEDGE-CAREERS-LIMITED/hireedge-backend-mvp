export function formatSalaryBand(salary) {
  if (!salary || typeof salary !== "object") return null;

  const min = Number(salary.min);
  const max = Number(salary.max);
  const mean = Number(salary.mean);

  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
    mean: Number.isFinite(mean) ? mean : null,
    currency: salary.currency || "GBP",
    period: salary.period || "year",
    source: salary.source || null,
  };
}
