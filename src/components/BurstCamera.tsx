import { Camera, Check, ChevronLeft, ChevronRight, ImagePlus, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import { blobToDataUrl } from "@/lib/photo";

export type BurstStep = { key: string; label: string; mask?: MaskKind };
export type BurstShot = { key: string; label: string; blob: Blob; dataUrl: string };

export type MaskKind =
  | "front"
  | "front-left"
  | "left"
  | "rear-left"
  | "rear"
  | "rear-right"
  | "right"
  | "front-right"
  | "interior"
  | "odometer"
  | "wheel"
  | "tread"
  | "document"
  | "plate"
  | "free";

/**
 * Caméra rafale : « je vise → je photographie → DDA mémorise → je continue ».
 * Aucune validation entre deux prises ; récapitulatif avec reprise unitaire à la fin.
 * Fonctionne en portrait et en paysage.
 */
export function BurstCamera({
  steps,
  title = "Reportage photo",
  onFinish,
  onCancel,
  allowFree = true,
}: {
  steps: BurstStep[];
  title?: string;
  onFinish: (shots: BurstShot[]) => void;
  onCancel: () => void;
  allowFree?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [index, setIndex] = useState(0);
  const [shots, setShots] = useState<BurstShot[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [recap, setRecap] = useState(false);
  const [landscape, setLandscape] = useState(false);

  const step: BurstStep | undefined = steps[index];
  const freeMode = !step;

  useEffect(() => {
    const check = () => setLandscape(window.innerWidth > window.innerHeight);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        setFallback(true);
      }
    }
    void open();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  /** Enregistre la prise pour l'étape courante (remplace en cas de reprise). */
  const push = useCallback(
    async (blob: Blob) => {
      const dataUrl = await blobToDataUrl(blob);
      const key = step?.key ?? `libre_${Date.now()}`;
      const label = step?.label ?? "Photo complémentaire";
      setShots((s) => {
        const i = step ? s.findIndex((x) => x.key === key) : -1;
        const next = [...s];
        const item = { key, label, blob, dataUrl };
        if (i >= 0) next[i] = item;
        else next.push(item);
        return next;
      });
      setFlash(true);
      setTimeout(() => setFlash(false), 140);
      // Enchaînement immédiat : pas d'écran de validation.
      setIndex((i) => {
        const next = i + 1;
        if (steps[i] && next >= steps.length) {
          setRecap(true);
          return i;
        }
        return steps[i] ? next : i;
      });
    },
    [step, steps],
  );

  async function capture() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      const maxSide = 2400;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (blob) await push(blob);
    } finally {
      setBusy(false);
    }
  }

  const shotByKey = useMemo(() => new Map(shots.map((s) => [s.key, s])), [shots]);
  const total = steps.length;
  const missing = steps.filter((s) => !shotByKey.has(s.key));

  /* ------------------------------ Récapitulatif ------------------------------ */
  if (recap) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <header className="flex items-center justify-between border-b border-border px-3 py-3">
          <button type="button" onClick={() => setRecap(false)} className="rounded-lg p-2" aria-label="Retour caméra">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="text-sm font-extrabold uppercase">
            Récapitulatif — {shots.length}/{total || shots.length}
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg p-2" aria-label="Annuler">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {missing.length ? (
            <p className="mb-3 rounded-xl bg-status-watch-soft px-3 py-2 text-sm font-bold text-status-watch">
              {missing.length} photo(s) manquante(s) : {missing.map((m) => m.label).join(", ")}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {steps.map((s, i) => {
              const shot = shotByKey.get(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setIndex(i);
                    setRecap(false);
                  }}
                  className="overflow-hidden rounded-xl border-2 border-border bg-card text-left"
                >
                  {shot ? (
                    <img src={shot.dataUrl} alt={s.label} className="h-28 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 w-full items-center justify-center bg-secondary text-xs font-bold uppercase text-muted-foreground">
                      <Camera className="mr-1 h-4 w-4" /> À prendre
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 px-2 py-2">
                    <span className="truncate text-xs font-bold uppercase">{s.label}</span>
                    {shot ? <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                  </div>
                </button>
              );
            })}
            {shots
              .filter((s) => !steps.some((st) => st.key === s.key))
              .map((s) => (
                <div key={s.key} className="overflow-hidden rounded-xl border-2 border-border bg-card">
                  <img src={s.dataUrl} alt={s.label} className="h-28 w-full object-cover" />
                  <div className="px-2 py-2 text-xs font-bold uppercase">{s.label}</div>
                </div>
              ))}
          </div>
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-border p-3">
          {allowFree ? (
            <button
              type="button"
              onClick={() => {
                setIndex(steps.length);
                setRecap(false);
              }}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-border bg-card py-4 text-sm font-bold uppercase"
            >
              <ImagePlus className="h-4 w-4" /> Photo libre
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => onFinish(shots)}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand py-4 text-sm font-extrabold uppercase text-brand-foreground"
          >
            <Check className="h-4 w-4" /> Valider
          </button>
        </footer>
      </div>
    );
  }

  /* --------------------------------- Caméra --------------------------------- */
  const shutter = (
    <button
      type="button"
      onClick={() => (fallback ? fileRef.current?.click() : void capture())}
      disabled={busy}
      aria-label="Déclencher"
      className="h-[4.5rem] w-[4.5rem] rounded-full border-4 border-white bg-white/25 active:scale-95"
    />
  );

  const nav = (
    <>
      <button
        type="button"
        onClick={() => setIndex((i) => Math.max(0, i - 1))}
        disabled={index === 0}
        aria-label="Photo précédente"
        className="rounded-full bg-white/10 p-3 disabled:opacity-30"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        type="button"
        onClick={() => (freeMode ? setRecap(true) : setIndex((i) => Math.min(steps.length, i + 1)))}
        aria-label="Photo suivante"
        className="rounded-full bg-white/10 p-3"
      >
        <ChevronRight className="h-6 w-6" />
      </button>
    </>
  );

  const finishBtn = (
    <button
      type="button"
      onClick={() => setRecap(true)}
      aria-label="Terminer"
      className="rounded-full bg-brand p-3 text-brand-foreground"
    >
      <Check className="h-6 w-6" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black text-white">
      {fallback ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm opacity-80">Caméra non disponible dans ce navigateur.</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-xl bg-white px-5 py-4 font-extrabold uppercase text-black"
          >
            Prendre la photo — {step?.label ?? "libre"}
          </button>
        </div>
      ) : (
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
      )}

      {!fallback && ready ? <MaskOverlay kind={step?.mask ?? "free"} landscape={landscape} /> : null}
      {flash ? <div className="pointer-events-none absolute inset-0 bg-white/70" /> : null}

      {/* Bandeau minimal : quitter + libellé + progression */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fermer"
          className="pointer-events-auto rounded-full bg-black/40 p-2.5 backdrop-blur"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="rounded-full bg-black/45 px-3 py-1.5 text-center text-sm font-extrabold uppercase backdrop-blur">
          {step?.label ?? "Photo libre"}
          <span className="ml-2 text-xs font-bold opacity-80">
            {total ? `${Math.min(index + 1, total)}/${total}` : `${shots.length}`}
          </span>
        </div>
        <span className="w-10" />
      </div>

      <span className="sr-only">{title}</span>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) await push(f);
        }}
      />

      {landscape ? (
        <div className="absolute inset-y-0 right-0 flex w-24 flex-col items-center justify-center gap-4">
          {finishBtn}
          {shutter}
          <div className="flex gap-2">{nav}</div>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-6">
          <div className="flex gap-2">{nav}</div>
          {shutter}
          {finishBtn}
        </div>
      )}
    </div>
  );
}

