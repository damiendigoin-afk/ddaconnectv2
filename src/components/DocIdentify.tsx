import { useRef, useState } from "react";
import { Camera, Paperclip, Loader2 } from "lucide-react";

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
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<{ camera: boolean }>({ camera: false });

  function choose(camera: boolean) {
    pending.current = { camera };
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
    setBusy(true);
    try {

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
      onResult({ file, kind: extracted.doc_kind || "autre", extracted, prefill });
    } catch {
      onError?.(
        "Lecture du document impossible. Réessaie avec une photo plus nette ou saisis les informations.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={compact ? "flex shrink-0 gap-1" : "flex w-full gap-2"}>
        <button
          type="button"
          onClick={() => choose(true)}
          disabled={busy}
          aria-label="Prendre une photo à identifier"
          className={
            compact
              ? "flex w-16 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card disabled:opacity-60"
              : "flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-primary bg-card px-4 py-4 text-base font-bold uppercase tracking-wide disabled:opacity-60"
          }
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
          {compact ? null : <span>{busy ? "Lecture…" : "Photo"}</span>}
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          disabled={busy}
          aria-label="Choisir un document"
          className={
            compact
              ? "flex w-12 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card disabled:opacity-60"
              : "flex items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-bold uppercase disabled:opacity-60"
          }
        >
          <Paperclip className="h-5 w-5" />
          {compact ? null : <span>Document</span>}
        </button>
      </div>

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
    </>
  );
}
