/** Copie presse-papiers (iOS Safari + bureau) : API Clipboard dans le geste, sinon textarea + sélection. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* repli ci-dessous */
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  ta.style.fontSize = "16px"; // évite le zoom iOS
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

/** Texte affiché d'un bloc (rendu sanitisé), sauts de ligne conservés, éléments [data-nocopy] exclus. */
export function blockText(el: HTMLElement | null): string {
  if (!el) return "";
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-nocopy]").forEach((n) => n.remove());
  // innerText absent hors rendu (jsdom) : repli sur les blocs → lignes.
  clone.querySelectorAll("div,li,p").forEach((n) => n.append("\n"));
  return (clone.textContent ?? "").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
}
