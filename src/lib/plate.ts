export function normalizePlate(input: string): string {
  return (input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Formats a normalized plate for display: AB123CD -> AB-123-CD */
export function formatPlate(input: string): string {
  const n = normalizePlate(input);
  const m = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(n);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const old = /^(\d{1,4})([A-Z]{2,3})(\d{2,3})$/.exec(n);
  if (old) return `${old[1]}-${old[2]}-${old[3]}`;
  return n;
}