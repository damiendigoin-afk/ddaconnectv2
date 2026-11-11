/**
 * Verrou partagé IXELLIO (licence mono-session) : une seule consultation à la fois, tous diagnostics
 * confondus (pièces, temps barémés), et 15 s minimum entre deux connexions. Mémoire de l'instance.
 */
export const IXELLIO_MIN_INTERVAL_MS = 15_000;
let busy = false;
let lastRun = 0;

export function acquireIxellio(now = Date.now()): { ok: true } | { ok: false; reason: "busy" | "rate_limited" } {
  if (busy) return { ok: false, reason: "busy" };
  if (now - lastRun < IXELLIO_MIN_INTERVAL_MS) return { ok: false, reason: "rate_limited" };
  busy = true;
  lastRun = now;
  return { ok: true };
}
export function releaseIxellio() { busy = false; }
/** Tests uniquement. */
export function __resetIxellioLock() { busy = false; lastRun = 0; }
