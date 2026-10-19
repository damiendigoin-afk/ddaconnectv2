/**
 * Vision d'abord pour les photos de documents d'achat + contrôles déterministes.
 * Les BL FAURIE 916076 / 916084 sont des DONNÉES de test uniquement : aucune règle du code ne les cite.
 */
import { describe, expect, it, vi } from "vitest";

import { runDocPipeline, type PipelineDeps } from "../doc-pipeline";
import { parseDiscountVatLines, purchaseRules, splitRefLabel } from "../doc-rules";
import { normalizePurchaseExtract } from "../purchase-extract";
import { mergeVisionFirst, validatePurchase } from "../purchase-validate";
import { resolveSupplier } from "../supplier-identify";
import { compareDocToOrder, receptionSuggestions, splitByExactRef } from "../parts-site";

const PHOTO = "data:image/jpeg;base64,AAAA";

/** Réponse vision simulée, fidèle au document 916076. */
const VISION_916076 = {
  doc_kind: "bl",
  supplier: "FAURIE AUTO SARLAT",
  supplier_info: { address: "35 ROUTE DE LA CROIX D'ESPRIT", postal_code: "24200", city: "SARLAT LA CANEDA", website: "www.faurie.fr", vat_number: "FR35879194751" },
  delivery_note_number: "916076",
  document_date: "2026-10-19",
  secondary_refs: ["328167"],
  lines: [
    { reference: "7717297600", label: "VALUE+ KIT ACCESSOIRE", quantity: 1, gross_unit_price: 199.78, discount_pct: 45, amount: 109.88, unit_price: 109.88, vat_pct: 20, amount_ttc: 131.86 },
    { reference: "7711945852", label: "VALUE+ FILTRE A AIR VALUE+ (303006)", quantity: 1, gross_unit_price: 28.02, discount_pct: 45, amount: 15.41, unit_price: 15.41, vat_pct: 20, amount_ttc: 18.49 },
  ],
  total_ht: 125.29,
  vat_amount: 25.06,
  total_ttc: 150.35,
};

/** Texte OCR dégradé observé (fournisseur faux, date 2016) : ne doit plus bloquer la vision. */
const OCR_BAD = `SEJ1ND SA
35 ROUTE DE LA CROIX D'ALLON 24200 SARLAT
DUPLICATA DE BON DE LIVRAISON N° 0974076 DU 19/10/2016
7717297600 VALUE+ KIT ACCESSOIRE 20 4500109,88
Montant HT 132,90`;

function deps(vision: Record<string, unknown> | null, over: Partial<PipelineDeps> = {}) {
  return {
    fallbackEnabled: vi.fn(async () => true),
    aiText: vi.fn(async () => null),
    aiVision: vi.fn(async () => vision),
    logLocal: vi.fn(async () => {}),
    ...over,
  };
}

describe("A/E — photo : vision d'abord, une seule passe", () => {
  it("916076 : la vision cohérente gagne sur l'OCR faux (SEJ1ND SA, 2016, 0974076)", async () => {
    const d = deps(VISION_916076);
    const r = await runDocPipeline({ kind: "purchase", text: OCR_BAD, hasImage: true, media: "photo", visionFirst: true }, d);
    expect(d.aiVision).toHaveBeenCalledTimes(1);
    expect(d.aiText).not.toHaveBeenCalled();
    expect(r.aiCalls).toBe(1);
    const x = normalizePurchaseExtract(r.fields);
    expect(x.supplier).toBe("FAURIE AUTO SARLAT");
    expect(x.delivery_note_number).toBe("916076");
    expect(x.document_date).toBe("2026-10-19");
    expect(x.secondary_refs).toEqual(["328167"]);
    expect(x.lines?.map((l) => [l.reference, l.quantity, l.unit_price, l.amount])).toEqual([["7717297600", 1, 109.88, 109.88], ["7711945852", 1, 15.41, 15.41]]);
    expect([x.total_ht, x.vat_amount, x.total_ttc]).toEqual([125.29, 25.06, 150.35]);
    expect(x.control_alerts ?? []).toEqual([]);
    expect(x.read_provenance?.source).toBe("vision");
    expect(x.read_provenance?.conflicts).toContain("supplier");
  });

  it("PDF avec couche texte : pas de vision d'abord (non-régression)", async () => {
    const text = "FAURIE AUTO SARLAT\nBON DE LIVRAISON N° 914776 du 28/09/2026\nMI2055516 PNEU MICHELIN CROSSCLIMATE 2 2 95,40 190,80\nTotal HT 190,80".padEnd(260, " ");
    const d = deps(VISION_916076);
    const r = await runDocPipeline({ kind: "purchase", text, hasImage: true, media: "pdf_text", visionFirst: true, ctx: { suppliers: [{ name: "FAURIE AUTO SARLAT" }] } }, d);
    expect(d.aiVision).not.toHaveBeenCalled();
    expect(r.route).toBe("ocr_rules");
  });

  it("vision indisponible : repli sur le flux existant, sans seconde vision", async () => {
    const d = deps(null);
    await runDocPipeline({ kind: "purchase", text: OCR_BAD, hasImage: true, media: "photo", visionFirst: true }, d);
    expect(d.aiVision).toHaveBeenCalledTimes(1);
  });
});

