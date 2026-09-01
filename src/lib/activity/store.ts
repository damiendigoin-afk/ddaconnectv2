import { supabase } from "@/integrations/supabase/client";

import type { Anomaly, ParsedWorkbook, SiteCode } from "./parse";
import { autoStatus, type MonthStatus } from "./workdays";

export type ActivityMonth = {
  id: string;
  site_code: string;
  period_start: string;
  sheet_name: string | null;
  status: MonthStatus;
  status_manual: boolean;
  created_at: string;
  updated_at: string;
};

export type ActivityValue = { month_id: string; indicator_key: string; value: number | null };

export type ActivityImport = {
  id: string;
  site_code: string;
  file_name: string | null;
  imported_by_name: string | null;
  months_count: number;
  values_count: number;
  anomalies: Anomaly[];
  created_at: string;
};

/** Écriture d'un import : chaque mois réimporté remplace intégralement sa version précédente. */
export async function saveWorkbook(
  parsed: ParsedWorkbook,
  meta: { fileName: string | null; userId: string | null; userName: string | null },
): Promise<string> {
  const ins = await supabase
    .from("activity_imports")
    .insert({
      site_code: parsed.site,
      file_name: meta.fileName,
      imported_by: meta.userId,
      imported_by_name: meta.userName,
      months_count: parsed.months.length,
      values_count: parsed.valuesCount,
      anomalies: parsed.anomalies as never,
    })
    .select("id")
    .single();
  if (ins.error) throw ins.error;
  const importId = ins.data.id as string;

  for (const month of parsed.months) {
    const up = await supabase
      .from("activity_months")
      .upsert(
        {
          site_code: parsed.site,
          period_start: month.periodStart,
          sheet_name: month.sheet,
          import_id: importId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "site_code,period_start" },
      )
      .select("id, status_manual")
      .single();
    if (up.error) throw up.error;
    const monthId = up.data.id as string;

    if (!up.data.status_manual) {
      await supabase.from("activity_months").update({ status: autoStatus(month.periodStart) }).eq("id", monthId);
    }

    // dernière version seulement : on remplace toutes les valeurs du mois
    const del = await supabase.from("activity_values").delete().eq("month_id", monthId);
    if (del.error) throw del.error;
    const rows = Object.entries(month.values).map(([indicator_key, value]) => ({ month_id: monthId, indicator_key, value }));
    if (rows.length) {
      const insVals = await supabase.from("activity_values").insert(rows);
      if (insVals.error) throw insVals.error;
    }
  }
  return importId;
}

export type MonthData = { month: ActivityMonth; values: Map<string, number | null> };

/** Lecture des mois d'un site (ou de tous les sites pour la vue Groupe). */
export async function fetchMonths(siteCode: SiteCode | "groupe"): Promise<MonthData[]> {
  let q = supabase.from("activity_months").select("*").order("period_start");
  if (siteCode !== "groupe") q = q.eq("site_code", siteCode);
  const { data, error } = await q;
  if (error) throw error;
  const months = (data ?? []) as ActivityMonth[];
  if (!months.length) return [];

  const { data: vals, error: e2 } = await supabase
    .from("activity_values")
    .select("month_id, indicator_key, value")
    .in("month_id", months.map((m) => m.id));
  if (e2) throw e2;

  const byMonth = new Map<string, Map<string, number | null>>();
  for (const v of (vals ?? []) as ActivityValue[]) {
    const map = byMonth.get(v.month_id) ?? new Map<string, number | null>();
    map.set(v.indicator_key, v.value === null ? null : Number(v.value));
    byMonth.set(v.month_id, map);
  }
  return months.map((m) => ({ month: m, values: byMonth.get(m.id) ?? new Map() }));
}

export async function fetchImports(): Promise<ActivityImport[]> {
  const { data, error } = await supabase
    .from("activity_imports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, anomalies: (r.anomalies ?? []) as Anomaly[] })) as ActivityImport[];
}

export async function setMonthStatus(monthId: string, status: MonthStatus) {
  const { error } = await supabase
    .from("activity_months")
    .update({ status, status_manual: true, updated_at: new Date().toISOString() })
    .eq("id", monthId);
  if (error) throw error;
}
