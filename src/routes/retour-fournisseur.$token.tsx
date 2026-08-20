import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { getSharedReturnFn, submitSharedReturnAnswerFn } from "@/lib/returns.functions";

export const Route = createFileRoute("/retour-fournisseur/$token")({
  head: () => ({
    meta: [
      { title: "Réponse retour fournisseur — DDA Connect" },
      { name: "description", content: "Consulter un dossier de retour de pièces et répondre en ligne sans créer de compte." },
      { property: "og:title", content: "Réponse retour fournisseur — DDA Connect" },
      { property: "og:description", content: "Accord de retour, confirmation de réception et dépôt d'avoir." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierPortal,
});

type Shared = Awaited<ReturnType<typeof getSharedReturnFn>>;

const ANSWERS = [
  { key: "accepte", label: "Retour accepté" },
  { key: "refuse", label: "Retour refusé" },
  { key: "info", label: "Besoin d'informations" },
  { key: "non_concerne", label: "Non concerné" },
  { key: "recu", label: "Retour bien reçu" },
  { key: "non_recu", label: "Retour non reçu" },
  { key: "partiel", label: "Réception partielle" },
  { key: "probleme", label: "Problème sur le retour" },
] as const;

function SupplierPortal() {
  const { token } = Route.useParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Shared | null>(null);
  const [answer, setAnswer] = useState<string>("accepte");
  const [comment, setComment] = useState("");
  const [creditNumber, setCreditNumber] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void getSharedReturnFn({ data: { token } }).then(setState);
  }, [token]);

  if (!state) return <Wrapper><p className="text-sm text-muted-foreground">Chargement…</p></Wrapper>;
  if (!state.ok || !("data" in state)) return <Wrapper><p className="text-sm">Ce lien n'est plus valide. Merci de contacter le service magasin.</p></Wrapper>;

  const d = state.data;

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const file = fileRef.current?.files?.[0];
      let filePayload: { name: string; mimeType: string; dataBase64: string } | undefined;
      if (file) {
        if (file.size > 5_000_000) {
          setMsg("Fichier trop volumineux (5 Mo maximum).");
          setBusy(false);
          return;
        }
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = "";
        buf.forEach((b) => (bin += String.fromCharCode(b)));
        filePayload = { name: file.name, mimeType: file.type || "application/octet-stream", dataBase64: btoa(bin) };
      }
      const amount = Number(creditAmount.replace(",", "."));
      const res = await submitSharedReturnAnswerFn({
        data: {
          token,
          answer: answer as never,
          ...(comment ? { comment } : {}),
          ...(creditNumber ? { creditNumber } : {}),
          ...(amount > 0 ? { creditAmount: amount } : {}),
          ...(filePayload ? { file: filePayload } : {}),
        },
      });
      if (res.ok) setDone(true);
      else setMsg(res.error || "Envoi impossible.");
    } catch {
      setMsg("Envoi impossible, merci de réessayer.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Wrapper>
        <h1 className="text-xl font-extrabold">Merci</h1>
        <p className="mt-2 text-sm">Votre réponse concernant le dossier {d.reference} a bien été enregistrée.</p>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <h1 className="text-xl font-extrabold uppercase">Dossier de retour {d.reference}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {[d.supplierName, d.blNumber ? `BL ${d.blNumber}` : "", d.invoiceNumber ? `Facture ${d.invoiceNumber}` : "", d.plate, d.orNumber ? `OR ${d.orNumber}` : ""]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div className="card-surface mt-4 p-3">
        <h2 className="text-sm font-extrabold uppercase">Pièces concernées</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {d.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 border-b border-border py-1 last:border-0">
              <span>{l.reference || "—"} · {l.label || "—"}</span>
              <span className="shrink-0">{l.quantity} × {l.unitPrice != null ? `${l.unitPrice.toFixed(2)} €` : "—"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm font-bold">Montant attendu : {d.expectedAmount.toFixed(2)} €</p>
      </div>

      <div className="card-surface mt-4 space-y-3 p-3">
        <h2 className="text-sm font-extrabold uppercase">Votre réponse</h2>
        <label className="block text-sm">
          <span className="text-xs font-bold uppercase text-muted-foreground">Décision</span>
          <select value={answer} onChange={(e) => setAnswer(e.target.value)} className="mt-1 w-full rounded-lg border-2 border-border bg-card p-3 text-sm">
            {ANSWERS.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-bold uppercase text-muted-foreground">Commentaire</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border-2 border-border bg-card p-3 text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="text-xs font-bold uppercase text-muted-foreground">N° d'avoir (option)</span>
            <input value={creditNumber} onChange={(e) => setCreditNumber(e.target.value)} className="mt-1 w-full rounded-lg border-2 border-border bg-card p-3 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-bold uppercase text-muted-foreground">Montant (€)</span>
            <input value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border-2 border-border bg-card p-3 text-sm" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-xs font-bold uppercase text-muted-foreground">Document (accord, BL, avoir…)</span>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="mt-1 w-full text-sm" />
        </label>
        {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full rounded-xl bg-brand py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
        >
          {busy ? "Envoi…" : "Envoyer ma réponse"}
        </button>
      </div>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-2xl">{children}</div>
    </div>
  );
}
