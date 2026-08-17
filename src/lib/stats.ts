import { supabase } from "@/integrations/supabase/client";
import { BUCKET } from "./photo";

export type ProdEntry = {
  id: string;
  import_id: string;
  site_id: string | null;
  user_id: string | null;
  winmotor_name: string;
  period_start: string;
  period_end: string;
  hours_purchased: number | null;
  hours_spent: number | null;
  hours_billed: number | null;
  productivity_ratio: number | null;
  profitability_ratio: number | null;
};

export type ProdImport = {
  id: string;
  site_id: string | null;
  site_label: string | null;
  period_start: string;
  period_end: string;
  kind: string;
  status: string;
  file_name: string | null;
  storage_path: string | null;
  totals: unknown;
  imported_by_name: string | null;
  created_at: string;
};

export type Operator = {
  id: string;
  alias: string;
  normalized: string;
  user_id: string | null;
  site_id: string | null;
};

/** Normalisation d'identité : accents, casse, ponctuation, ordre NOM/PRÉNOM indifférent. */
export function normPerson(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export function periodLabel(start: string, end?: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = end ? new Date(`${end}T00:00:00`) : s;
  const label = `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
  if (end && (e.getMonth() !== s.getMonth() || e.getFullYear() !== s.getFullYear())) {
    return `${label} → ${MONTHS[e.getMonth()]} ${e.getFullYear()}`;
  }
  return label;
}

export function pct(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? "—" : `${Math.round(ratio * 100)} %`;
}

export function hours(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function endOfMonth(start: string): string {
  const d = new Date(`${start}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ lecture */

export async function fetchMyEntries(userId: string): Promise<ProdEntry[]> {
  const { data, error } = await supabase
    .from("productivity_entries")
    .select("*")
    .eq("user_id", userId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProdEntry[];
}

export async function fetchEntriesForPeriod(periodStart: string): Promise<ProdEntry[]> {
  const { data, error } = await supabase
    .from("productivity_entries")
    .select("*")
    .eq("period_start", periodStart)
    .order("winmotor_name");
  if (error) throw error;
  return (data ?? []) as ProdEntry[];
}

export async function fetchImports(): Promise<ProdImport[]> {
  const { data, error } = await supabase
    .from("productivity_imports")
    .select("*")
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProdImport[];
}

export async function fetchOperators(): Promise<Operator[]> {
  const { data, error } = await supabase.from("winmotor_operators").select("*").order("alias");
  if (error) throw error;
  return (data ?? []) as Operator[];
}

/** Mémorise définitivement le rapprochement productif Winmotor ↔ utilisateur DDA. */
export async function linkOperator(alias: string, siteId: string | null, userId: string | null) {
  const existing = await supabase
    .from("winmotor_operators")
    .select("id")
    .eq("normalized", normPerson(alias))
    .maybeSingle();
  if (existing.data?.id) {
    const { error } = await supabase
      .from("winmotor_operators")
      .update({ user_id: userId })
      .eq("id", existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("winmotor_operators")
      .insert({ alias, site_id: siteId, user_id: userId });
    if (error) throw error;
  }
  // rattachement rétroactif de l'historique déjà importé
  const { error: e2 } = await supabase
    .from("productivity_entries")
    .update({ user_id: userId })
    .eq("winmotor_name", alias);
  if (e2) throw e2;
}

/* ------------------------------------------------------ import mensuel PDF */

export type ImportRow = {
  name: string;
  userId: string | null;
  hours_purchased: number | null;
  hours_spent: number | null;
  hours_billed: number | null;
  productivity: number | null;
  profitability: number | null;
};

export type ParsedReport = {
  site: string | null;
  period_start: string | null;
  period_end: string | null;
  rows: ImportRow[];
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseReportJson(json: string, operators: Operator[]): ParsedReport {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const byNorm = new Map(operators.map((o) => [o.normalized, o.user_id]));
  const rows = Array.isArray(raw["rows"]) ? (raw["rows"] as Record<string, unknown>[]) : [];
  return {
    site: (raw["site"] as string) ?? null,
    period_start: (raw["period_start"] as string) ?? null,
    period_end: (raw["period_end"] as string) ?? null,
    rows: rows
      .map((r) => String(r["name"] ?? "").trim() && r)
      .filter(Boolean)
      .map((r) => {
        const row = r as Record<string, unknown>;
        const name = String(row["name"]).trim().toUpperCase();
        return {
          name,
          userId: byNorm.get(normPerson(name)) ?? null,
          hours_purchased: num(row["hours_purchased"]),
          hours_spent: num(row["hours_spent"]),
          hours_billed: num(row["hours_billed"]),
          productivity: num(row["productivity"]),
          profitability: num(row["profitability"]),
        };
      }),
  };
}

export async function findExistingImport(siteId: string | null, periodStart: string) {
  const q = supabase
    .from("productivity_imports")
    .select("*")
    .eq("period_start", periodStart)
    .eq("status", "active")
    .eq("kind", "mensuel");
  const { data, error } = siteId ? await q.eq("site_id", siteId) : await q;
  if (error) throw error;
  return ((data ?? []) as ProdImport[])[0] ?? null;
}

export async function uploadReportFile(file: File): Promise<string | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const path = `productivite/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
  if (error) return null;
  return path;
}

export async function openReportFile(storagePath: string) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
}

/** Enregistre un import ; remplace l'existant en conservant sa trace dans l'historique. */
export async function saveImport(opts: {
  siteId: string | null;
  siteLabel: string | null;
  periodStart: string;
  periodEnd: string;
  rows: ImportRow[];
  fileName: string | null;
  storagePath: string | null;
  importedBy: string | null;
  importedByName: string | null;
  replaceId?: string | null;
}) {
  if (opts.replaceId) {
    const { error } = await supabase
      .from("productivity_imports")
      .update({ status: "replaced" })
      .eq("id", opts.replaceId);
    if (error) throw error;
  }

  const ins = await supabase
    .from("productivity_imports")
    .insert({
      site_id: opts.siteId,
      site_label: opts.siteLabel,
      period_start: opts.periodStart,
      period_end: opts.periodEnd,
      kind: "mensuel",
      status: "active",
      file_name: opts.fileName,
      storage_path: opts.storagePath,
      imported_by: opts.importedBy,
      imported_by_name: opts.importedByName,
      totals: {
        hours_purchased: sum(opts.rows.map((r) => r.hours_purchased)),
        hours_spent: sum(opts.rows.map((r) => r.hours_spent)),
        hours_billed: sum(opts.rows.map((r) => r.hours_billed)),
      },
    })
    .select("id")
    .single();
  if (ins.error) throw ins.error;
  const importId = ins.data.id as string;

  if (opts.replaceId) {
    await supabase.from("productivity_imports").update({ replaced_by: importId }).eq("id", opts.replaceId);
    await supabase.from("productivity_entries").delete().eq("import_id", opts.replaceId);
  }

  const { error } = await supabase.from("productivity_entries").insert(
    opts.rows.map((r) => ({
      import_id: importId,
      site_id: opts.siteId,
      user_id: r.userId,
      winmotor_name: r.name,
      period_start: opts.periodStart,
      period_end: opts.periodEnd,
      hours_purchased: r.hours_purchased,
      hours_spent: r.hours_spent,
      hours_billed: r.hours_billed,
      productivity_ratio: r.productivity,
      profitability_ratio: r.profitability,
    })),
  );
  if (error) throw error;

  // mémorisation des rapprochements validés à l'écran
  for (const r of opts.rows) {
    await linkOperatorIfNeeded(r.name, opts.siteId, r.userId);
  }
  return importId;
}

async function linkOperatorIfNeeded(alias: string, siteId: string | null, userId: string | null) {
  const { data } = await supabase
    .from("winmotor_operators")
    .select("id, user_id")
    .eq("normalized", normPerson(alias))
    .maybeSingle();
  if (!data) {
    await supabase.from("winmotor_operators").insert({ alias, site_id: siteId, user_id: userId });
  } else if (userId && data.user_id !== userId) {
    await supabase.from("winmotor_operators").update({ user_id: userId }).eq("id", data.id);
  }
}

function sum(values: (number | null)[]): number | null {
  const ok = values.filter((v): v is number => v !== null);
  return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/* ------------------------------------------------- réclamation mensuelle */

export type MissingReport = { siteId: string | null; siteLabel: string; periodStart: string };

/**
 * À partir du 1er du mois, réclame le rapport du mois précédent, par établissement.
 */
export async function fetchMissingReports(now = new Date()): Promise<MissingReport[]> {
  const previous = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const [{ data: sites }, { data: imports }] = await Promise.all([
    supabase.from("sites").select("id, name").eq("active", true),
    supabase
      .from("productivity_imports")
      .select("site_id, period_start")
      .eq("status", "active")
      .eq("kind", "mensuel"),
  ]);
  const done = new Set(((imports ?? []) as { site_id: string | null; period_start: string }[]).map(
    (i) => `${i.site_id}|${i.period_start}`,
  ));
  return ((sites ?? []) as { id: string; name: string }[])
    .filter((s) => !done.has(`${s.id}|${previous}`))
    .map((s) => ({ siteId: s.id, siteLabel: s.name, periodStart: previous }));
}

/* ------------------------------------------------- statistiques DDA (tours) */

export type TourStats = { today: number; week: number; month: number; avgSeconds: number | null };

export async function fetchTourStats(userId: string): Promise<TourStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data, error } = await supabase
    .from("vehicle_inspections")
    .select("completed_at, duration_seconds")
    .eq("completed_by", userId)
    .eq("status", "completed")
    .gte("completed_at", monthStart.toISOString());
  if (error) throw error;
  const rows = (data ?? []) as { completed_at: string | null; duration_seconds: number | null }[];
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (now.getDay() + 6) % 7;
  const weekStart = new Date(day.getTime() - dow * 86400000);
  let today = 0;
  let week = 0;
  const durations: number[] = [];
  for (const r of rows) {
    if (!r.completed_at) continue;
    const d = new Date(r.completed_at);
    if (d >= day) today++;
    if (d >= weekStart) week++;
    if (r.duration_seconds && r.duration_seconds > 0) durations.push(r.duration_seconds);
  }
  return {
    today,
    week,
    month: rows.length,
    avgSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  };
}

export function durationLabel(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}