describe("F — complément par les règles uniquement si champ manquant et non suspect", () => {
  it("date absente en vision complétée par la règle ; fournisseur vision conservé", () => {
    const { date: _d, ...v } = { ...VISION_916076, date: null } as Record<string, unknown>;
    const m = mergeVisionFirst({ ...v, document_date: null }, { document_date: "2026-10-19", supplier: "SEJ1ND SA" });
    expect(m.fields["document_date"]).toBe("2026-10-19");
    expect(m.fields["supplier"]).toBe("FAURIE AUTO SARLAT");
    expect(m.completed).toEqual(["document_date"]);
  });
  it("champ règle suspect : jamais utilisé pour compléter", () => {
    const m = mergeVisionFirst({ lines: [] }, { lines: [{ reference: "X1234" }] }, ["lines"]);
    expect(m.fields["lines"]).toEqual([]);
  });
});

describe("B/C/G — contrôles numériques", () => {
  it("B : qté = taux de TVA (20) signalée", () => {
    const c = validatePurchase({ lines: [{ reference: "7717297600", quantity: 20, unit_price: 5.49, amount: 109.88, vat_pct: 20, gross_unit_price: 199.78, discount_pct: 45 }], total_ht: 109.88 });
    expect(c.ok).toBe(false);
    expect(c.suspectLines).toEqual([0]);
  });
  it("C : 45 % collé au montant (4 500 109,88) signalé comme aberrant", () => {
    const x = normalizePurchaseExtract({ ...VISION_916076, lines: [{ reference: "7717297600", label: "KIT", quantity: 1, unit_price: 4500109.88 }, VISION_916076.lines[1]] });
    expect(x.suspect_lines).toContain(0);
    expect(x.control_alerts?.join(" ")).toMatch(/supérieur au total/);
  });
  it("G : somme des lignes ≠ total HT => lecture à vérifier", () => {
    const x = normalizePurchaseExtract({ ...VISION_916076, total_ht: 132.9, total_ttc: 159.48, vat_amount: 26.58 });
    expect(x.control_alerts?.some((a) => a.includes("Somme des lignes"))).toBe(true);
    expect(x.suspect_lines).toEqual([0, 1]);
  });
  it("HT + TVA ≠ TTC signalé", () => {
    expect(validatePurchase({ lines: [], total_ht: 125.29, vat_amount: 25.06, total_ttc: 160 }).suspectFields).toContain("total_ttc");
  });
  it("normalisation idempotente (second passage navigateur)", () => {
    const once = normalizePurchaseExtract(VISION_916076);
    expect(normalizePurchaseExtract(once)).toEqual(once);
  });
});

