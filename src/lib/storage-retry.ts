/**
 * Upload stockage tolérant aux incidents transitoires du service de fichiers
 * (429, 503, « Too many connections issued to the database »).
 * Même bucket/chemin/options à chaque essai ; aucune écriture métier ici.
 */
export const STORAGE_BUSY_MESSAGE =
  "Le serveur de fichiers est momentanément saturé. Réessayez dans quelques secondes. Rien n'a été enregistré.";

export const STORAGE_RETRY_DELAYS_MS = [1000, 3000];

type StorageErr = { message?: string; status?: number | string; statusCode?: number | string; error?: string } | null | undefined;

type Bucket = {
  upload: (path: string, body: never, opts?: Record<string, unknown>) => Promise<{ data: unknown; error: StorageErr }>;
  list: (dir: string, opts?: Record<string, unknown>) => Promise<{ data: Array<{ name: string }> | null; error: StorageErr }>;
};

function statusOf(e: StorageErr): number | null {
  const s = Number(e?.statusCode ?? e?.status);
  return Number.isFinite(s) ? s : null;
}

export function isTransientStorageError(e: StorageErr): boolean {
  if (!e) return false;
  const s = statusOf(e);
  if (s === 429 || s === 502 || s === 503 || s === 504) return true;
  if (s !== null && s >= 400 && s < 500) return false;
  const m = `${e.message ?? ""} ${e.error ?? ""}`.toLowerCase();
  return /too many connections|too many requests|service unavailable|temporarily unavailable|timed? ?out|failed to fetch|network/.test(m);
}

export function isAlreadyExistsError(e: StorageErr): boolean {
  if (!e) return false;
  const s = statusOf(e);
  const m = `${e.message ?? ""} ${e.error ?? ""}`.toLowerCase();
  return s === 409 || /already exists|duplicate/.test(m);
}

async function fileExists(bucket: Bucket, path: string): Promise<boolean> {
  const i = path.lastIndexOf("/");
  const dir = i >= 0 ? path.slice(0, i) : "";
  const name = path.slice(i + 1);
  const { data } = await bucket.list(dir, { search: name, limit: 10 });
  return !!data?.some((f) => f.name === name);
}

/**
 * Upload avec 2 nouveaux essais max sur erreur transitoire (≈1 s puis ≈3 s).
 * « already exists » après un essai transitoire = premier envoi réussi : on vérifie le fichier, sans doublon.
 * Échec final transitoire => Error(STORAGE_BUSY_MESSAGE). Erreur non transitoire => relancée telle quelle.
 */
export async function uploadWithRetry(
  bucket: Bucket,
  path: string,
  body: unknown,
  opts: Record<string, unknown>,
  deps: { sleep?: (ms: number) => Promise<void>; delays?: number[] } = {},
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.delays ?? STORAGE_RETRY_DELAYS_MS;
  let hadTransient = false;
  for (let attempt = 0; ; attempt++) {
    const { error } = await bucket.upload(path, body as never, opts);
    if (!error) return;
    if (hadTransient && isAlreadyExistsError(error) && (await fileExists(bucket, path))) return;
    if (!isTransientStorageError(error)) throw error;
    hadTransient = true;
    console.warn("[storage] erreur transitoire", { path, attempt: attempt + 1, error });
    if (attempt >= delays.length) throw new Error(STORAGE_BUSY_MESSAGE);
    await sleep(delays[attempt]!);
  }
}
