import { supabase } from "@/integrations/supabase/client";

/* ------------------------------------------------------------------ */
/* Recouvrement — balance âgée des dossiers carrosserie                 */
/* ------------------------------------------------------------------ */

export type Receivable = {
  case_id: string;
  site_id: string | null;
  plate: string | null;
  customer_name: string | null;
  or_number: string | null;
  claim_number: string | null;
  case_state: string;
  reference_at: string;
  days: number;
  bucket: AgeBucket;
  total_ttc: number;
  expected: number;
  received: number;
  outstanding: number;
  parts: { key: string; label: string; expected: number; received: number; outstanding: number }[];
};

export type AgeBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AGE_BUCKETS: AgeBucket[] = ["0-30", "31-60", "61-90", "90+"];

const PAYER_PARTS = [
  { key: "insurer", label: "Assureur" },
  { key: "franchise", label: "Franchise" },
  { key: "depreciation", label: "Vétusté" },
  { key: "vat", label: "TVA" },
  { key: "other", label: "Autre" },
] as const;

function bucketOf(days: number): AgeBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Créances ouvertes : montants attendus non encaissés, classés par ancienneté. */
export async function listReceivables(siteId?: string | null): Promise<Receivable[]> {
  let q = supabase
    .from("bodyshop_cases")
    .select(
      "id, site_id, plate, customer_name, or_number, claim_number, case_state, mission_date, closed_at, created_at, amount_total_ttc, amount_insurer_expected, amount_insurer_received, amount_franchise_expected, amount_franchise_received, amount_depreciation_expected, amount_depreciation_received, amount_vat_expected, amount_vat_received, amount_other_expected, amount_other_received",
    )
    .order("mission_date", { ascending: true })
    .limit(1000);
  if (siteId) q = q.eq("site_id", siteId);
  const { data, error } = await q;
  if (error) throw error;

  const now = Date.now();
  const rows: Receivable[] = [];
  for (const c of (data ?? []) as Record<string, unknown>[]) {
    const parts = PAYER_PARTS.map((p) => {
      const expected = num(c[`amount_${p.key}_expected`]);
      const received = num(c[`amount_${p.key}_received`]);
      return { key: p.key, label: p.label, expected, received, outstanding: Math.max(0, expected - received) };
    });
    const expected = parts.reduce((s, p) => s + p.expected, 0);
    const received = parts.reduce((s, p) => s + p.received, 0);
    const outstanding = parts.reduce((s, p) => s + p.outstanding, 0);
    if (outstanding <= 0.5) continue;
    const ref = (c['closed_at'] as string | null) || (c['mission_date'] as string | null) || (c['created_at'] as string);
    const days = Math.max(0, Math.floor((now - new Date(ref).getTime()) / 86_400_000));
    rows.push({
      case_id: c['id'] as string,
      site_id: (c['site_id'] as string | null) ?? null,
      plate: (c['plate'] as string | null) ?? null,
      customer_name: (c['customer_name'] as string | null) ?? null,
      or_number: (c['or_number'] as string | null) ?? null,
      claim_number: (c['claim_number'] as string | null) ?? null,
      case_state: (c['case_state'] as string) ?? "",
      reference_at: ref,
      days,
      bucket: bucketOf(days),
      total_ttc: num(c['amount_total_ttc']),
      expected,
      received,
      outstanding,
      parts: parts.filter((p) => p.outstanding > 0.5),
    });
  }
  return rows.sort((a, b) => b.days - a.days);
}

export function agedTotals(rows: Receivable[]) {
  const byBucket: Record<AgeBucket, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const byPayer = new Map<string, { label: string; outstanding: number }>();
  for (const r of rows) {
    byBucket[r.bucket] += r.outstanding;
    for (const p of r.parts) {
      const cur = byPayer.get(p.key) ?? { label: p.label, outstanding: 0 };
      cur.outstanding += p.outstanding;
      byPayer.set(p.key, cur);
    }
  }
  return {
    total: rows.reduce((s, r) => s + r.outstanding, 0),
    byBucket,
    byPayer: [...byPayer.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.outstanding - a.outstanding),
  };
}

/* ------------------------------------------------------------------ */
/* Pilotage Groupe — année en cours vs N-1                              */
/* ------------------------------------------------------------------ */

export type PilotageRow = {
  key: string;
  label: string;
  current: number;
  previous: number;
  unit: "count" | "eur";
};

export type PilotageResult = {
  year: number;
  compareYear: number;
  ytd: boolean;
  rows: PilotageRow[];
  monthly: { month: number; current: number; previous: number }[];
};

