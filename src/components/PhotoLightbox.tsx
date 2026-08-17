import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";

import { mediaUrl } from "@/lib/photo";

export type LightboxItem = {
  /** Chemin de la meilleure qualité disponible (original / HD). */
  path: string;
  label?: string | null;
};

/**
 * Visionneuse plein écran : zoom molette, pinch-to-zoom mobile, déplacement,
 * navigation précédent/suivant et plein écran. Affiche toujours la meilleure
 * qualité disponible (jamais la miniature).
 */
export function PhotoLightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const [url, setUrl] = useState("");
  const current = items[index];

  useEffect(() => {
    let alive = true;
    setUrl("");
    if (!current) return;
    void mediaUrl(current.path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [current?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onClose();
      if (ev.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (ev.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!current) return null;

  async function toggleFullscreen() {
    const el = document.getElementById("dda-lightbox");
    if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await el.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <div id="dda-lightbox" className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-2 px-2 py-2">
        <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg p-3">
          <X className="h-6 w-6" />
        </button>
        <div className="truncate text-center text-sm font-bold uppercase">
          {current.label || "Photo"}
          <span className="ml-2 opacity-70">
            {index + 1}/{items.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          aria-label="Plein écran"
          className="rounded-lg p-3"
        >
          <Maximize2 className="h-6 w-6" />
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <TransformWrapper
          key={current.path}
          doubleClick={{ mode: "toggle", step: 1.6 }}
          wheel={{ step: 0.15 }}
          pinch={{ step: 5 }}
          minScale={1}
          maxScale={8}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <TransformComponent
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ width: "100%", height: "100%" }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={current.label || "Photo en grand format"}
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm opacity-70">
                    Chargement…
                  </div>
                )}
              </TransformComponent>

              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/10 px-2 py-1 backdrop-blur">
                <button type="button" onClick={() => zoomOut()} aria-label="Dézoomer" className="p-3">
                  <ZoomOut className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => resetTransform()}
                  className="px-2 text-xs font-bold uppercase"
                >
                  100%
                </button>
                <button type="button" onClick={() => zoomIn()} aria-label="Zoomer" className="p-3">
                  <ZoomIn className="h-5 w-5" />
                </button>
              </div>
            </>
          )}
        </TransformWrapper>

        {index > 0 ? (
          <button
            type="button"
            onClick={() => onIndex(index - 1)}
            aria-label="Photo précédente"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 backdrop-blur"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
        ) : null}
        {index < items.length - 1 ? (
          <button
            type="button"
            onClick={() => onIndex(index + 1)}
            aria-label="Photo suivante"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 backdrop-blur"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** État partagé pour ouvrir la visionneuse depuis une grille de vignettes. */
export function useLightbox() {
  const [state, setState] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  return {
    open: (items: LightboxItem[], index: number) => setState({ items, index }),
    node: state ? (
      <PhotoLightbox
        items={state.items}
        index={state.index}
        onClose={() => setState(null)}
        onIndex={(i) => setState((s) => (s ? { ...s, index: i } : s))}
      />
    ) : null,
  };
}