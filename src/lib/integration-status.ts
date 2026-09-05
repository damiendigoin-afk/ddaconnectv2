/**
 * Statuts communs à toutes les connexions externes (Paramètres API).
 * Aucun succès n'est simulé : sans identifiants réels, la connexion reste
 * « Non configuré ».
 */
export type IntegrationStatus = "non_configure" | "configure" | "teste" | "actif" | "erreur";

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  non_configure: "Non configuré",
  configure: "Configuré — jamais testé",
  teste: "Testé — en pause",
  actif: "Actif",
  erreur: "Erreur",
};

export const STATUS_TONE: Record<IntegrationStatus, string> = {
  non_configure: "border-border text-muted-foreground",
  configure: "border-amber-400 text-amber-700",
  teste: "border-sky-400 text-sky-700",
  actif: "border-emerald-500 text-emerald-700",
  erreur: "border-red-500 text-red-700",
};

export type StatusInput = {
  /** Clé, identifiants ou compte relié présents côté serveur. */
  configured: boolean;
  /** Service activé par le manager. */
  active?: boolean;
  /** Résultat du dernier test : null = jamais testé. */
  lastCheckOk?: boolean | null;
  lastCheckMessage?: string | null;
  lastCheckAt?: string | null;
};

export function computeStatus(input: StatusInput): IntegrationStatus {
  if (!input.configured) return "non_configure";
  if (input.lastCheckOk === false) return "erreur";
  if (input.lastCheckOk == null) return "configure";
  return input.active ? "actif" : "teste";
}

export function statusText(input: StatusInput): string {
  const s = computeStatus(input);
  if (s === "erreur" && input.lastCheckMessage) return `Erreur — ${input.lastCheckMessage}`;
  return STATUS_LABEL[s];
}

export const fmtCheck = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais testé";