/** Masque de guidage : discret, proportionné, adapté portrait / paysage. */
function MaskOverlay({ kind, landscape }: { kind: MaskKind; landscape: boolean }) {
  const box = landscape ? "0 0 160 100" : "0 0 100 150";
  return (
    <svg
      viewBox={box}
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <g
        transform={landscape ? "translate(30 0) scale(1 1)" : "translate(0 25)"}
        fill="none"
        stroke="#ffd400"
        strokeOpacity="0.55"
        strokeWidth="0.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="4 3"
      >
        {MASKS[kind]}
      </g>
    </svg>
  );
}

/* Silhouettes dessinées dans un carré 100×100, centrées, volontairement fines. */

const carFront = (
  <>
    <path d="M18 66 Q18 50 26 44 L34 30 Q36 26 41 26 H59 Q64 26 66 30 L74 44 Q82 50 82 66 Q82 70 78 70 H22 Q18 70 18 66 Z" />
    <path d="M34 44 H66" />
    <rect x="42" y="58" width="16" height="6" rx="1.5" />
  </>
);

const carRear = (
  <>
    <path d="M18 66 Q18 50 26 44 L33 31 Q35 27 40 27 H60 Q65 27 67 31 L74 44 Q82 50 82 66 Q82 70 78 70 H22 Q18 70 18 66 Z" />
    <path d="M33 44 H67" />
    <rect x="41" y="58" width="18" height="6" rx="1.5" />
  </>
);

