export function requireFields(source = {}, fields = []) {
  const missing = fields.filter((field) => {
    const value = source[field];
    return value === undefined || value === null || value === "";
  });

  return {
    ok: missing.length === 0,
    missing,
  };
}
