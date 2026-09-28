import { describe, expect, it } from "vitest";

import { normalizePurchaseExtract } from "@/lib/purchase-extract";
import { guessDocumentSite, matchSupplier, orderGaps } from "@/lib/parts-site";
import { docSiteText } from "@/lib/purchase-doc";
import { autoSupplier } from "@/lib/order-supplier";
import { matchDossierOrders } from "@/lib/winmotor/reconcile";

// Réponse OCR type pour le bon de commande réel 0332b1a5… (Commande n° 45834714).
const ocr = {
  doc_kind: "commande",
  distributor: "RENAULT SARLAT - GROUPE FAURIE",
  document_number: "45834714",
  document_date: "2026-09-27",
  order_reference: "45834714",
  or_number: "Repère 50413",
  plate: "BL-859-FD",
  plate_printed: false,
  customer_or_site: "GARAGE CASTILLON-VEYSSIERE, ARGENTONESSE, 24220 CASTELS",
  lines: [
    { ref: "8100029957", designation: "Vanne EGR - PIERBURG 7.01782.07.0", qty: "1", unit_price: "229,39", client_price: 229.39, amount: "160,57", delay: "livré à votre R1 le 28 septembre avant 13:00" },
  ],
  total_ht: 160.57,
  vat_amount: 32.12,
  total_ttc: 192.69,
};

const sites = [
  { id: "cas", code: "castillon", name: "Castillon" },
  { id: "dda", code: "dda", name: "Damien Digoin Automobile" },
];
const suppliers = [
  { id: "s1", name: "FAURIE AUTO SARLAT" },
  { id: "s2", name: "AUTODISTRIBUTION" },
];

describe("bon de commande 45834714 (régression)", () => {
  const x = normalizePurchaseExtract(ocr);

  it("extrait fournisseur, commande, OR", () => {
    expect(x.supplier).toBe("RENAULT SARLAT - GROUPE FAURIE");
    expect(matchSupplier(x.supplier, suppliers)?.id).toBe("s1");
    expect(x.order_reference).toBe("45834714");
    expect(x.or_number).toBe("50413");
  });

  it("ligne pièce avec PA net et non le prix client", () => {
    expect(x.lines).toHaveLength(1);
    const l = x.lines![0]!;
    expect(l.reference).toBe("8100029957");
    expect(l.label).toBe("Vanne EGR - PIERBURG 7.01782.07.0");
    expect(l.quantity).toBe(1);
    expect(l.unit_price).toBe(160.57);
    expect(l.unit_price).not.toBe(229.39);
    expect(l.delay).toContain("28 septembre");
  });

  it("site Castillon et aucune plaque inventée", () => {
    expect(guessDocumentSite(docSiteText(x), sites as never)).toBe("cas");
    expect(x.plate).toBeNull();
  });

  it("fournisseur non trouvé : nom conservé, pas de match arbitraire", () => {
    expect(matchSupplier("RENAULT SARLAT - GROUPE FAURIE", [{ id: "z", name: "AUTODISTRIBUTION" }])).toBeNull();
    expect(x.supplier).toBeTruthy();
  });
});

describe("commande : Repère/OR ≠ Commande n°", () => {
  it("order_reference=50413=OR → document_number 45834714", () => {
    const x = normalizePurchaseExtract({ ...ocr, order_reference: "50413", or_number: "50413", document_number: "45834714" });
    expect(x.order_reference).toBe("45834714");
    expect(x.or_number).toBe("50413");
  });
});

describe("fournisseur chargé après le document", () => {
  it("auto-sélection à l'arrivée de la liste, sans écraser un choix manuel", () => {
    const name = normalizePurchaseExtract(ocr).supplier;
    expect(autoSupplier("", false, name, undefined)).toBe("");
    expect(autoSupplier("", false, name, suppliers)).toBe("s1");
    expect(autoSupplier("s2", true, name, suppliers)).toBe("s2");
    expect(autoSupplier("", true, name, suppliers)).toBe("");
  });
});

