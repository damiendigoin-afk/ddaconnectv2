import { describe, expect, it } from "vitest";
import { purchaseRules, renaultOrderDetailRules } from "../doc-rules";
import { normalizePurchaseExtract } from "../purchase-extract";
import { matchSupplier } from "../parts-site";
import { resolveSupplier } from "../supplier-identify";
import { orderLogisticsAlert, rankSuppliers } from "../order-logistics";

// Reconstitution du PDF Renault « Détail de commande » n° 46104548.
const RENAULT_46104548 = `Détail de commande
Commande n° 46104548
Statut : En cours de validation
Date : 02/10/2026
Client : GARAGE CASTILLON-VEYSSIERE
Repère commande : 50969
Plaque : EW814BC
Véhicule : RENAULT Clio IV / Lutecia IV (B98), diesel 1.5 dCi K9K, BVM6 TL4
Réf : 8660004937
MOTRIO Filtre d'habitacle -Pol
Qté : 1
Prix client 23,28 € HT 27,94 € TTC
11,64 € HT
Réf : 8660003779
MOTRIO Filtre à huile
Qté : 1
Prix client 13,53 € HT 16,24 € TTC
6,77 € HT
Total HT 18,41 €
Distributeur
RENAULT SARLAT - GROUPE FAURIE
Compte de facturation 014001
Contact CASTILLON-VEYSSIERE
Tél 0553292023
Email damien@garagecastillon.fr
Adresse de facturation
Adresse ARGENTONESSE
Code postal 24220
Ville CASTELS`;

const SUPPLIERS = [
  { id: "faurie-sarlat", name: "FAURIE AUTO SARLAT", active: true },
  { id: "faurie-bergerac", name: "RENAULT BERGERAC - GROUPE FAURIE", active: true },
  { id: "pad", name: "PIECE AUTO DISCOUNT", active: true },
];

describe("Renault « Détail de commande » 46104548", () => {
  const f = purchaseRules(RENAULT_46104548) as Record<string, unknown>;
  const lines = f["lines"] as { reference: string; label: string | null; quantity: number | null; unit_price: number | null }[];

  it("gabarit dédié reconnu (pas de repli générique)", () => {
    expect(f["template"]).toBe("renault_detail_commande");
  });
  it("fournisseur = Distributeur, jamais Ville CASTELS", () => {
    expect(f["supplier"]).toBe("RENAULT SARLAT - GROUPE FAURIE");
    expect(String(f["supplier"])).not.toMatch(/CASTELS/);
  });
  it("en-tête : commande, date, repère OR, immat", () => {
    expect(f).toMatchObject({ order_reference: "46104548", document_date: "2026-10-02", or_number: "50969", plate: "EW-814-BC" });
    expect(String(f["vehicle_label"])).toContain("Clio IV");
  });
  it("2 lignes exactes : réf, désignation, qté, PA HT (jamais le prix client)", () => {
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ reference: "8660004937", label: "MOTRIO Filtre d'habitacle -Pol", quantity: 1, unit_price: 11.64 });
    expect(lines[1]).toMatchObject({ reference: "8660003779", label: "MOTRIO Filtre à huile", quantity: 1, unit_price: 6.77 });
    expect(lines.map((l) => l.unit_price)).not.toContain(23.28);
    expect(lines.map((l) => l.unit_price)).not.toContain(13.53);
  });
  it("aucune ligne vide, total PA = Total HT 18,41, sans alerte", () => {
    expect(lines.every((l) => l.reference && l.label)).toBe(true);
    expect(f["total_ht"]).toBe(18.41);
    expect(f["control_alerts"]).toEqual([]);
    expect(f["line_quality"]).toBe("complete");
  });
  it("le contrat normalisé conserve lignes, OR et alertes", () => {
    const n = normalizePurchaseExtract(f);
    expect(n.lines).toHaveLength(2);
    expect(n.lines?.map((l) => l.unit_price)).toEqual([11.64, 6.77]);
    expect(n.or_number).toBe("50969");
    expect(n.order_reference).toBe("46104548");
    expect(n.supplier).toBe("RENAULT SARLAT - GROUPE FAURIE");
  });
  it("écart de total => alerte de contrôle, rien d'inventé", () => {
    const r = renaultOrderDetailRules(RENAULT_46104548.replace("Total HT 18,41 €", "Total HT 20,00 €"))!;
    expect((r["control_alerts"] as string[]).join(" ")).toMatch(/Écart de contrôle/);
    expect(r["line_quality"]).toBeNull();
  });
  it("ligne sans PA => anomalie visible, pas de validation silencieuse", () => {
    const r = renaultOrderDetailRules(RENAULT_46104548.replace("6,77 € HT\n", ""))!;
    expect((r["lines"] as unknown[]).length).toBe(2);
    expect((r["control_alerts"] as string[]).some((a) => /8660003779.*PA HT/.test(a))).toBe(true);
  });
  it("hors gabarit => null (repli générique / IA)", () => {
    expect(renaultOrderDetailRules("BON DE LIVRAISON\nRéf : ABC123 Filtre 1 10,00")).toBeNull();
  });
});

