import { useState } from "react";
import { Search } from "lucide-react";

export type TourSearchApplied = { text: string; from: string; to: string };

export const EMPTY_TOUR_SEARCH: TourSearchApplied = { text: "", from: "", to: "" };

/**
 * Zone de recherche des Tours Véhicule (référence : page « Tours clôturés »).
 * Réutilisée telle quelle sur la page principale Tour Véhicule.
 */
export function TourSearchForm({
  applied,
  onApply,
  placeholder = "Immatriculation, n° OR, réf. DDA, client, marque, opérateur…",
}: {
  applied: TourSearchApplied;
  onApply: (v: TourSearchApplied) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(applied.text);
  const [from, setFrom] = useState(applied.from);
  const [to, setTo] = useState(applied.to);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onApply({ text, from, to });
      }}
      className="mb-3 space-y-2"
    >
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Recherche instantanée dès 2 caractères, sans attendre la validation.
            if (e.target.value.trim().length > 1 || e.target.value === "")
              onApply({ text: e.target.value, from, to });
          }}
          placeholder={placeholder}
          aria-label="Rechercher un tour véhicule"
          className="w-full rounded-lg border-2 border-border bg-card px-3 py-3 text-base outline-none focus:border-brand"
        />
        <button
          type="submit"
          aria-label="Rechercher"
          className="flex items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold uppercase text-brand-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Du
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              onApply({ text, from: e.target.value, to });
            }}
            className="mt-1 w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Au
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              onApply({ text, from, to: e.target.value });
            }}
            className="mt-1 w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
          />
        </label>
      </div>
      {applied.text || applied.from || applied.to ? (
        <button
          type="button"
          onClick={() => {
            setText("");
            setFrom("");
            setTo("");
            onApply(EMPTY_TOUR_SEARCH);
          }}
          className="text-xs font-bold uppercase tracking-widest text-brand underline"
        >
          Réinitialiser la recherche
        </button>
      ) : null}
    </form>
  );
}
