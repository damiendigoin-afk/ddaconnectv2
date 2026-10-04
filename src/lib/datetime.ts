/**
 * Normalisation des dates saisies : indépendante du format régional du
 * téléphone. On n'exploite jamais le texte affiché (JJ/MM/AAAA, DD.MM.YYYY…),
 * uniquement la valeur native des champs `date` / `datetime-local`.
 */

/** Valeur `<input type="date">` → `YYYY-MM-DD` (ou null). */
export function isoDate(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Secours : format régional saisi manuellement (JJ/MM/AAAA ou JJ.MM.AAAA).
  const f = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (f) return `${f[3]}-${f[2]!.padStart(2, "0")}-${f[1]!.padStart(2, "0")}`;
  return null;
}

/** Valeur `<input type="datetime-local">` → timestamp ISO UTC (ou null). */
export function isoTimestamp(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const day = isoDate(v);
  if (day) return new Date(`${day}T00:00:00`).toISOString();
  return null;
}

/** Fuseau des ateliers DDA : toutes les heures d'OR sont des heures locales France, quel que soit l'appareil. */
export const WORKSHOP_TZ = "Europe/Paris";

function tzOffsetMinutes(utcMs: number, tz = WORKSHOP_TZ): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p["year"]!, +p["month"]! - 1, +p["day"]!, +p["hour"]! % 24, +p["minute"]!, +p["second"]!);
  return Math.round((asUtc - utcMs) / 60000);
}

/** Heure murale atelier (YYYY-MM-DD[THH:mm]) → ISO UTC, indépendant du fuseau de l'appareil. */
export function workshopLocalToIso(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v) ?? (() => { const d = isoDate(v); return d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null; })();
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0));
  let t = guess - tzOffsetMinutes(guess) * 60000;
  t = guess - tzOffsetMinutes(t) * 60000;
  return new Date(t).toISOString();
}

/** Timestamp → « JJ/MM/AAAA HH:mm » heure atelier ; date seule si minuit pile (restitution sans heure). */
const parseTs = (ts: string) => new Date(ts.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
export function formatWorkshopDateTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = parseTs(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("fr-FR", { timeZone: WORKSHOP_TZ });
  const time = d.toLocaleTimeString("fr-FR", { timeZone: WORKSHOP_TZ, hour: "2-digit", minute: "2-digit" });
  return time === "00:00" ? date : `${date} ${time}`;
}

/** Date calendaire (YYYY-MM-DD) → « JJ/MM/AAAA » sans décalage de fuseau. */
export function formatDateOnly(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** Timestamp UTC → valeur `datetime-local` en heure atelier. */
export function isoToWorkshopLocal(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = parseTs(ts);
  if (Number.isNaN(d.getTime())) return "";
  const l = new Date(d.getTime() + tzOffsetMinutes(d.getTime()) * 60000).toISOString();
  return l.slice(0, 16);
}
