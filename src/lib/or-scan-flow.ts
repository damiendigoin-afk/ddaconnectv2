/**
 * Orchestration écran du scan OR (Atelier / Tour) : contrôles, journal privé, issue.
 * Le journal ne bloque jamais le parcours (échecs silencieux, sans données personnelles en console).
 */
import { finalizeOrScan, recordOrScan } from "./or-scan-log.functions";
import { assessOrScan, checkPlate, diffCritical, type OrScanData, type OrScanDoubt } from "./or-scan-validate";
import { lookupIxellioVehicle } from "./ixellio.functions";
import { cachedIxellioLookup, type IxellioLookupResponse } from "./ixellio-lookup-cache";
import { normalizePlate } from "./plate";
import { crossIxellio, type IxellioCross } from "./vehicle-dates";

export type OrScanTrace = { local_text_len?: number | null; local_plate?: string | null; rules_json?: string | null; route?: string | null; missing?: string[]; ai_calls?: number | null };

const parseRules = (j: string | null | undefined): Record<string, unknown> | null => {
  try { return j ? (JSON.parse(j) as Record<string, unknown>) : null; } catch { return null; }
};

export function prepareOrScan(input: {
  data: OrScanData;
  orNumber: string | null;
  trace: OrScanTrace | undefined;
  siteId: string | null | undefined;
  entry: "atelier" | "tour";
  userName: string | null;
  dataUrl: string;
}): { data: OrScanData; doubts: OrScanDoubt[]; log: Promise<string | null> } {
  const a = assessOrScan({ data: input.data, orNumber: input.orNumber, localPlate: input.trace?.local_plate ?? null });
  const log = input.siteId
    ? recordOrScan({
        data: {
          siteId: input.siteId, entry: input.entry, userName: input.userName, dataUrl: input.dataUrl, orNumber: input.orNumber,
          trace: { local_text_len: input.trace?.local_text_len ?? null, route: input.trace?.route ?? null, ai_calls: input.trace?.ai_calls ?? null, missing: input.trace?.missing ?? [], rules_fields: parseRules(input.trace?.rules_json) },
          readFields: input.data as unknown as Record<string, unknown>,
          doubts: a.doubts as unknown as Record<string, unknown>[],
        },
      }).then((r) => r.id).catch(() => null)
    : Promise.resolve(null);
  return { data: a.data, doubts: a.doubts, log };
}

export function finishOrScan(log: Promise<string | null>, read: OrScanData, confirmed: OrScanData | null, outcome: string, repairOrderId?: string | null) {
  void log.then((id) => {
    if (!id) return;
    return finalizeOrScan({ data: { id, outcome, confirmedFields: confirmed as unknown as Record<string, unknown> | null, corrections: confirmed ? diffCritical(read, confirmed) : [], repairOrderId: repairOrderId ?? null } }).catch(() => undefined);
  });
}

/* ---------------- Croisement Ixellio (serveur, identifiants stockés) ---------------- */

export const IXELLIO_SCAN_TIMEOUT_MS = 15000;

/**
 * Interroge Ixellio pour une plaque valide (cache onglet + une requête en vol par plaque),
 * sans jamais bloquer le scan : échec / délai => statut « indisponible ».
 */
export async function scanIxellio(
  data: OrScanData,
  orNumber: string | null,
  run: (plate: string) => Promise<IxellioLookupResponse> = (plate) => lookupIxellioVehicle({ data: { plate } }) as Promise<IxellioLookupResponse>,
  timeoutMs = IXELLIO_SCAN_TIMEOUT_MS,
): Promise<{ cross: IxellioCross; doubts: OrScanDoubt[] }> {
  const v = data.vehicle;
  const plate = normalizePlate(String(v["plate"] ?? ""));
  if (!plate || checkPlate(plate, { orNumber, account: data.client["account_number"] }) !== "ok") {
    return { cross: crossIxellio(v, null), doubts: [] };
  }
  let res: IxellioLookupResponse | null;
  try {
    res = await Promise.race([
      cachedIxellioLookup(plate, run),
      new Promise<IxellioLookupResponse>((resolve) => setTimeout(() => resolve({ ok: false, outcome: "timeout", message: "délai dépassé", vehicle: {} }), timeoutMs)),
    ]);
  } catch {
    res = { ok: false, outcome: "network_error", message: "indisponible", vehicle: {} };
  }
  const cross = crossIxellio(v, res);
  const doubts: OrScanDoubt[] = [];
  if (cross.vinMismatch) doubts.push({ field: "vin", code: "ixellio_vin_mismatch", message: cross.message, blocking: true });
  else if (cross.mec === "conflict") doubts.push({ field: "first_registration", code: "ixellio_mec_conflict", message: cross.message, blocking: true });
  if (cross.status === "unavailable") doubts.push({ field: "first_registration", code: "ixellio_unavailable", message: cross.message, blocking: false });
  return { cross, doubts };
}
