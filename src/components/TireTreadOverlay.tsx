import { wearLevel } from "@/lib/tire-step";

/** Valeurs mm superposées sur la vraie photo de bande de roulement (gauche / milieu / droite de l'image). */
export function TireTreadOverlay({ src, values, labels }: { src: string; values: [number | null, number | null, number | null]; labels: [string, string, string] }) {
  const tone = (v: number | null) => {
    const l = wearLevel(v);
    return l === "critique" ? "bg-destructive text-destructive-foreground" : l === "surveiller" ? "bg-warning text-warning-foreground" : l === "bon" ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground";
  };
  const line = (v: number | null) => {
    const l = wearLevel(v);
    return l === "critique" ? "bg-destructive" : l === "surveiller" ? "bg-warning" : l === "bon" ? "bg-success" : "bg-muted-foreground";
  };
  const xs = ["16.7%", "50%", "83.3%"];
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border-2 border-border">
        <img src={src} alt="Bande de roulement analysée" className="block max-h-[420px] w-full object-cover" />
        {values.map((v, i) => (
          <div key={i} className="absolute top-0 flex h-full -translate-x-1/2 flex-col items-center" style={{ left: xs[i] }}>
            <div className={`mt-2 rounded-lg px-2 py-1 text-center shadow-lg ${tone(v)}`}>
              <div className="text-[10px] font-bold uppercase leading-none">{labels[i]}</div>
              <div className="text-lg font-extrabold leading-tight">{v === null ? "—" : `${v.toLocaleString("fr-FR")} mm`}</div>
            </div>
            <div className={`w-1 flex-1 opacity-80 ${line(v)}`} />
            <div className={`mb-2 h-4 w-4 rounded-full border-2 border-background ${line(v)}`} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-destructive" /> ≤ 1,6 mm</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-warning" /> 1,6 – 3 mm</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-success" /> ≥ 3 mm</span>
      </div>
    </div>
  );
}