async function countBetween(table: string, column: string, from: string, to: string, siteId?: string | null) {
  let q = supabase.from(table as never).select("id", { count: "exact", head: true }).gte(column, from).lt(column, to);
  if (siteId) q = (q as unknown as { eq: (c: string, v: string) => typeof q }).eq("site_id", siteId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Indicateurs Groupe N vs année de référence (N-1, N-2…), année complète ou YTD. */
export async function fetchPilotage(opts: {
  year: number;
  compareYear?: number;
  ytd?: boolean;
  siteId?: string | null;
}): Promise<PilotageResult> {
  const year = opts.year;
  const compareYear = opts.compareYear ?? year - 1;
  const ytd = opts.ytd ?? false;
  const siteId = opts.siteId ?? null;
  const now = new Date();
  const cutoff = (y: number) => {
    if (!ytd) return `${y + 1}-01-01`;
    const d = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  const span = (y: number) => [`${y}-01-01`, cutoff(y)] as const;
  const [cy0, cy1] = span(year);
  const [py0, py1] = span(compareYear);

  const [casesCur, casesPrev, toursCur, toursPrev, expCur, expPrev, crmCur, crmPrev] = await Promise.all([
    countBetween("bodyshop_cases", "created_at", cy0, cy1, siteId),
    countBetween("bodyshop_cases", "created_at", py0, py1, siteId),
    countBetween("vehicle_inspections", "created_at", cy0, cy1, null),
    countBetween("vehicle_inspections", "created_at", py0, py1, null),
    countBetween("vehicle_expertises", "created_at", cy0, cy1, null),
    countBetween("vehicle_expertises", "created_at", py0, py1, null),
    countBetween("crm_requests", "created_at", cy0, cy1, siteId),
    countBetween("crm_requests", "created_at", py0, py1, siteId),
  ]);

  let revenueQ = supabase
    .from("bodyshop_cases")
    .select("created_at, amount_total_ttc")
    .gte("created_at", py0 < cy0 ? py0 : cy0)
    .lt("created_at", cy1 > py1 ? cy1 : py1)
    .limit(5000);
  if (siteId) revenueQ = revenueQ.eq("site_id", siteId);
  const { data: revRows, error: revErr } = await revenueQ;
  if (revErr) throw revErr;

  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, current: 0, previous: 0 }));
  let caCur = 0;
  let caPrev = 0;
  for (const r of (revRows ?? []) as { created_at: string; amount_total_ttc: number | null }[]) {
    const d = new Date(r.created_at);
    const amount = num(r.amount_total_ttc);
    const slot = monthly[d.getUTCMonth()];
    if (!slot) continue;
    const iso = r.created_at.slice(0, 10);
    if (d.getUTCFullYear() === year && iso >= cy0 && iso < cy1) {
      caCur += amount;
      slot.current += amount;
    } else if (d.getUTCFullYear() === compareYear && iso >= py0 && iso < py1) {
      caPrev += amount;
      slot.previous += amount;
    }
  }

  return {
    year,
    compareYear,
    ytd,
    monthly,
    rows: [
      { key: "cases", label: "Dossiers carrosserie", current: casesCur, previous: casesPrev, unit: "count" },
      { key: "revenue", label: "CA carrosserie TTC", current: caCur, previous: caPrev, unit: "eur" },
      { key: "tours", label: "Tours véhicule", current: toursCur, previous: toursPrev, unit: "count" },
      { key: "expertises", label: "Expertises", current: expCur, previous: expPrev, unit: "count" },
      { key: "crm", label: "Demandes clients", current: crmCur, previous: crmPrev, unit: "count" },
    ],
  };
}

