import { useRef, useState } from "react";
import { Camera, FileText, Loader2, ScanLine, X } from "lucide-react";

import { DOC_ACCEPT, isImage, rejectReason } from "@/lib/documents";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { ocrAnyDocument } from "@/lib/ocr.functions";
import { refPrefill, type RefPrefill } from "@/lib/refbase";
import { formatPlate, normalizePlate } from "@/lib/plate";

export type DocExtract = {
  doc_kind?: string | null;
  plate?: string | null;
  vin?: string | null;
  or_number?: string | null;
  claim_number?: string | null;
  mission_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
  brand?: string | null;
  model?: string | null;
  first_registration?: string | null;
  mileage?: number | null;
  insurer?: string | null;
  document_date?: string | null;
  summary?: string | null;
};

export type DocIdentifyResult = {
  /** Le document reste disponible pour être rattaché au dossier : jamais jeté après analyse. */
  file: File;
  kind: string;
  extracted: DocExtract;
  prefill: RefPrefill | null;
};

const KINDS = [
  { key: "plaque", label: "Photo de plaque", camera: true },
  { key: "carte_grise", label: "Carte grise", camera: true },
  { key: "or", label: "OR / ordre de réparation", camera: false },
  { key: "avis_sinistre", label: "Avis de sinistre", camera: false },
  { key: "rapport_expertise", label: "Rapport d'expertise", camera: false },
  { key: "autre", label: "Autre document", camera: false },
] as const;

/**
 * Point d'entrée unique d'identification d'un véhicule ou d'un dossier à partir d'un document.
 * Remplace les anciens boutons « scanner une plaque » et les blocs « identification par photo ».
 */
export function DocIdentify({
  onResult,
  onError,
  compact = true,
}: {
  onResult: (r: DocIdentifyResult) => void;
  onError?: (message: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<{ kind: string; camera: boolean }>({ kind: "autre", camera: false });

  function choose(kind: string, camera: boolean) {
    pending.current = { kind, camera };
    const el = inputRef.current;
    if (!el) return;
    if (camera) el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.accept = camera ? "image/*" : DOC_ACCEPT;
    el.click();
  }

  async function handle(file: File) {
    const reason = rejectReason(file);
    if (reason) {
      onError?.(reason);
      return;
    }
    setOpen(false);
    setBusy(true);
    try {
      const kind = pending.current.kind;
      const analysable = isImage(file) || file.type === "application/pdf";
      let extracted: DocExtract = {};
      if (analysable) {
        const blob = isImage(file) ? await compressImage(file, 2000, 0.85) : file;
        const dataUrl = await blobToDataUrl(blob);
        const res = await ocrAnyDocument({ data: { dataUrl, filename: file.name } });
        if (res.ok) extracted = JSON.parse(res.json) as DocExtract;
        else onError?.(res.error);
      } else {
        onError?.(
          "Ce format n'est pas analysable automatiquement : le document est conservé, complète les informations à la main.",
        );
      }
      let prefill: RefPrefill | null = null;
      if (extracted.plate) {
        prefill = await refPrefill(normalizePlate(extracted.plate));
        extracted.plate = formatPlate(extracted.plate);
      }
      onResult({ file, kind, extracted, prefill });
    } catch {
      onError?.("Lecture du document impossible. Réessaie avec une photo plus nette ou saisis les informations.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        aria-label="Identifier depuis un document"
        className={
          compact
            ? "flex w-16 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card disabled:opacity-60"
            : "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-card px-4 py-4 text-base font-bold uppercase tracking-wide disabled:opacity-60"
        }
      >
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <ScanLine className="h-6 w-6" />}
        {compact ? null : <span>Identifier depuis un document</span>}
      </button>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handle(f);
        }}
      />

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md space-y-2 rounded-t-2xl bg-card p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-extrabold uppercase tracking-widest">Identifier depuis…</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="rounded-lg p-1">
                <X className="h-5 w-5" />
              </button>
            </div>
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => choose(k.key, k.camera)}
                className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card px-3 py-3 text-left text-sm font-bold"
              >
                {k.camera ? <Camera className="h-5 w-5 text-brand" /> : <FileText className="h-5 w-5 text-brand" />}
                <span className="flex-1">{k.label}</span>
              </button>
            ))}
            <p className="pt-1 text-center text-xs text-muted-foreground">
              Photo, image existante ou fichier (PDF, Word, Excel, CSV, e-mail). Le document reste rattaché au dossier.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
