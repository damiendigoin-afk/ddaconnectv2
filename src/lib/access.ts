import { supabase } from "@/integrations/supabase/client";

/**
 * Registre central des modules de DDA Connect.
 *
 * Toute entrée de menu réellement présente dans l'application doit figurer ici :
 * c'est cette liste qui alimente à la fois le contrôle d'accès par URL
 * (`ModuleGate`) et les cases à cocher de la fiche utilisateur. Ajouter un
 * module = ajouter une ligne ici, rien d'autre.
 *
 * - `prefixes` : URLs couvertes par le droit (vide = droit d'action, sans route).
 * - `action`   : droit fin (validation, comptabilisation…), jamais un menu.
 */
export type ModuleDef = {
  key: string;
  label: string;
  group: string;
  prefixes?: string[];
  action?: boolean;
  hint?: string;
};

export const MODULES = [
  // ------------------------------------------------------------- Atelier
  { key: "tour", label: "Tour Véhicule", group: "Atelier", prefixes: ["/tour-vehicule", "/tours", "/tour", "/ordres", "/or", "/scan-plaque"] },
  { key: "pneus", label: "Devis pneus", group: "Atelier", prefixes: ["/devis/pneus"] },
  { key: "expertise", label: "Expertise Véhicule", group: "Atelier", prefixes: ["/expertises", "/expertise"] },
  { key: "carrosserie", label: "Carrosserie", group: "Atelier", prefixes: ["/carrosserie"] },
  { key: "maintenance", label: "Maintenance prédictive", group: "Atelier", prefixes: ["/maintenance"] },
  // ------------------------------------------------ Magasin & achats
  { key: "magasin", label: "Magasin", group: "Magasin & achats", prefixes: ["/magasin", "/factures-fournisseur"] },
  // ------------------------------------------- Clients & commercial
  { key: "crm", label: "CRM", group: "Clients & commercial", prefixes: ["/crm", "/client", "/vehicule"] },
  { key: "recuperation", label: "Ventes", group: "Clients & commercial", prefixes: ["/recuperation"] },
  { key: "darva", label: "Gestion DARVA", group: "Clients & commercial", prefixes: ["/darva"] },
  // --------------------------------------------------- Communication
  { key: "communication", label: "Communication", group: "Communication", prefixes: ["/communication"] },
  // ------------------------------------------------------ Équipe & RH
  { key: "notes_frais", label: "Notes de frais", group: "Équipe & RH", prefixes: ["/notes-frais"] },
  {
    key: "notes_frais_creer",
    label: "Créer une note de frais",
    group: "Équipe & RH",
    action: true,
    hint: "Scanner un justificatif et enregistrer une dépense",
  },
  {
    key: "notes_frais_valider",
    label: "Valider les notes de frais",
    group: "Équipe & RH",
    action: true,
    hint: "File « À valider » et envoi automatique à la comptabilité",
  },
  {
    key: "notes_frais_compta",
    label: "Comptabiliser / régler les notes",
    group: "Équipe & RH",
    action: true,
    hint: "Marquer remboursé au salarié ou comptabilisé",
  },
  // ---------------------------------------- Statistiques & pilotage
  { key: "statistiques", label: "Mes statistiques", group: "Statistiques & pilotage", prefixes: ["/statistiques"] },
  { key: "stats_equipe", label: "Productivité", group: "Statistiques & pilotage" },
  { key: "stats_import", label: "Import statistiques", group: "Statistiques & pilotage" },
  { key: "pilotage", label: "Gestion", group: "Statistiques & pilotage", prefixes: ["/pilotage"] },
  // ------------------------------------------------------ Paramétrage
  { key: "base", label: "Base de données", group: "Paramétrage", prefixes: ["/base"] },
  { key: "qualite", label: "Qualité des données", group: "Paramétrage", prefixes: ["/qualite"] },
  { key: "emails", label: "Flux emails", group: "Paramétrage", prefixes: ["/emails"] },
  { key: "connaissances", label: "Base de connaissances", group: "Paramétrage", prefixes: ["/connaissances"] },
  { key: "automatisations", label: "Automatisations", group: "Paramétrage", prefixes: ["/automatisations"] },
  { key: "parametrage", label: "Paramétrage général", group: "Paramétrage", prefixes: ["/parametrage"] },
  { key: "utilisateurs", label: "Fiche & accès", group: "Paramétrage", prefixes: ["/utilisateurs"] },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]["key"];

/** Groupes d'affichage, dans l'ordre du registre. */
export const MODULE_GROUPS: string[] = MODULES.reduce<string[]>((acc, m) => {
  if (!acc.includes(m.group)) acc.push(m.group);
  return acc;
}, []);

export async function fetchModuleAccess(userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("user_module_access")
    .select("module_key, allowed")
    .eq("user_id", userId);
  return new Set(((data ?? []) as { module_key: string; allowed: boolean }[]).filter((m) => m.allowed).map((m) => m.module_key));
}

export async function fetchAllModuleAccess(): Promise<Map<string, Set<string>>> {
  const { data } = await supabase.from("user_module_access").select("user_id, module_key, allowed");
  const map = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { user_id: string; module_key: string; allowed: boolean }[]) {
    if (!r.allowed) continue;
    const set = map.get(r.user_id) ?? new Set<string>();
    set.add(r.module_key);
    map.set(r.user_id, set);
  }
  return map;
}

export async function setModuleAccess(userId: string, moduleKey: string, allowed: boolean) {
  const { error } = await supabase
    .from("user_module_access")
    .upsert({ user_id: userId, module_key: moduleKey, allowed }, { onConflict: "user_id,module_key" });
  if (error) throw error;
}
