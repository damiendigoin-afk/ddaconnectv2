/** Édition d'une fiche du référentiel `ref_vehicles` (jamais la table legacy `vehicles`). */
import { formatRegistration, normalizeRegistration, normalizeVin } from "./winmotor/mapping";

export const EDIT_FIELDS: { key: string; label: string; kind: "text" | "int" | "date" }[] = [
  { key: "registration_display", label: "Immatriculation", kind: "text" },
  { key: "vin", label: "VIN", kind: "text" },
  { key: "brand", label: "Marque", kind: "text" },
  { key: "range_name", label: "Gamme", kind: "text" },
  { key: "model", label: "Modèle", kind: "text" },
  { key: "version", label: "Version", kind: "text" },
  { key: "first_registration_date", label: "1re MEC", kind: "date" },
  { key: "energy", label: "Énergie", kind: "text" },
  { key: "color", label: "Couleur", kind: "text" },
  { key: "fiscal_power", label: "Puissance fiscale (CV)", kind: "int" },
  { key: "power_hp", label: "Puissance (ch)", kind: "text" },
  { key: "power_kw", label: "Puissance (kW)", kind: "text" },
  { key: "engine_code", label: "Code moteur", kind: "text" },
  { key: "engine_size", label: "Cylindrée", kind: "text" },
  { key: "co2_g_km", label: "CO2 (g/km)", kind: "int" },
  { key: "weight_kg", label: "Poids (kg)", kind: "int" },
  { key: "curb_weight_kg", label: "Masse à vide (kg)", kind: "int" },
  { key: "gvw_kg", label: "PTAC (kg)", kind: "int" },
  { key: "cnit", label: "CNIT", kind: "text" },
  { key: "type_mine", label: "Type mine", kind: "text" },
  { key: "tvv", label: "TVV", kind: "text" },
  { key: "gearbox", label: "Boîte", kind: "text" },
  { key: "gearbox_code", label: "Code boîte", kind: "text" },
];

/** Valeurs initiales du formulaire à partir de la fiche. */
export function initialEditForm(v: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    EDIT_FIELDS.map((f) => {
      const x = v[f.key];
      const s = x == null ? "" : String(x);
      return [f.key, f.kind === "date" ? s.slice(0, 10) : s];
    }),
  );
}

function coerce(f: (typeof EDIT_FIELDS)[number], raw: string): string | number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (f.kind === "int") {
    const n = Number.parseInt(s.replace(/\s/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (f.kind === "date") return s.slice(0, 10);
  if (f.key === "registration_display") return formatRegistration(s);
  if (f.key === "vin") return s.toUpperCase();
  return s;
}

/** Construit le patch à partir du formulaire : uniquement les champs modifiés, normalisations incluses. */
export function buildRefVehiclePatch(
  before: Record<string, unknown>,
  form: Record<string, string>,
): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {};
  for (const f of EDIT_FIELDS) {
    if (!(f.key in form)) continue;
    const val = coerce(f, form[f.key] ?? "");
    const prev = before[f.key] == null ? null : coerce(f, String(before[f.key]));
    if (String(prev ?? "") !== String(val ?? "")) patch[f.key] = val;
  }
  if ("registration_display" in patch) {
    patch["registration_normalized"] = patch["registration_display"]
      ? normalizeRegistration(String(patch["registration_display"]))
      : null;
  }
  if ("vin" in patch) patch["vin_normalized"] = patch["vin"] ? normalizeVin(String(patch["vin"])) || null : null;
  return patch;
}

type MinimalClient = {
  from: (table: string) => {
    update: (p: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: { message: string } | null }> };
  };
};

/** Enregistre un patch sur la même ligne `ref_vehicles`. */
export async function saveRefVehicle(client: MinimalClient, id: string, patch: Record<string, unknown>) {
  if (!Object.keys(patch).length) return;
  const { error } = await client.from("ref_vehicles").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Date affichable d'une mesure kilométrique : jamais la date technique d'import. */
export function mileageDate(m: { measured_at: string | null }): string | null {
  return m.measured_at ? new Date(m.measured_at).toLocaleDateString("fr-FR") : null;
}
