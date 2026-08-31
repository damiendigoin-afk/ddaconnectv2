export type ProviderSendResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

export type FrontOfficeSendStatus = "sent" | "failed";

export function normalizeFrontOfficeRecipients(rows: Array<{ email?: unknown }>): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => (typeof row.email === "string" ? row.email.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  );
}

function stableRecipientToken(recipient: string): string {
  let hash = 2166136261;
  for (const char of recipient.trim().toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function frontOfficeIdempotencyKey(args: {
  inspectionId: string;
  recipient: string;
  mode: "automatic" | "manual";
  attemptId?: string;
}): string {
  const base = `tour-fo-${args.mode}-${args.inspectionId}-${stableRecipientToken(args.recipient)}`;
  return args.mode === "manual" && args.attemptId ? `${base}-${args.attemptId}` : base;
}

export function acceptedProviderSend(result: ProviderSendResult): boolean {
  return result.ok === true && typeof result.id === "string" && result.id.trim().length > 0;
}

export function emailLogOutcome(result: ProviderSendResult): {
  status: FrontOfficeSendStatus;
  provider_id: string | null;
  error_message: string | null;
} {
  if (acceptedProviderSend(result)) {
    return { status: "sent", provider_id: result.id?.trim() ?? null, error_message: null };
  }
  return {
    status: "failed",
    provider_id: result.id?.trim() || null,
    error_message: (result.error || "Le fournisseur n'a pas confirmé l'envoi").slice(0, 500),
  };
}

export function aggregateFrontOfficeResults(results: ProviderSendResult[]): "sent" | "partial" | "failed" {
  const accepted = results.filter(acceptedProviderSend).length;
  if (accepted === results.length && results.length > 0) return "sent";
  if (accepted > 0) return "partial";
  return "failed";
}

export function assertUsablePdf(base64: string): void {
  if (!base64 || base64.length < 100 || !base64.startsWith("JVBERi0")) {
    throw new Error("Le PDF du compte-rendu est vide ou invalide");
  }
}