const carThreeQuarter = (
  <>
    <path d="M10 66 Q10 54 18 50 L28 36 Q30 32 36 32 H58 Q64 32 68 35 L84 46 Q90 50 90 60 V66 Q90 70 86 70 H14 Q10 70 10 66 Z" />
    <path d="M30 50 L38 38 H56 L66 48" />
    <circle cx="28" cy="70" r="7" />
    <circle cx="74" cy="70" r="7" />
  </>
);

const carSide = (
  <>
    <path d="M6 64 Q6 56 12 53 L26 40 Q28 37 33 37 H63 Q68 37 71 40 L88 52 Q94 55 94 63 V67 Q94 71 90 71 H10 Q6 71 6 67 Z" />
    <path d="M22 52 H44 V39" />
    <path d="M48 39 V52 H72" />
    <circle cx="26" cy="71" r="8" />
    <circle cx="74" cy="71" r="8" />
  </>
);

const MASKS: Record<MaskKind, ReactElement> = {
  front: carFront,
  rear: carRear,
  "front-left": carThreeQuarter,
  "front-right": <g transform="translate(100 0) scale(-1 1)">{carThreeQuarter}</g>,
  "rear-left": <g transform="translate(100 0) scale(-1 1)">{carThreeQuarter}</g>,
  "rear-right": carThreeQuarter,
  left: carSide,
  right: <g transform="translate(100 0) scale(-1 1)">{carSide}</g>,
  interior: (
    <>
      <rect x="12" y="26" width="76" height="52" rx="8" />
      <circle cx="34" cy="54" r="13" />
      <rect x="54" y="42" width="28" height="18" rx="3" />
    </>
  ),
  odometer: (
    <>
      <rect x="18" y="36" width="64" height="30" rx="15" />
      <circle cx="38" cy="51" r="10" />
      <circle cx="62" cy="51" r="10" />
    </>
  ),
  /* Roue de profil : pneu complet + jante. */
  wheel: (
    <>
      <circle cx="50" cy="52" r="30" />
      <circle cx="50" cy="52" r="19" />
      <path d="M20 52 H12 M80 52 H88 M50 22 V14 M50 82 V90" />
    </>
  ),
  /* Bande de roulement : cadre allongé sur la sculpture, au plus près. */
  tread: (
    <>
      <rect x="16" y="34" width="68" height="36" rx="6" />
      <path d="M28 34 V70 M40 34 V70 M52 34 V70 M64 34 V70 M76 34 V70" strokeDasharray="2 4" />
    </>
  ),
  plate: <rect x="14" y="42" width="72" height="18" rx="2" />,
  document: <rect x="12" y="26" width="76" height="52" rx="3" />,
  free: <rect x="8" y="18" width="84" height="68" rx="4" />,
};
