/** Import tolérant aux erreurs du fichier « SUIVI MISSIONS CARROSSERIE ».
 *  Une ligne en erreur n'interrompt jamais les suivantes. */
import { supabase } from "@/integrations/supabase/client";
import {
  buildHeaderIndex,
  diagnoseHeaders,
  mapMissionRow,
  plateTrace,
  type MissionFix,
  type MissionMapped,
  type RawRow,
} from "./mapping";

export type MissionCounters = {
  imported: number;
  updated: number;
  toFix: number;
  duplicates: number;
  skipped: number;
};

export type MissionConflict = {
  rowNumber: number;
  caseId: string;
  plate: string;
  field: string;
  label: string;
  appValue: string;
  fileValue: string;
};

export type MissionErrorRow = {
  id: string;
  rowNumber: number;
  /** Index de la ligne dans le tableau transmis : permet de renvoyer une correction. */
  rowIndex: number;
  raw: RawRow;
  errors: string[];
  identity: string;
  /** Valeurs pré-remplies dans le formulaire de correction. */
  fix: MissionFix;
};

export type MissionIngestResult = {
  importId: string;
  counters: MissionCounters;
  conflicts: MissionConflict[];
  errorRows: MissionErrorRow[];
};

const FIELD_LABELS: Record<string, string> = {
  case_state: "Statut du dossier",
  claim_number: "N° de sinistre",
  mission_number: "N° de mission",
  franchise: "Franchise",
  depreciation: "Vétusté",
  amount_total_ht: "Montant HT",
  amount_total_ttc: "Montant TTC",
  amount_insurer_expected: "Montant assurance attendu",
  appointment_at: "RDV",
  entry_at: "Entrée atelier",
  expected_return_at: "Sortie prévue",
  comments: "Commentaires",
  customer_name: "Client",
  customer_phone: "Téléphone",
  customer_email: "E-mail",
  vehicle_label: "Véhicule",
  vin: "VIN",
  or_number: "N° OR",
  is_vge: "VGE",
  is_hail: "Grêle",
  subcontractor: "Sous-traitance",
  work_location: "Lieu des travaux",
};

function toIso(d: string | null): string | null {
  return d ? new Date(`${d}T08:00:00Z`).toISOString() : null;
}

