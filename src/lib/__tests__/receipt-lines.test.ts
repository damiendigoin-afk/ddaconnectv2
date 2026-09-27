import { describe, expect, it, vi } from "vitest";
import { lineAnomalies, mailDetail, previewAttachment, receiptLinesFromDoc, syncOrNumber } from "@/lib/receipt-lines";
import { requestedDossier } from "@/lib/parts-site";

describe("n° dossier / OR visible", () => {
  it("n° OCR arrivé après le premier rendu remplit le champ", () => {
    expect(syncOrNumber("", false, "50413")).toBe("50413");
  });
  it("ne remplace jamais une saisie utilisateur", () => {
    expect(syncOrNumber("12", true, "50413")).toBe("12");
  });
  it("commande : or_number 50413 visible et conservé sans OR DDA", () => {
    const visible = syncOrNumber("", false, "50413");
    expect(visible).toBe("50413");
    expect(requestedDossier(null, visible)).toBe("50413");
  });
  it("réception : BL 48416 visible sans repair_order, requested_or_number conservé sans faux OR", () => {
    const visible = syncOrNumber("", false, "48416");
    expect(visible).toBe("48416");
    expect(requestedDossier(null, visible)).toBe("48416");
    expect(requestedDossier({ id: "or-1" }, visible)).toBeNull();
  });
});

describe("lignes BL", () => {
  it("les valeurs OCR initialisent les champs éditables (2 lignes)", () => {
    const ls = receiptLinesFromDoc([
      { reference: "8100166273", label: "Phare avant", quantity: 1, unit_price: 357.21 },
      { reference: "7701", label: "Clip", quantity: 4, unit_price: 0.5 },
    ]);
    expect(ls).toHaveLength(2);
    expect(ls[0]).toMatchObject({ physical_reference: "8100166273", designation: "Phare avant", qty_expected: 1, qty_received: 1, unit_cost: 357.21 });
    expect(ls[1]).toMatchObject({ physical_reference: "7701", qty_received: 4, unit_cost: 0.5 });
  });
  it("anomalies affichées sur la ligne", () => {
    const [l] = receiptLinesFromDoc([{ reference: "A", label: "x", quantity: 2, unit_price: 10 }]);
    expect(lineAnomalies({ ...l!, ordered_reference: "B", qty_received: 1, expected_cost: 9 })).toHaveLength(3);
  });
});

describe("pièces jointes e-mail", () => {
  it("l'aperçu ouvre le fichier sans import DDA", async () => {
    const upload = vi.fn();
    const open = vi.fn();
    const r = await previewAttachment(async () => ({ ok: true, filename: "f.pdf", mime: "application/pdf", base64: btoa("PDF") }), "id", open);
    expect(r.ok).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect((open.mock.calls[0]![0] as Blob).type).toBe("application/pdf");
    expect(upload).not.toHaveBeenCalled();
  });
  it("fichier non récupérable : message réel", async () => {
    const open = vi.fn();
    const r = await previewAttachment(async () => ({ ok: false, message: "Fichier non archivé — ouvrir le mail." }), "id", open);
    expect(r).toEqual({ ok: false, message: "Fichier non archivé — ouvrir le mail." });
    expect(open).not.toHaveBeenCalled();
  });
  it("mail détaillé complet sans navigation", () => {
    const d = mailDetail({ subject: "Facture", from_name: "Cazes", from_address: "vos.documents@groupecazes.fr", sent_at: "2026-09-27T10:00:00Z", to_addresses: ["bl@garagecastillon.fr"], cc_addresses: ["a@b.fr"], body_text: "Bonjour", snippet: "x" });
    expect(d).toMatchObject({ subject: "Facture", to: "bl@garagecastillon.fr", cc: "a@b.fr", body: "Bonjour" });
    expect(mailDetail({ subject: null, from_name: null, from_address: "x@y", sent_at: "2026-09-27T10:00:00Z", body_text: "", snippet: "extrait" }).body).toBe("extrait");
  });
});