describe("alias fournisseur enseigne / groupe", () => {
  it("RENAULT SARLAT - GROUPE FAURIE => FAURIE AUTO SARLAT, jamais Bergerac", () => {
    expect(matchSupplier("RENAULT SARLAT - GROUPE FAURIE", SUPPLIERS)?.id).toBe("faurie-sarlat");
    const r = resolveSupplier("RENAULT SARLAT - GROUPE FAURIE", SUPPLIERS);
    expect(r.kind === "found" && r.supplier.id).toBe("faurie-sarlat");
  });
  it("VILLE CASTELS ne correspond à aucune fiche", () => {
    expect(matchSupplier("VILLE CASTELS", SUPPLIERS)).toBeNull();
  });
});

describe("fournisseurs les plus utilisés (dynamique)", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const d = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  it("fréquence pondérée par récence, annulées ignorées, 8 max", () => {
    const orders = [
      ...Array.from({ length: 5 }, () => ({ supplier_id: "old", created_at: d(300) })),
      ...Array.from({ length: 3 }, () => ({ supplier_id: "recent", created_at: d(2) })),
      { supplier_id: "cancel", created_at: d(1), status: "cancelled" },
      { supplier_id: null, created_at: d(1) },
      ...Array.from({ length: 10 }, (_, i) => ({ supplier_id: `s${i}`, created_at: d(30) })),
    ];
    const r = rankSuppliers(orders, now);
    expect(r[0]!.supplierId).toBe("recent");
    expect(r).toHaveLength(8);
    expect(r.map((x) => x.supplierId)).not.toContain("cancel");
  });
  it("se met à jour avec une nouvelle commande", () => {
    const base = [{ supplier_id: "a", created_at: d(1) }, { supplier_id: "b", created_at: d(1) }, { supplier_id: "b", created_at: d(1) }];
    expect(rankSuppliers(base, now)[0]!.supplierId).toBe("b");
    const more = [...base, { supplier_id: "a", created_at: d(0) }, { supplier_id: "a", created_at: d(0) }];
    expect(rankSuppliers(more, now)[0]!.supplierId).toBe("a");
  });
});

describe("RDV / livraison prévue", () => {
  const today = "2026-10-03";
  it("livraison prévue ignorée : aucune alerte basée dessus ; sans RDV aucune alerte", () => {
    expect(orderLogisticsAlert({ appointment_date: "2026-10-10", expected_delivery_date: "2026-10-12", status: "ordered" }, today)).toBeNull();
    expect(orderLogisticsAlert({ appointment_date: null, status: "ordered" }, today)).toBeNull();
  });
  it("RDV lointain => rien", () => {
    expect(orderLogisticsAlert({ appointment_date: "2026-10-10", expected_delivery_date: "2026-10-08", status: "ordered" }, today)).toBeNull();
  });
  it("sans livraison connue : J-1 / J0 non reçue ou partielle", () => {
    expect(orderLogisticsAlert({ appointment_date: "2026-10-04", status: "ordered" }, today)?.message).toBe("RDV demain — commande non reçue");
    expect(orderLogisticsAlert({ appointment_date: "2026-10-03", status: "partial" }, today)?.message).toBe("RDV aujourd'hui — commande partiellement reçue");
    expect(orderLogisticsAlert({ appointment_date: "2026-10-06", status: "ordered" }, today)).toBeNull();
  });
  it("commande reçue => jamais d'alerte", () => {
    expect(orderLogisticsAlert({ appointment_date: "2026-10-03", expected_delivery_date: "2026-10-05", status: "received" }, today)).toBeNull();
  });
});