describe("commande 45873330 : OR non importé + plaque imprimée", () => {
  const x = normalizePurchaseExtract({
    doc_kind: "commande", distributor: "RENAULT SARLAT - GROUPE FAURIE", document_number: "45873330", document_date: "2026-09-27",
    order_reference: "48416", or_number: "Repère 48416", plate: "FG315YS", plate_printed: true,
    customer_or_site: "GARAGE CASTILLON-VEYSSIERE",
    lines: [{ ref: "8100166273", designation: "Phare avant HELLA 1EL 354 853-011", qty: "1", unit_price: "510,30", client_price: 510.3, amount: "357,21", delay: "Commande spéciale (>72h livrée à votre R1)" }],
    total_ht: 357.21,
  });
  it("champs extraits", () => {
    expect(autoSupplier("", false, x.supplier, suppliers)).toBe("s1");
    expect(x.order_reference).toBe("45873330");
    expect(x.or_number).toBe("48416");
    expect(x.plate).toBe("FG-315-YS");
    const l = x.lines![0]!;
    expect(l.reference).toBe("8100166273");
    expect(l.quantity).toBe(1);
    expect(l.unit_price).toBe(357.21);
    expect(l.unit_price).not.toBe(510.3);
    expect(guessDocumentSite(docSiteText(x), sites as never)).toBe("cas");
  });
  it("n° de dossier sans OR DDA = commande valide, aucune anomalie", () => {
    const g = orderGaps({ supplier_id: "s1", hasDocument: true, lines: 1, repair_order_id: null, plate: "FG-315-YS", destination: "or", requested_or_number: "48416" });
    expect(g).toEqual([]);
    expect(orderGaps({ supplier_id: "s1", hasDocument: true, lines: 1, repair_order_id: null, plate: null, destination: "or", requested_or_number: "48416" })).toEqual([]);
  });
});

describe("facture WinMotor = événement final du dossier", () => {
  const o = (id: string, site: string, num: string | null, plate: string | null) => ({ id, site_id: site, requested_or_number: num, plate });
  it("retrouve la commande même site + même n° de dossier", () => {
    const r = matchDossierOrders({ site_id: "cas", or_number: "48416", plate: "FG315YS" }, [o("a", "cas", "48416", "FG-315-YS"), o("b", "dda", "48416", "FG-315-YS"), o("c", "cas", "99999", null)]);
    expect(r.ambiguous).toBe(false);
    expect(r.orders.map((x) => x.id)).toEqual(["a"]);
  });
  it("ambiguïté (véhicules différents) = pas de liaison automatique", () => {
    const r = matchDossierOrders({ site_id: "cas", or_number: "48416", plate: null }, [o("a", "cas", "48416", "FG-315-YS"), o("b", "cas", "48416", "AB-123-CD")]);
    expect(r.ambiguous).toBe(true);
  });
  it("plaque facture incompatible = contrôle manuel", () => {
    expect(matchDossierOrders({ site_id: "cas", or_number: "48416", plate: "ZZ999ZZ" }, [o("a", "cas", "48416", "FG-315-YS")]).ambiguous).toBe(true);
  });
});

describe("BL 914765 : dossier 50875 imprimé seul sous la désignation", () => {
  const base = {
    doc_kind: "bl", distributor: "FAURIE AUTO SARLAT", document_number: "914765", delivery_note_number: "914765",
    or_number: null, total_ht: 44.72,
    lines: [{ ref: "8550503695", designation: "MOTRIO MOTRIO Kit accessoires", qty: "1", unit_price: "44,72", isolated_number: "50875" }],
  };
  it("reconnu comme OR, lignes intactes", () => {
    const x = normalizePurchaseExtract(base);
    expect(x.or_number).toBe("50875");
    expect(x.lines![0]!.reference).toBe("8550503695");
    expect(x.lines![0]!.quantity).toBe(1);
    expect(x.lines![0]!.unit_price).toBe(44.72);
    expect((x.lines![0] as Record<string, unknown>)["isolated_number"]).toBeUndefined();
  });
  it("OR libellé prioritaire", () => {
    expect(normalizePurchaseExtract({ ...base, or_number: "Repère 48416" }).or_number).toBe("48416");
  });
  it("ambigu ou confondable => aucun OR inventé", () => {
    const two = { ...base, lines: [...base.lines, { ref: "77", designation: "x", qty: 1, unit_price: 1, isolated_number: "50999" }] };
    expect(normalizePurchaseExtract(two).or_number).toBeNull();
    expect(normalizePurchaseExtract({ ...base, document_number: "50875" }).or_number).toBeNull();
    expect(normalizePurchaseExtract({ ...base, lines: [{ ...base.lines[0], isolated_number: "123456" }] }).or_number).toBeNull();
    expect(normalizePurchaseExtract({ ...base, lines: [{ ...base.lines[0], ref: "8550875", isolated_number: "50875" }] }).or_number).toBeNull();
  });
});

