/**
 * Orchestration écran du scan OR (Atelier / Tour) : contrôles, journal privé, issue.
 * Le journal ne bloque jamais le parcours (échecs silencieux, sans données personnelles en console).
 */
import { finalizeOrScan, recordOrScan } from "./or-scan-log.functions";
import { assessOrScan, diffCritical, type OrScanData, type OrScanDoubt } from "./or-scan-validate";

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