export function variation(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/* ------------------------------------------------------------------ */
/* Santé plateforme — volumes, quotas et incidents                      */
/* ------------------------------------------------------------------ */

export type HealthMetric = {
  key: string;
  label: string;
  value: number;
  quota: number | null;
  unit: "count" | "mo";
  hint: string;
};

const MB = 1024 * 1024;

/** Quotas indicatifs pour l'alerte (modifiables ici, pas de secret exposé). */
export const HEALTH_QUOTAS = {
  emails_month: 5000,
  resend_month: 3000,
  storage_mo: 5000,
  inbox_pending: 50,
};

export async function fetchPlatformHealth(): Promise<{ metrics: HealthMetric[]; failedRuns: number; lastRunAt: string | null }> {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [emails, receipts, docs, runs] = await Promise.all([
    supabase.from("emails").select("id", { count: "exact", head: true }).gte("sent_at", from),
    supabase.from("email_logs").select("id", { count: "exact", head: true }).gte("created_at", from),
    supabase.from("inbox_documents").select("file_size, status").limit(5000),
    supabase.from("automation_runs").select("status, started_at").gte("started_at", from).order("started_at", { ascending: false }).limit(500),
  ]);

  const docRows = (docs.data ?? []) as { file_size: number | null; status: string }[];
  const storageMo = docRows.reduce((s, d) => s + num(d.file_size), 0) / MB;
  const pending = docRows.filter((d) => d.status === "a_classer").length;
  const runRows = (runs.data ?? []) as { status: string; started_at: string }[];

  return {
    failedRuns: runRows.filter((r) => r.status === "erreur" || r.status === "error" || r.status === "echec").length,
    lastRunAt: runRows[0]?.started_at ?? null,
    metrics: [
      {
        key: "emails",
        label: "Emails reçus (30 j)",
        value: emails.count ?? 0,
        quota: HEALTH_QUOTAS.emails_month,
        unit: "count",
        hint: "Volume ingéré par le module Flux emails",
      },
      {
        key: "resend",
        label: "Emails envoyés (30 j)",
        value: receipts.count ?? 0,
        quota: HEALTH_QUOTAS.resend_month,
        unit: "count",
        hint: "Rapports et communications envoyés depuis l'application",
      },
      {
        key: "storage",
        label: "Stockage documents",
        value: Math.round(storageMo),
        quota: HEALTH_QUOTAS.storage_mo,
        unit: "mo",
        hint: "Taille cumulée des documents scannés",
      },
      {
        key: "inbox",
        label: "Documents à classer",
        value: pending,
        quota: HEALTH_QUOTAS.inbox_pending,
        unit: "count",
        hint: "File d'attente du module Qualité des données",
      },
    ],
  };
}

export function healthTone(m: HealthMetric) {
  if (!m.quota) return "ok" as const;
  const ratio = m.value / m.quota;
  if (ratio >= 1) return "critique" as const;
  if (ratio >= 0.8) return "alerte" as const;
  return "ok" as const;
}

export const eur = (v: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

/* ------------------------------------------------------------------ */
/* Relances de créances — journal et priorisation                       */
/* ------------------------------------------------------------------ */

export type DunningInfo = { lastAt: string | null; count: number };

/** Dernière relance et nombre d'envois par dossier. */
export async function fetchDunningLog(caseIds: string[]): Promise<Map<string, DunningInfo>> {
  const map = new Map<string, DunningInfo>();
  if (!caseIds.length) return map;
  const { data, error } = await supabase
    .from("bodyshop_communications")
    .select("case_id, created_at, status")
    .eq("template_key", "relance_creance")
    .in("case_id", caseIds.slice(0, 300))
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  for (const r of (data ?? []) as { case_id: string; created_at: string; status: string }[]) {
    if (r.status === "echec") continue;
    const cur = map.get(r.case_id) ?? { lastAt: null, count: 0 };
    cur.count += 1;
    if (!cur.lastAt || r.created_at > cur.lastAt) cur.lastAt = r.created_at;
    map.set(r.case_id, cur);
  }
  return map;
}

export const DUNNING_MIN_DAYS = 30;
export const DUNNING_COOLDOWN_DAYS = 15;

/** Créance à relancer : plus de 30 j d'ancienneté et pas de relance récente. */
export function needsDunning(row: Receivable, info?: DunningInfo): boolean {
  if (row.days <= DUNNING_MIN_DAYS) return false;
  if (!info?.lastAt) return true;
  return Date.now() - new Date(info.lastAt).getTime() > DUNNING_COOLDOWN_DAYS * 86_400_000;
}

/* ------------------------------------------------------------------ */
/* Objectifs vs réalisé                                                 */
/* ------------------------------------------------------------------ */

export type Objective = { metric_key: string; target: number; unit: string | null };

/** Objectifs annuels paramétrés (metric_thresholds), site puis Groupe en repli. */
export async function fetchObjectives(siteId?: string | null): Promise<Map<string, Objective>> {
  const { data, error } = await supabase
    .from("metric_thresholds")
    .select("metric_key, target_value, unit, site_id, active")
    .eq("active", true)
    .limit(200);
  if (error) throw error;
  const map = new Map<string, Objective>();
  const rows = (data ?? []) as { metric_key: string; target_value: number | null; unit: string | null; site_id: string | null }[];
  for (const r of rows) {
    if (r.target_value == null) continue;
    if (r.site_id && r.site_id !== siteId) continue;
    const existing = map.get(r.metric_key);
    // une valeur spécifique au site prime sur la valeur Groupe
    if (existing && !r.site_id) continue;
    map.set(r.metric_key, { metric_key: r.metric_key, target: r.target_value, unit: r.unit });
  }
  return map;
}