/** Retrouve le véhicule du référentiel par immatriculation normalisée, sinon le crée. */
async function ensureRefVehicle(m: MissionMapped, siteId: string | null): Promise<string> {
  if (!m.plateNormalized) throw new Error("Immatriculation normalisée absente.");
    const { data: found } = await supabase
      .from("ref_vehicles")
      .select("id, registration_display")
      .eq("registration_normalized", m.plateNormalized)
      .limit(1);
    const existing = found?.[0];
    if (existing) {
      if (!existing.registration_display && m.plateSource) {
        await supabase.from("ref_vehicles").update({ registration_display: m.plateSource }).eq("id", existing.id);
      }
      return existing.id as string;
    }
    const { data: created, error } = await supabase
      .from("ref_vehicles")
      .insert({
        site_id: siteId,
        source_system: "suivi_missions",
        registration_display: m.plateSource || m.plate,
        registration_normalized: m.plateNormalized,
        vin: m.vin || null,
        vin_normalized: m.vin || null,
        model: m.vehicleLabel || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    if (!created?.id) throw new Error("Le véhicule n'a pas pu être créé dans le référentiel.");
    return created.id as string;
}

/** Valeurs candidates issues du fichier pour un dossier. */
function filePatch(m: MissionMapped): Record<string, unknown> {
  return {
    vin: m.vin || null,
    or_number: m.orNumber || null,
    customer_name: m.customerName || null,
    customer_phone: m.customerPhone || null,
    customer_email: m.customerEmail || null,
    vehicle_label: m.vehicleLabel || null,
    appointment_at: toIso(m.appointmentAt),
    entry_at: toIso(m.entryAt),
    expected_return_at: toIso(m.expectedReturnAt),
    case_state: m.caseState,
    claim_number: m.claimNumber || null,
    mission_number: m.missionNumber || null,
    franchise: m.franchise,
    depreciation: m.depreciation,
    amount_total_ht: m.amountTotalHt,
    amount_total_ttc: m.amountTotalTtc,
    amount_insurer_expected: m.amountInsurerExpected,
    is_vge: m.isVge,
    is_hail: m.isHail,
    work_location: m.workLocation,
    subcontractor: m.subcontractor || null,
    comments: m.comments || null,
  };
}

async function resolveReferentials(m: MissionMapped) {
  const out: { insurer_id: string | null; expert_firm_id: string | null; agreement_id: string | null } = {
    insurer_id: null,
    expert_firm_id: null,
    agreement_id: null,
  };
  try {
    if (m.insurerName) {
      const { data } = await supabase.from("insurers").select("id").ilike("name", `%${m.insurerName}%`).limit(1);
      out.insurer_id = data?.[0]?.id ?? null;
    }
    if (m.expertFirmName) {
      const { data } = await supabase.from("expert_firms").select("id").ilike("name", `%${m.expertFirmName}%`).limit(1);
      out.expert_firm_id = data?.[0]?.id ?? null;
    }
    if (m.agreementName) {
      const { data } = await supabase.from("agreements").select("id").ilike("name", `%${m.agreementName}%`).limit(1);
      out.agreement_id = data?.[0]?.id ?? null;
    }
  } catch {
    /* les référentiels manquants ne doivent jamais bloquer une ligne */
  }
  return out;
}

async function findExistingCase(m: MissionMapped) {
  const filters: string[] = [];
  if (m.orNumber) filters.push(`or_number.eq.${m.orNumber}`);
  if (m.plateNormalized) filters.push(`plate.eq.${m.plateNormalized}`);
  if (m.vin) filters.push(`vin.eq.${m.vin}`);
  if (!filters.length) return null;
  const { data } = await supabase
    .from("bodyshop_cases")
    .select("*")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function ingestMissions(
  file: { name: string; size: number },
  headers: string[],
  rows: RawRow[],
  siteId: string | null,
  onProgress?: (done: number, total: number) => void,
  fixes?: Record<number, MissionFix>,
): Promise<MissionIngestResult> {
  const { data: auth } = await supabase.auth.getUser();
  const { data: imp, error: impErr } = await supabase
    .from("imports")
    .insert({
      site_id: siteId,
      source_system: "suivi_missions",
      file_name: file.name,
      file_size: file.size,
      status: "running",
      total_rows: rows.length,
      total_columns: headers.length,
      created_by: auth.user?.id ?? null,
      created_by_name: auth.user?.email ?? null,
    })
    .select()
    .single();
  if (impErr || !imp) throw impErr ?? new Error("Import impossible");

  const index = buildHeaderIndex(headers, rows);
  const diagnostic = diagnoseHeaders(headers, rows);
  console.info("[Import Suivi Missions] colonnes reçues :", headers);
  console.info(
    `[Import Suivi Missions] colonne immatriculation : ${diagnostic.plateColumn ?? "AUCUNE"} (${diagnostic.plateDetection})`,
  );
  for (const s of diagnostic.samples) {
    console.info(
      `[Import Suivi Missions] ligne ${s.row} — source "${s.source}" · trim "${s.trimmed}" · normalisée "${s.normalized}"`,
    );
  }
  const counters: MissionCounters = { imported: 0, updated: 0, toFix: 0, duplicates: 0, skipped: 0 };
  const conflicts: MissionConflict[] = [];
  const errorRows: MissionErrorRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const raw = rows[i]!;
    let mapped: MissionMapped | null = null;
    try {
      mapped = mapMissionRow(raw, index, fixes?.[i]);
      const trace = plateTrace(raw, index, fixes?.[i]);
      console.info("[Import Suivi Missions] plaque", {
        rowNumber,
        detectedColumn: trace.column,
        raw: trace.raw,
        cleaned: trace.cleaned,
        normalized: trace.normalized,
        stored: trace.stored,
      });
      if (mapped.errors.length) throw new Error("validation");

      const key = mapped.orNumber || mapped.plateNormalized;
      if (key && seen.has(key)) {
        counters.duplicates++;
        await logRow(imp.id, rowNumber, raw, "duplicate", ["Doublon dans le fichier."]);
        continue;
      }
      if (key) seen.add(key);

      if (i < 3) {
        console.info(
          `[Import Suivi Missions] ligne ${rowNumber} — enregistrée "${mapped.plateNormalized}" (source "${mapped.plateSource}")`,
        );
      }
      const existing = await findExistingCase(mapped);
      const patch = filePatch(mapped);
      const refs = await resolveReferentials(mapped);
      const refVehicleId = await ensureRefVehicle(mapped, siteId);

      if (existing) {
        const update: Record<string, unknown> = {};
        for (const [field, fileValue] of Object.entries(patch)) {
          const appValue = (existing as Record<string, unknown>)[field];
          const fileEmpty = fileValue === null || fileValue === "" || fileValue === false;
          const appEmpty = appValue === null || appValue === "" || appValue === false;
          if (fileEmpty) continue;
          if (appEmpty) {
            update[field] = fileValue;
            continue;
          }
          if (String(appValue) !== String(fileValue)) {
            // JAMAIS d'écrasement silencieux : l'utilisateur tranchera.
            conflicts.push({
              rowNumber,
              caseId: existing.id as string,
              plate: mapped.plate,
              field,
              label: FIELD_LABELS[field] ?? field,
              appValue: String(appValue),
              fileValue: String(fileValue),
            });
          }
        }
        for (const [k, v] of Object.entries(refs)) if (v && !(existing as Record<string, unknown>)[k]) update[k] = v;
        if (refVehicleId && !(existing as Record<string, unknown>)["ref_vehicle_id"]) update["ref_vehicle_id"] = refVehicleId;
        if (Object.keys(update).length) {
          const { error } = await supabase
            .from("bodyshop_cases")
            .update(update as never)
            .eq("id", existing.id as string);
          if (error) throw error;
        }
        counters.updated++;
        await logRow(imp.id, rowNumber, raw, "imported", [], trace);
      } else {
        const { error } = await supabase.from("bodyshop_cases").insert({
          site_id: siteId,
          plate: mapped.plateNormalized,
          ref_vehicle_id: refVehicleId,
          mission_date: mapped.missionDate ?? new Date().toISOString().slice(0, 10),
          mission_origin: "import_suivi",
          physical_state: mapped.physicalState,
          payer: mapped.payer || null,
          created_by: auth.user?.id ?? null,
          created_by_name: auth.user?.email ?? null,
          ...patch,
          ...refs,
        });
        if (error) throw error;
        counters.imported++;
        await logRow(imp.id, rowNumber, raw, "imported", [], trace);
      }
    } catch (e) {
      // Une ligne en erreur ne bloque jamais les suivantes.
      const messages = mapped?.errors.length
        ? mapped.errors
        : [e instanceof Error && e.message !== "validation" ? e.message : "Ligne non importable."];
      counters.toFix++;
      const inserted = await logRow(imp.id, rowNumber, raw, "error", messages);
      errorRows.push({
        id: inserted,
        rowNumber,
        rowIndex: i,
        raw,
        errors: messages,
        identity: [mapped?.plate, mapped?.customerName].filter(Boolean).join(" · ") || "—",
        fix: {
          plate: fixes?.[i]?.plate ?? mapped?.plate ?? "",
          missionDate: fixes?.[i]?.missionDate ?? mapped?.missionDate ?? "",
          customerName: fixes?.[i]?.customerName ?? mapped?.customerName ?? "",
        },
      });
    } finally {
      onProgress?.(i + 1, rows.length);
    }
  }

  await supabase
    .from("imports")
    .update({
      status: "completed",
      processed_rows: counters.imported + counters.updated,
      duplicates_avoided: counters.duplicates,
      anomalies: counters.toFix,
      completed_at: new Date().toISOString(),
      analysis: { counters, conflicts: conflicts.length } as never,
    })
    .eq("id", imp.id);

  return { importId: imp.id as string, counters, conflicts, errorRows };
}

async function logRow(
  importId: string,
  rowNumber: number,
  raw: RawRow,
  status: string,
  errors: string[],
  trace?: ReturnType<typeof plateTrace>,
): Promise<string> {
  try {
    const { data } = await supabase
      .from("import_rows")
      .insert({
        import_id: importId,
        row_number: rowNumber,
        raw_data: { ...raw, __plate_trace: trace ?? null } as never,
        processing_status: status,
        processing_errors: errors,
      })
      .select("id")
      .single();
    return (data?.id as string) ?? "";
  } catch {
    return "";
  }
}

/** Réimport des seules lignes corrigées. */
export async function reingestMissionRows(
  importId: string,
  headers: string[],
  siteId: string | null,
  rowIds: string[],
): Promise<MissionIngestResult> {
  const { data } = await supabase.from("import_rows").select("*").in("id", rowIds);
  const rows = (data ?? []).map((r) => ({
    ...((r.raw_data ?? {}) as RawRow),
    ...(((r as { corrected_data?: RawRow }).corrected_data ?? {}) as RawRow),
  }));
  const res = await ingestMissions({ name: "Lignes corrigées", size: 0 }, headers, rows, siteId);
  await supabase
    .from("import_rows")
    .update({ processing_status: "fixed", resolved_at: new Date().toISOString() } as never)
    .in("id", rowIds);
  return { ...res, importId };
}

/** Applique le choix de l'utilisateur sur un conflit (valeur du fichier retenue). */
export async function applyConflict(conflict: MissionConflict) {
  await supabase
    .from("bodyshop_cases")
    .update({ [conflict.field]: castValue(conflict.field, conflict.fileValue) } as never)
    .eq("id", conflict.caseId);
}

function castValue(field: string, value: string): unknown {
  if (["franchise", "depreciation", "amount_total_ht", "amount_total_ttc", "amount_insurer_expected"].includes(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (["is_vge", "is_hail"].includes(field)) return value === "true";
  return value;
}