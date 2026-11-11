/**
 * Diagnostic « IXELLIO — temps barémés » : LECTURE SEULE, manager. Un login via openIxellioSession,
 * AUCUNE requête supplémentaire : on n'analyse que le HTML du menu principal déjà obtenu.
 * Verrou partagé avec le diagnostic pièces (licence mono-session, 15 s). Aucun TM produit ici.
 */
import { inspectIxellioMenu, laborAccessStatus, type MenuInspection, type LaborStatus } from "./ixellio-labor-parse";
import { acquireIxellio, releaseIxellio } from "./ixellio-lock.server";
import { loadIxellioCredentials } from "./ixellio-store.server";
import { openIxellioSession } from "./ixellio.server";

export type IxellioLaborAccess = {
  status: "page_connexion" | "menu_vide" | "aucun_lien_tm" | "menu_identifie_tm_non_recuperes" | "acces_limite"
    | "not_configured" | "auth_failed" | "busy" | "rate_limited" | "network_error";
  laborStatus: LaborStatus;
  message: string;
  reachedMain: boolean;
  bytes: number;
  menu: MenuInspection | null;
  /** Toujours vide à cette étape : aucune page de temps n'est consultée. */
  times: [];
  trace: string[];
  durationMs: number;
};

const MESSAGES: Record<string, string> = {
  page_connexion: "Le menu reçu ressemble à la page de connexion : accès non établi.",
  menu_vide: "Menu reçu sans lien interne exploitable.",
  aucun_lien_tm: "Menu identifié, aucun lien de temps barémés repéré. Les TM ne sont peut-être pas souscrits ou passent par le chiffrage/véhicule.",
  menu_identifie_tm_non_recuperes: "Menu identifié, TM non récupérés (aucune page de temps consultée à cette étape).",
  acces_limite: "IXELLIO signale un accès limité (abonnement/droit) : accès aux TM non établi.",
};

export async function inspectIxellioLaborAccess(): Promise<IxellioLaborAccess> {
  const started = Date.now();
  const trace: string[] = [];
  const out = (status: IxellioLaborAccess["status"], message: string, extra: Partial<IxellioLaborAccess> = {}): IxellioLaborAccess => ({
    status, laborStatus: "structure_unknown", message, reachedMain: false, bytes: 0, menu: null, times: [], trace, durationMs: Date.now() - started, ...extra,
  });
  const creds = await loadIxellioCredentials();
  if (!creds) return out("not_configured", "IXELLIO n'est pas configuré dans Paramètres API.");
  const lock = acquireIxellio();
  if (!lock.ok) return lock.reason === "busy"
    ? out("busy", "Une consultation IXELLIO est déjà en cours (licence mono-session).")
    : out("rate_limited", "Patientez quelques secondes entre deux consultations IXELLIO.");
  try {
    const session = await openIxellioSession(creds, trace);
    if (!session.ok) return out("auth_failed", session.message);
    const menu = inspectIxellioMenu(session.html);
    const s = laborAccessStatus(menu);
    trace.push(`menu analysé : ${menu.entries.length} entrée(s), ${menu.forms.length} formulaire(s), aucune requête supplémentaire`);
    return out(s.code, MESSAGES[s.code]!, { laborStatus: s.laborStatus, reachedMain: session.reachedMain, bytes: session.html.length, menu });
  } catch (e) {
    return out("network_error", `Erreur réseau : ${e instanceof Error ? e.message : "inconnue"}`);
  } finally {
    releaseIxellio();
  }
}
