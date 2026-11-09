/** Never expose infrastructure responses (or signed media URLs) to operators. */
export function tourTireAnalysisError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message || /internal server error|failed to fetch|network|memory limit|<html|https?:\/\//i.test(message)) {
    return "L’analyse des pneus est momentanément indisponible. Réessayez sans reprendre les photos.";
  }
  return message;
}

export function safeTireDiagnostic(error: unknown) {
  const value = error instanceof Error ? error : new Error(String(error));
  const redact = (text: string) => text.replace(/https?:\/\/\S+/g, "[url omitted]").replace(/(?:Bearer\s+|token[=:]\s*)\S+/gi, "[credential omitted]").slice(0, 1500);
  return { name: value.name, message: redact(value.message), stack: redact(value.stack ?? "") };
}