import { findFrenchPlate } from "@/lib/plate";
import { matchOrders } from "@/lib/parts-site";

describe("BL 914776 : immatriculation dans « mes références » / désignation", () => {
  it("formats HG 732 GH / HG-732-GH / HG732GH", () => {
    for (const s of ["HG 732 GH", "HG-732-GH", "HG732GH", "mes références : hg 732 gh"]) expect(findFrenchPlate(s)).toBe("HG-732-GH");
  });
  it("pas de faux positif sur OR 5 chiffres, dimension pneu ou plaques multiples", () => {
    expect(findFrenchPlate("50875")).toBeNull();
    expect(findFrenchPlate("MICHELIN 205/65 R16 107T C A B 73 AGILIS")).toBeNull();
    expect(findFrenchPlate("AB-123-CD et EF-456-GH")).toBeNull();
  });
  it("repère = plaque => plate renseignée, OR vide", () => {
    const x = normalizePurchaseExtract({ doc_kind: "bl", distributor: "FAURIE AUTO SARLAT", document_number: "914776", or_number: "HG 732 GH", lines: [{ ref: "7711640502", designation: "AGILIS CROSSCLIMATE", qty: 2, unit_price: 150.08 }] });
    expect(x.plate).toBe("HG-732-GH");
    expect(x.or_number).toBeNull();
  });
  it("plaque dans le libellé de ligne", () => {
    const x = normalizePurchaseExtract({ doc_kind: "bl", document_number: "914776", lines: [{ ref: "7711640502", designation: "MICHELIN 205/65 R16 107T C A B 73 AGILIS CROSSCLIMATE (803302) hg 732 gh", qty: 2, unit_price: 150.08 }] });
    expect(x.plate).toBe("HG-732-GH");
    expect(x.or_number).toBeNull();
  });
  it("OR 5 chiffres reste un OR", () => {
    expect(normalizePurchaseExtract({ or_number: "Repère 50413", lines: [] }).or_number).toBe("50413");
    expect(normalizePurchaseExtract({ or_number: "Repère 50413", lines: [] }).plate).toBeNull();
  });
  it("fournisseur seul => aucune correspondance ; plaque => certaine ; autre plaque exclue", () => {
    const base = { site_id: "cas", status: "ordered", supplier_order_ref: null, suppliers: { name: "FAURIE AUTO SARLAT" }, repair_orders: null, part_order_lines: [] };
    const orders = [{ ...base, id: "a", plate: null }, { ...base, id: "b", plate: "HG-732-GH" }, { ...base, id: "c", plate: "AB-123-CD" }];
    expect(matchOrders({ supplier: "FAURIE AUTO SARLAT", plate: null }, orders as never, "cas")).toEqual([]);
    const m = matchOrders({ supplier: "FAURIE AUTO SARLAT", plate: "HG732GH" }, orders as never, "cas");
    expect(m.map((x) => x.order.id)).toEqual(["b"]);
    expect(m[0]!.level).toBe("certain");
  });
});

import { winmotorOrHistory } from "@/lib/plate";
describe("HG732GH : historique WinMotor", () => {
  it("dernier OR connu 48751 puis 46585, sans doublon", () => {
    const h = winmotorOrHistory([{ or_number: "46585", invoice_date: "2026-02-03" }, { or_number: "48751", invoice_date: "2026-04-30" }, { or_number: "48751", invoice_date: "2026-04-30" }, { or_number: null, invoice_date: "2026-05-01" }]);
    expect(h).toEqual([{ or_number: "48751", date: "2026-04-30" }, { or_number: "46585", date: "2026-02-03" }]);
  });
  it("un ancien OR WinMotor ne crée aucune correspondance commande", () => {
    const base = { site_id: "cas", status: "ordered", supplier_order_ref: null, suppliers: { name: "FAURIE AUTO SARLAT" }, repair_orders: { or_number: "48751" }, part_order_lines: [] };
    expect(matchOrders({ supplier: "FAURIE AUTO SARLAT", plate: "HG-732-GH", or_number: null }, [{ ...base, id: "x", plate: null }] as never, "cas")).toEqual([]);
  });
});
