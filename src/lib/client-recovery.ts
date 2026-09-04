/**
 * Récupération client (mobile Android / PWA).
 *
 * Deux causes distinctes provoquaient l'écran « Cette page n'a pas pu être
 * chargée » au démarrage d'un tour véhicule sur Pixel 7 :
 *
 * 1. un bundle JavaScript obsolète gardé par le cache Chrome / le service
 *    worker : la navigation vers /tour/$tourId demande un chunk qui n'existe
 *    plus côté serveur → « Failed to fetch dynamically imported module ».
 *    « Essayer à nouveau » relançait le même chunk mort, d'où un bug qui
 *    « persiste » ;
 * 2. un état local ancien / incomplet (site actif supprimé, brouillon d'un
 *    ancien format) qui casse le rendu.
 *
 * Ce module identifie ces deux cas, nettoie *uniquement* les données locales
 * incompatibles (aucun tour n'est stocké localement : ils vivent en base) et
 * force un rechargement propre, une seule fois, sans boucle.
 */

export const LOCAL_STATE_VERSION = 2;
export const VERSION_KEY = "dda.local-state-version";
export const RECOVERY_FLAG = "dda.recovery-attempt";
const PREFIX = "dda.";

/** Clés locales encore supportées par la version courante du client. */
const KNOWN_KEYS = new Set([VERSION_KEY, "dda.active-site", "dda.packages-import.job"]);

/** Clés dont le contenu doit être relu par la version courante (reprise locale). */
const VERSIONED_KEYS = new Set(["dda.packages-import.job"]);

export type LocalStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un site actif mémorisé n'est exploitable que s'il vaut « groupe » ou un UUID. */
export function isValidSiteValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return value === "groupe" || UUID_RE.test(value);
}

const STALE_ASSET_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
  /unexpected token '<'/i,
  /expected a javascript(-or-wasm)? module script/i,
];

/** true quand l'erreur vient d'un bundle/chunk périmé (cache mobile, PWA). */
export function isStaleAssetError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  if (!message) return false;
  return STALE_ASSET_PATTERNS.some((re) => re.test(message));
}

function keysOf(store: LocalStore): string[] {
  const out: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k) out.push(k);
  }
  return out;
}

/**
 * Liste les entrées locales incompatibles avec la version courante :
 * clés héritées d'anciennes versions, JSON illisible, site actif fantôme.
 */
export function collectIncompatibleKeys(store: LocalStore): string[] {
  const stored = Number(store.getItem(VERSION_KEY) ?? 0);
  const outdated = stored !== LOCAL_STATE_VERSION;
  const bad: string[] = [];

  for (const key of keysOf(store)) {
    if (!key.startsWith(PREFIX)) continue;
    if (!KNOWN_KEYS.has(key)) {
      // Vestige d'une version précédente (ancien brouillon local, etc.).
      bad.push(key);
      continue;
    }
    if (key === "dda.active-site" && !isValidSiteValue(store.getItem(key))) {
      bad.push(key);
      continue;
    }
    if (outdated && VERSIONED_KEYS.has(key)) {
      bad.push(key);
      continue;
    }
    const raw = store.getItem(key);
    if (raw && /^[[{]/.test(raw)) {
      try {
        JSON.parse(raw);
      } catch {
        bad.push(key);
      }
    }
  }
  return bad;
}

/**
 * Migration ciblée : supprime les entrées incompatibles et marque la version.
 * Ne touche à rien d'autre — les tours véhicule sont en base, jamais ici.
 */
export function migrateLocalState(store: LocalStore): { removed: string[] } {
  let removed: string[] = [];
  try {
    removed = collectIncompatibleKeys(store);
    for (const key of removed) store.removeItem(key);
    store.setItem(VERSION_KEY, String(LOCAL_STATE_VERSION));
  } catch {
    /* stockage indisponible (mode privé) : l'application doit continuer. */
  }
  return { removed };
}

/** Journalisation exploitable côté console + télémétrie éditeur. */
export function describeClientError(error: unknown, context: Record<string, unknown> = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    message: err.message,
    name: err.name,
    stack: err.stack ?? null,
    staleAsset: isStaleAssetError(error),
    ...context,
  };
}

/** Une seule tentative de récupération automatique par session : pas de boucle. */
export function shouldAutoRecover(session: LocalStore | null): boolean {
  if (!session) return false;
  try {
    if (session.getItem(RECOVERY_FLAG)) return false;
    session.setItem(RECOVERY_FLAG, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function clearRecoveryFlag(session: LocalStore | null): void {
  try {
    session?.removeItem(RECOVERY_FLAG);
  } catch {
    /* ignore */
  }
}

/** Supprime caches HTTP applicatifs et service workers périmés. */
export async function purgeStaleAssets(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
  try {
    const sw = navigator.serviceWorker;
    if (sw?.getRegistrations) {
      const regs = await sw.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Nettoyage complet puis rechargement dur (cache-busting) : utilisé quand
 * l'erreur vient d'un asset périmé ou quand l'utilisateur relance le parcours.
 */
export async function recoverStaleClient(opts: { reload?: boolean } = {}): Promise<void> {
  if (typeof window === "undefined") return;
  migrateLocalState(window.localStorage);
  await purgeStaleAssets();
  if (opts.reload === false) return;
  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.toString());
}
