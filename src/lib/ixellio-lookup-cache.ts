/**
 * Cache de session (mémoire onglet) des interrogations IXELLIO par immatriculation.
 * - Une seule requête en vol par plaque (double clic / composants concurrents).
 * - Seules les réponses définitives (trouvé / aucun véhicule) sont mises en cache :
 *   une erreur réseau, d'authentification ou de configuration reste réessayable.
 */
export type IxellioLookupResponse = {
  ok: boolean;
  outcome: string;
  notConfigured?: boolean;
  message: string;
  vehicle: Record<string, string | undefined>;
  detectedFields?: string[];
  fieldCount?: number;
  unmatchedLabels?: string[];
  isVersionList?: boolean;
};

const cache = new Map<string, IxellioLookupResponse>();
const inflight = new Map<string, Promise<IxellioLookupResponse>>();

export const isDefinitiveOutcome = (o: string) => o === "auth_ok_vehicle_found" || o === "auth_ok_no_vehicle";

export function cachedIxellioLookup(
  plate: string,
  run: (plate: string) => Promise<IxellioLookupResponse>,
  opts: { force?: boolean } = {},
): Promise<IxellioLookupResponse> {
  if (!opts.force) {
    const hit = cache.get(plate);
    if (hit) return Promise.resolve(hit);
  }
  const pending = inflight.get(plate);
  if (pending) return pending;
  const p = run(plate)
    .then((res) => {
      if (isDefinitiveOutcome(res.outcome)) cache.set(plate, res);
      else cache.delete(plate);
      return res;
    })
    .finally(() => inflight.delete(plate));
  inflight.set(plate, p);
  return p;
}

export function clearIxellioLookupCache(plate?: string) {
  if (plate) cache.delete(plate);
  else cache.clear();
}
