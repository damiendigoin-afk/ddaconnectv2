/**
 * Levier de marge — contrôle tactile inspiré d'un levier mécanique (socle,
 * pivot, poignée). Il n'effectue aucun calcul : il renvoie simplement la
 * position choisie, de −50 % à +100 % de la marge standard du paramétrage.
 */
import {
  MARGIN_ADJ_MAX,
  MARGIN_ADJ_MIN,
  MARGIN_ADJ_STEP,
  marginAdjustmentLabel,
} from "@/lib/tires";

export function MarginLever({
  value,
  onChange,
}: {
  value: number;
  onChange: (pct: number) => void;
}) {
  const ratio = (value - MARGIN_ADJ_MIN) / (MARGIN_ADJ_MAX - MARGIN_ADJ_MIN);
  const angle = -40 + ratio * 80;

  return (
    <section className="card-surface space-y-3 p-4 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">Levier de marge</h2>
        <span className="rounded-lg border-2 border-border px-2 py-1 text-xs font-extrabold uppercase">
          {marginAdjustmentLabel(value)}
        </span>
      </div>

      {/* Représentation graphique : bras pivotant sur son socle. */}
      <div className="flex justify-center" aria-hidden="true">
        <svg viewBox="0 0 200 84" className="h-20 w-full max-w-[280px]">
          <rect x="60" y="66" width="80" height="10" rx="5" className="fill-muted" />
          <path d="M100 70 L86 78 L114 78 Z" className="fill-muted-foreground/40" />
          <g transform={`rotate(${angle} 100 70)`}>
            <rect x="96" y="20" width="8" height="52" rx="4" className="fill-muted-foreground" />
            <circle cx="100" cy="18" r="12" className="fill-brand" />
          </g>
          <circle cx="100" cy="70" r="6" className="fill-foreground" />
        </svg>
      </div>

      <input
        type="range"
        min={MARGIN_ADJ_MIN}
        max={MARGIN_ADJ_MAX}
        step={MARGIN_ADJ_STEP}
        value={value}
        aria-label="Levier de marge"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-full cursor-pointer accent-[hsl(var(--brand))]"
      />

      <div className="flex items-center justify-between text-[11px] font-bold uppercase text-muted-foreground">
        <span>−50 %</span>
        <button
          type="button"
          onClick={() => onChange(0)}
          className="rounded px-2 py-1 font-extrabold uppercase text-foreground"
        >
          Standard
        </button>
        <span>+100 %</span>
      </div>
    </section>
  );
}