describe("Règles déterministes (garde-fous)", () => {
  const OCR_916076 = `FAURIE AUTO SARLAT
DUPLICATA DE BON DE LIVRAISON N° 916076 DU 19/10/2026
VALUE+ KIT ACCESSOIRE 7717297600 1 199,78 45,00 % 109,88 20 131,86
** BL 328167 DU 19/10/2026 **
7711945852 VALUE+ FILTRE A AIR VALUE+ (303006) 1 28,02 45,00 % 15,41 20 18,49
Montant HT 125,29`;
  it("n° principal = duplicata, BL du tableau = référence secondaire, date du libellé", () => {
    const f = purchaseRules(OCR_916076.replace("DUPLICATA", "** BL 328167 DU 19/10/2026 **\nDUPLICATA"));
    expect(f["delivery_note_number"]).toBe("916076");
    expect(f["secondary_refs"]).toEqual(["328167"]);
    expect(f["document_date"]).toBe("2026-10-19");
  });
  it("colonnes Qté / tarif / remise / montant / TVA / TTC : TVA jamais quantité, remise jamais collée", () => {
    const l = parseDiscountVatLines(OCR_916076);
    expect(l.map((x) => [x.reference, x.quantity, x.unit_price, x.amount])).toEqual([["7717297600", 1, 109.88, 109.88], ["7711945852", 1, 15.41, 15.41]]);
  });
  it("D : 916084 — CAMERA garde son C (séparé ou collé)", () => {
    for (const row of ["284421319R CAMERA AIDE STATIONNEMENT 1 101,79 13,00 % 88,56 20 106,27", "284421319RCAMERA AIDE STATIONNEMENT 1 101,79 13,00 % 88,56 20 106,27"]) {
      const [l] = parseDiscountVatLines(row);
      expect(l).toMatchObject({ reference: "284421319R", label: "CAMERA AIDE STATIONNEMENT", quantity: 1, amount: 88.56 });
    }
    expect(splitRefLabel("7711945852 VALUE+ FILTRE")).toEqual({ reference: "7711945852", label: "VALUE+ FILTRE" });
  });
  it("D : 916084 via vision — remise 13 %, 88,56, cohérent", () => {
    const x = normalizePurchaseExtract({ supplier: "FAURIE AUTO SARLAT", delivery_note_number: "916084", total_ht: 88.56, vat_amount: 17.71, total_ttc: 106.27, lines: [{ reference: "284421319R", label: "CAMERA AIDE STATIONNEMENT", quantity: 1, gross_unit_price: 101.79, discount_pct: 13, amount: 88.56, vat_pct: 20 }] });
    expect(x.lines?.[0]).toMatchObject({ reference: "284421319R", label: "CAMERA AIDE STATIONNEMENT", quantity: 1, discount_pct: 13, unit_price: 88.56 });
    expect(x.control_alerts ?? []).toEqual([]);
  });
});

describe("Fournisseur par signature (TVA / site web) avant création", () => {
  const S = [{ id: "f", name: "FAURIE AUTO SARLAT", notes: "TVA intracom : FR35879194751\nSite : www.faurie.fr" }, { id: "b", name: "RENAULT BERGERAC - GROUPE FAURIE", notes: null }];
  it("nom lu faux mais TVA connue => fiche existante, jamais « new »", () => {
    expect(resolveSupplier("SEJ1ND SA", S, ["FR35879194751"]).kind).toBe("found");
  });
  it("nom lu faux mais site web connu => fiche existante", () => {
    const r = resolveSupplier("SEJ1ND SA", S, [null, null, "FAURIE.FR"]);
    expect(r.kind === "found" && r.supplier.id).toBe("f");
  });
});

describe("H — rapprochement : réf. exactes >>> désignation proche ; partiel 2/3", () => {
  const doc = { supplier: "FAURIE AUTO SARLAT", supplier_id: "f", lines: VISION_916076.lines.map((l) => ({ reference: l.reference, quantity: 1, label: l.label, unit_price: l.unit_price })) };
  const base = { site_id: "s1", supplier_id: "f", suppliers: { name: "FAURIE AUTO SARLAT" }, status: "ordered", created_at: "2026-10-18T10:00:00Z" };
  const line = (ref: string, des: string) => ({ physical_reference: ref, designation: des, line_kind: "part", status: "ordered", qty_ordered: 1, qty_received: 0 });
  const both = { ...base, id: "o51189", part_order_lines: [line("7717297600", "KIT ACCESSOIRE"), line("7711945852", "FILTRE A AIR VALUE+"), line("8550503297", "BOUGIE")] };
  const fuzzyA = { ...base, id: "o51146", part_order_lines: [line("7700000001", "FILTRE A HUILE VALUE+")] };
  const fuzzyB = { ...base, id: "o51148", part_order_lines: [line("7700000002", "FILTRE A AIR RD")] };
  it("la commande aux 2 réf. exactes est seule proposée, loin devant", () => {
    const s = receptionSuggestions(doc as never, [fuzzyA, both, fuzzyB] as never, "s1");
    const ids = [...s.certain, ...s.probable].map((m) => (m.order as { id: string }).id);
    expect(ids).toEqual(["o51189"]);
  });
  it("liste manuelle : candidats sans réf. commune repliés", () => {
    const r = splitByExactRef([fuzzyA, both, fuzzyB] as never, doc as never);
    expect(r.exact.map((o: { id: string }) => o.id)).toEqual(["o51189"]);
    expect(r.others).toHaveLength(2);
  });
  it("BL 2 lignes sur commande 3 lignes : la 3e reste non livrée", () => {
    const { rows } = compareDocToOrder(doc as never, both as never);
    const bougie = rows.find((r) => r.reference === "8550503297")!;
    expect(bougie.status).toBe("not_in_doc");
    expect(bougie.qty_doc).toBeNull();
  });
});
