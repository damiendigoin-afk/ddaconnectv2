import { toast } from "sonner";

export type Explained = {
  /** Ce qui bloque. */
  what: string;
  /** Pourquoi ça bloque. */
  why: string;
  /** Comment le corriger. */
  how: string;
};

type PgLike = { code?: string; message?: string; details?: string; hint?: string };

function asPg(e: unknown): PgLike {
  if (e && typeof e === "object") return e as PgLike;
  return { message: String(e) };
}

/**
 * Traduit une erreur technique en explication actionnable :
 * ce qui bloque / pourquoi / comment corriger.
 * Aucune erreur générique ne doit être affichée à l'utilisateur.
 */
export function explainError(e: unknown, what = "Action impossible"): Explained {
  const err = asPg(e);
  const msg = err.message ?? "";
  const detail = [err.details, err.hint].filter(Boolean).join(" — ");

  switch (err.code) {
    case "23503":
      return {
        what,
        why: `Une donnée liée n'existe pas ou plus dans la base (${detail || msg}).`,
        how: "Vérifiez le client, le véhicule ou le site sélectionné, puis réessayez sans cette liaison.",
      };
    case "23502":
      return {
        what,
        why: `Une information obligatoire est vide (${detail || msg}).`,
        how: "Complétez le champ manquant indiqué puis relancez l'enregistrement.",
      };
    case "23505":
      return {
        what,
        why: `Cet enregistrement existe déjà (${detail || msg}).`,
        how: "Ouvrez l'élément existant au lieu d'en créer un nouveau.",
      };
    case "42501":
    case "PGRST301":
ății:
      return { what, why: "Droits insuffisants sur cette donnée.", how: "Demandez au manager de vérifier vos accès ou votre site." };
    default:
      break;
  }

  if (/JWT|not authenticated|401/i.test(msg)) {
    return { what, why: "Votre session a expiré.", how: "Reconnectez-vous puis réessayez." };
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return { what, why: "Le réseau est indisponible.", how: "Vérifiez votre connexion puis appuyez à nouveau." };
  }
  return { what, why: msg || "Erreur technique inattendue.", how: "Réessayez ; si le problème persiste, transmettez ce message au support." };
}

/** Affiche une erreur explicite (ce qui bloque + pourquoi + comment corriger). */
export function toastError(e: unknown, what?: string) {
  const x = explainError(e, what);
  console.error(what ?? "Erreur", e);
  toast.error(x.what, { description: `${x.why}\n→ ${x.how}`, duration: 8000 });
  return x;
}
