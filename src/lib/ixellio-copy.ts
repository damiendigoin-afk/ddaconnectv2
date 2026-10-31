/** Mise en forme des données IXELLIO pour affichage / copie (pur, sans I/O). Aucun champ inventé. */
export type IxellioFields = Record<string, string | undefined>;

/** Valeur affichée : telle que renvoyée ; CO2 nu => « g/km », cycle seulement s'il est fourni. */
export function ixellioDisplayValue(key: string, v: IxellioFields): string | null {
  const raw = v[key]?.trim();
  if (!raw) return null;
  if (key === "co2") {
    const withUnit = /^\d+([.,]\d+)?$/.test(raw) ? `${raw} g/km` : raw;
    const cycle = v["co2Cycle"]?.trim();
    return cycle ? `${withUnit} (${cycle})` : withUnit;
  }
  return raw;
}

/** Texte clair « Libellé : valeur », uniquement pour les champs présents. */
export function ixellioCopyText(plateLabel: string, v: IxellioFields, fields: [string, string][]): string {
  const lines = [`Immatriculation : ${plateLabel}`];
  for (const [k, label] of fields) {
    const val = ixellioDisplayValue(k, v);
    if (val) lines.push(`${label} : ${val}`);
  }
  return lines.join("\n");
}

/** Copie presse-papiers (API moderne, repli textarea pour anciens navigateurs / HTTP). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
