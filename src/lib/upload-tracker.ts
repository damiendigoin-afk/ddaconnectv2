import { useSyncExternalStore } from "react";

/**
 * Suivi global des envois de photos.
 *
 * Permet de bloquer la clôture d'un Tour Véhicule tant qu'un envoi est en
 * cours, et de proposer un nouvel essai / une suppression pour les photos
 * qui n'ont pas pu être enregistrées.
 */

export type FailedUpload = {
  id: string;
  name: string;
  retry: () => Promise<void>;
  dismiss: () => void;
};

type State = { pending: number; failed: FailedUpload[] };

let state: State = { pending: 0, failed: [] };
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: State = { pending: 0, failed: [] };

export function useUploadState(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}

export function uploadsPending(): number {
  return state.pending;
}

export function uploadsFailed(): number {
  return state.failed.length;
}

/** Encapsule une promesse d'upload pour la comptabiliser globalement. */
export async function trackUpload<T>(run: () => Promise<T>): Promise<T> {
  emit({ ...state, pending: state.pending + 1 });
  try {
    return await run();
  } finally {
    emit({ ...state, pending: Math.max(0, state.pending - 1) });
  }
}

export function addFailedUpload(entry: {
  name: string;
  retry: () => Promise<void>;
}): string {
  const id = crypto.randomUUID();
  const dismiss = () => removeFailedUpload(id);
  emit({
    ...state,
    failed: [
      ...state.failed,
      {
        id,
        name: entry.name,
        dismiss,
        retry: async () => {
          await entry.retry();
          removeFailedUpload(id);
        },
      },
    ],
  });
  return id;
}

export function removeFailedUpload(id: string) {
  emit({ ...state, failed: state.failed.filter((f) => f.id !== id) });
}

export function clearFailedUploads() {
  emit({ ...state, failed: [] });
}