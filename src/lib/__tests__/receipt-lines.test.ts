import { describe, expect, it, vi } from "vitest";
import { lineAnomalies, mailDetail, orderLinesFromDoc, pendingOrderLineMetrics, previewAttachment, receiptLinesFromDoc, receiptLinesFromOrder, syncOrNumber } from "@/lib/receipt-lines";
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

describe("lignes commande visibles et réception directe", () => {
  it("commande OCR une ligne : référence, désignation, quantité et PA sont immédiatement disponibles", () => {
    expect(orderLinesFromDoc([{ reference: "8100029957", label: "Vanne EGR", quantity: 1, unit_price: 160.57 }])).toEqual([
      expect.objectContaining({ physical_reference: "8100029957", designation: "Vanne EGR", qty_ordered: 1, expected_unit_cost_ht: 160.57 }),
    ]);
  });

  it("commande deux lignes : les deux restent présentes dans l'ordre", () => {
    const lines = orderLinesFromDoc([
      { reference: "A", label: "Pièce A", quantity: 2, unit_price: 10 },
      { reference: "B", label: "Pièce B", quantity: 3, unit_price: 20 },
    ]);
    expect(lines.map((line) => line.physical_reference)).toEqual(["A", "B"]);
  });

  it("réception depuis commande charge toutes les lignes avec leur quantité restante", () => {
    const lines = receiptLinesFromOrder([
      { id: "a", line_kind: "part", physical_reference: "A", designation: "Pièce A", qty_ordered: 2, qty_received: 0, expected_unit_cost_ht: 10, status: "ordered" },
      { id: "b", line_kind: "part", physical_reference: "B", designation: "Pièce B", qty_ordered: 3, qty_received: 1, expected_unit_cost_ht: 20, status: "partial" },
    ], "stock");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ qty_ordered: 2, qty_already_received: 0, qty_expected: 2, qty_received: 2 });
    expect(lines[1]).toMatchObject({ qty_ordered: 3, qty_already_received: 1, qty_expected: 2, qty_received: 2 });
  });

  it("commande partiellement reçue : reçu et reliquat sont calculés sans valeur négative", () => {
    expect(pendingOrderLineMetrics({ qty_ordered: 6, qty_received: 2 })).toEqual({ ordered: 6, received: 2, remaining: 4 });
    expect(pendingOrderLineMetrics({ qty_ordered: 2, qty_received: 3 }).remaining).toBe(0);
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

import { dedupeDocs, mimeFor, orderMarker, storageFileName } from "@/lib/receipt-lines";

describe("repères commandes / doublons / PJ", () => {
  it("dossier 48416 sans OR DDA n'affiche jamais « sans OR »", () => {
    expect(orderMarker({ repair_orders: null, requested_or_number: "48416", supplier_order_ref: "45873330" })).toBe("Dossier / OR WinMotor 48416 · commande 45873330");
    expect(orderMarker({ repair_orders: { or_number: "50413" }, requested_or_number: "50413" })).toBe("OR 50413");
    expect(orderMarker({ plate: "FG-315-YS" })).toBe("FG-315-YS");
    expect(orderMarker({})).toBe("sans repère");
  });
  it("3 occurrences exactes du PDF 0332… → une seule carte", () => {
    const x = { supplier: "RENAULT SARLAT - GROUPE FAURIE", doc_kind: "commande", document_number: "45834714", or_number: "50413", lines: [{ reference: "8100029957", label: "Vanne EGR", quantity: 1, unit_price: 160.57 }] };
    const docs = ["a", "b", "c"].map((id, i) => ({ id, site_id: "cast", created_at: `2026-09-27T10:0${i}:00Z`, extracted: x }));
    const other = { id: "d", site_id: "cast", created_at: "2026-09-27T11:00:00Z", extracted: { ...x, document_number: "99999" } };
    const r = dedupeDocs([...docs, other]);
    expect(r.map((d) => d.id).sort()).toEqual(["c", "d"]);
  });
  it("nom original + extension conservés", () => {
    expect(storageFileName("APV_2026 09.pdf")).toBe("APV_2026 09.pdf");
    expect(mimeFor("photo.JPG", null)).toBe("image/jpeg");
  });
});
