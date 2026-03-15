export function calculateSkillsGap(requiredSkills = [], providedSkills = []) {
  const have = new Set(providedSkills.map((s) => String(s).trim().toLowerCase()));
  const matched = [];
  const missing = [];

  for (const skill of requiredSkills) {
    const normalized = String(skill).trim().toLowerCase();
    if (have.has(normalized)) matched.push(skill);
    else missing.push(skill);
  }

  return { matched, missing };
}
