import { Check, ChevronLeft, ImagePlus, RotateCcw, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
  | "document"
  | "free";

/** Caméra persistante : l'utilisateur ouvre la caméra une seule fois et enchaîne les prises. */
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

  const step: BurstStep | undefined = steps[index];
  const freeMode = !step;

  useEffect(() => {
    let cancelled = false;
    async function open() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
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

  const push = useCallback(
    async (blob: Blob) => {
      const dataUrl = await blobToDataUrl(blob);
      const key = step?.key ?? `libre_${Date.now()}`;
      const label = step?.label ?? "Photo complémentaire";
      setShots((s) => [...s, { key, label, blob, dataUrl }]);
      setIndex((i) => (steps[i] ? i + 1 : i));
    },
    [step, steps],
  );

  async function capture() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      if (blob) await push(blob);
    } finally {
      setBusy(false);
    }
  }

  function retake() {
    setShots((s) => {
      const copy = [...s];
      const last = copy.pop();
      if (last) setIndex((i) => Math.max(0, steps.findIndex((st) => st.key === last.key) >= 0 ? steps.findIndex((st) => st.key === last.key) : i));
      return copy;
    });
  }

  const done = shots.length;
  const total = steps.length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <header className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onCancel} aria-label="Fermer" className="rounded-lg p-2">
          <X className="h-6 w-6" />
        </button>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide opacity-70">{title}</div>
          <div className="text-base font-extrabold uppercase">{step?.label ?? "Photos complémentaires"}</div>
        </div>
        <div className="w-10 text-right text-sm font-bold">
          {total ? `${Math.min(index + 1, total)}/${total}` : done}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
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
        {!fallback && ready ? <MaskOverlay kind={step?.mask ?? "free"} /> : null}
        {shots.length ? (
          <div className="absolute bottom-2 left-2 right-2 flex gap-2 overflow-x-auto">
            {shots.slice(-8).map((s, i) => (
              <img key={i} src={s.dataUrl} alt={s.label} className="h-14 w-14 rounded-md object-cover" />
            ))}
          </div>
        ) : null}
      </div>

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

      <footer className="space-y-3 px-4 pb-6 pt-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="flex items-center gap-1 rounded-lg px-3 py-3 text-sm font-bold uppercase disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" /> Préc.
          </button>

          <button
            type="button"
            onClick={() => (fallback ? fileRef.current?.click() : void capture())}
            disabled={busy}
            aria-label="Déclencher"
            className="h-20 w-20 rounded-full border-4 border-white bg-white/20 active:scale-95"
          />

          <button
            type="button"
            onClick={() => setIndex((i) => (steps[i] ? i + 1 : i))}
            disabled={freeMode}
            className="flex items-center gap-1 rounded-lg px-3 py-3 text-sm font-bold uppercase disabled:opacity-40"
          >
            Passer <SkipForward className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={retake}
            disabled={!shots.length}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/40 py-3 text-sm font-bold uppercase disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" /> Reprendre
          </button>
          {allowFree ? (
            <button
              type="button"
              onClick={() => setIndex(steps.length)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/40 py-3 text-sm font-bold uppercase"
            >
              <ImagePlus className="h-4 w-4" /> Photo libre
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onFinish(shots)}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground"
          >
            <Check className="h-4 w-4" /> Terminer
          </button>
        </div>
      </footer>
    </div>
  );
}

/** Masque de guidage superposé à la caméra. */
function MaskOverlay({ kind }: { kind: MaskKind }) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
      aria-hidden="true"
    >
      <g fill="none" stroke="#ffd400" strokeWidth="0.8" strokeDasharray="3 2">
        {MASKS[kind]}
      </g>
    </svg>
  );
}

const carBody = (
  <>
    <rect x="16" y="34" width="68" height="34" rx="8" />
    <path d="M26 34 L34 20 H66 L74 34" />
    <circle cx="30" cy="70" r="5" />
    <circle cx="70" cy="70" r="5" />
  </>
);

const carThreeQuarter = (
  <>
    <path d="M12 60 L20 38 L46 30 L74 34 L88 46 L88 62 Q88 68 82 68 H18 Q12 68 12 62 Z" />
    <path d="M28 40 L46 34 L64 37" />
    <circle cx="30" cy="68" r="6" />
    <circle cx="74" cy="68" r="6" />
  </>
);

const carSide = (
  <>
    <path d="M8 62 L16 44 L38 34 H62 L84 44 L92 58 V64 Q92 68 88 68 H12 Q8 68 8 64 Z" />
    <path d="M24 44 H44 V34" />
    <path d="M48 34 V44 H70" />
    <circle cx="28" cy="68" r="7" />
    <circle cx="72" cy="68" r="7" />
  </>
);

const MASKS: Record<MaskKind, JSX.Element> = {
  front: carBody,
  rear: carBody,
  "front-left": carThreeQuarter,
  "front-right": carThreeQuarter,
  "rear-left": carThreeQuarter,
  "rear-right": carThreeQuarter,
  left: carSide,
  right: carSide,
  interior: (
    <>
      <rect x="12" y="24" width="76" height="52" rx="6" />
      <circle cx="34" cy="52" r="12" />
      <rect x="54" y="40" width="26" height="18" rx="3" />
    </>
  ),
  odometer: (
    <>
      <rect x="20" y="34" width="60" height="32" rx="16" />
      <circle cx="38" cy="50" r="10" />
      <circle cx="62" cy="50" r="10" />
    </>
  ),
  document: <rect x="16" y="16" width="68" height="68" rx="3" />,
  free: <rect x="8" y="12" width="84" height="76" rx="4" />,
};
