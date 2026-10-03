import { LEGAL_MIN_MM, wearLevel } from "@/lib/tire-step";

/** Profil d'usure en coupe : largeur de bande de roulement intérieur -> extérieur, ligne de profondeur. */
export function TireWearProfile({ points, max = 8 }: { points: number[]; max?: number }) {
  const W = 320, H = 170, L = 34, R = 10, T = 14, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const y = (mm: number) => T + ih - (Math.min(mm, max) / max) * ih;
  if (points.length < 2) {
    return <p className="rounded-lg border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">Profil indisponible : moins de deux profondeurs estimées.</p>;
  }
  const xs = points.map((_, i) => L + (i / (points.length - 1)) * iw);
  const line = points.map((p, i) => `${i ? "L" : "M"}${xs[i]!.toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = `${line} L${L + iw},${T + ih} L${L},${T + ih} Z`;
  const color = (p: number) => {
    const l = wearLevel(p);
    return l === "critique" ? "var(--destructive)" : l === "surveiller" ? "var(--warning)" : "var(--success)";
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Profil d'usure : ${points.join(" / ")} mm`}>
      <rect x={L} y={y(3)} width={iw} height={y(LEGAL_MIN_MM) - y(3)} fill="var(--warning)" opacity={0.12} />
      <rect x={L} y={y(LEGAL_MIN_MM)} width={iw} height={T + ih - y(LEGAL_MIN_MM)} fill="var(--destructive)" opacity={0.15} />
      {[0, 2, 4, 6, 8].filter((v) => v <= max).map((v) => (
        <g key={v}>
          <line x1={L} x2={L + iw} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{v}</text>
        </g>
      ))}
      <line x1={L} x2={L + iw} y1={y(LEGAL_MIN_MM)} y2={y(LEGAL_MIN_MM)} stroke="var(--destructive)" strokeDasharray="4 3" strokeWidth={1.5} />
      <text x={L + iw} y={y(LEGAL_MIN_MM) - 3} textAnchor="end" fontSize={9} fill="var(--destructive)">Limite légale 1,6 mm</text>
      <path d={area} fill="var(--foreground)" opacity={0.08} />
      <path d={line} fill="none" stroke="var(--foreground)" strokeWidth={3} strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={xs[i]} cy={y(p)} r={6} fill={color(p)} stroke="var(--background)" strokeWidth={2} />
          <text x={xs[i]} y={y(p) - 10} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--foreground)">{p.toLocaleString("fr-FR")}</text>
        </g>
      ))}
      <text x={L} y={H - 10} fontSize={11} fontWeight={700} fill="var(--muted-foreground)">INTÉRIEUR</text>
      <text x={L + iw / 2} y={H - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--muted-foreground)">CENTRE</text>
      <text x={L + iw} y={H - 10} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--muted-foreground)">EXTÉRIEUR</text>
      <text x={4} y={T + 4} fontSize={9} fill="var(--muted-foreground)">mm</text>
    </svg>
  );
}
