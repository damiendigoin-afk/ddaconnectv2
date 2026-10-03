import { describe, expect, it, vi } from "vitest";
import { renaultOrderDetailRules, purchaseRules } from "@/lib/doc-rules";
import { identifySupplier } from "@/lib/supplier-identify";
import { runDocPipeline } from "@/lib/doc-pipeline";
import { RENAULT_46104548_REAL } from "./fixtures/renault-46104548-real";

const expectNickel = (f: Record<string, unknown> | null) => {
  expect(f).not.toBeNull();
  expect(f!["supplier"]).toBe("RENAULT SARLAT - GROUPE FAURIE");
  expect(f!["lines"]).toEqual([
    { reference: "8660004937", label: "MOTRIO Filtre d'habitacle -Pol", quantity: 1, unit_price: 11.64, amount: 11.64 },
    { reference: "8660003779", label: "MOTRIO Filtre à huile", quantity: 1, unit_price: 6.77, amount: 6.77 },
  ]);
  expect(f!["total_ht"]).toBe(18.41);
  expect(f!["vat_amount"]).toBe(3.68);
  expect(f!["total_ttc"]).toBe(22.09);
  expect(f!["or_number"]).toBe("50969");
  expect(f!["plate"]).toBe("EW-814-BC");
  expect(f!["order_reference"]).toBe("46104548");
  expect(f!["control_alerts"]).toEqual([]);
};

// Texte PDF.js : colonnes concaténées sur des lignes fusionnées.
const PDFJS = [
  "Commande n°: 46104548 Statut: En cours de validation Détail de commande",
  "Date : 02/10/2026 Client: GARAGE CASTILLON-VEYSSIERE Date : 02/10/2026: 2 oct. 2026 08:55 UTC+2",
  "Repère commande: 50969 Mode de livraison: Livraison à votre adresse Plaque d'immatriculation: EW814BC",
  "RENAULT Clio IV / Lutecia IV (B98) BERLINE 5-PORTES MOTEUR DIESEL 1,5 DCI [K9K]",
  "Références Réf : 8660004937 MOTRIO Filtre d'habitacle -Pol Stock: R1 : 1/6 pièces en stock Qté : 1 Prix client : 23,28 € HT 27,94 € TTC Mode de livraisonLivraison à votre adresse : 11,64 € HT En cours de validation",
  "Réf : 8660003779 MOTRIO Filtre à huile Stock: R1 : 1/36 pièces en stock Qté : 1 Prix client : 13,53 € HT 16,24 € TTC Mode de livraisonLivraison à votre adresse : 6,77 € HT En cours de validation",
  "Informations Commandé par frederic TEIXEIRA N° client 25003407 Distributeur RENAULT SARLAT - GROUPE FAURIE Compte de facturation 014001",
  "Contact Contact GARAGE CASTILLON-VEYSSIERE Téléphone 0553292023 E-mail damien@garagecastillon.fr",
  "Adresse de facturation Adresse ARGENTONESSE Code postal 24220 Ville CASTELS Pays France",
  "Total : (2 articles) Total HT : 18,41 € TVA : 3,68 € Total TTC : 22,09 €",
].join("\n");

describe("Renault 46104548 — texte réel du PDF", () => {
  it("texte natif réel : nickel, aucune alerte", () => expectNickel(renaultOrderDetailRules(RENAULT_46104548_REAL)));
  it("texte PDF.js concaténé : nickel, jamais Ville CASTELS", () => expectNickel(purchaseRules(PDFJS)));
  it("alias : rapproché de FAURIE AUTO SARLAT", () => {
    const r = identifySupplier("RENAULT SARLAT - GROUPE FAURIE", [
      { id: "s1", name: "FAURIE AUTO SARLAT", active: true },
      { id: "s2", name: "RENAULT BERGERAC - GROUPE FAURIE", active: true },
    ] as never);
    expect(JSON.stringify(r)).toContain("s1");
  });
});

const deps = (ai: Record<string, unknown> | null) => ({
  fallbackEnabled: async () => false,
  aiText: vi.fn(async () => null),
  aiVision: vi.fn(async () => null),
  logLocal: async () => {},
  aiRenault: vi.fn(async () => ai),
});

describe("Repli Gemini 3.8 Flash dédié Renault", () => {
  it("lecture complète => 0 appel IA", async () => {
    const d = deps(null);
    const r = await runDocPipeline({ kind: "purchase", text: RENAULT_46104548_REAL, hasImage: true, media: "pdf_text" }, d);
    expect(r.aiCalls).toBe(0);
    expect(d.aiRenault).not.toHaveBeenCalled();
    expectNickel(r.fields);
  });
  it("lecture incomplète => un seul appel vision (même repli IA désactivé), fusion par référence, résultat complet", async () => {
    const broken = RENAULT_46104548_REAL.replace("MOTRIO Filtre d'habitacle -Pol\n", "").replace("RENAULT SARLAT - GROUPE FAURIE\n", "");
    const d = deps({
      supplier: "RENAULT SARLAT - GROUPE FAURIE",
      lines: [
        { reference: "8660003779", label: "MOTRIO Filtre à huile", quantity: 1, unit_price: 13.53 },
        { reference: "8660004937", label: "MOTRIO Filtre d'habitacle -Pol", quantity: 1, unit_price: 23.28 },
      ],
      total_ht: 18.41,
    });
    const r = await runDocPipeline({ kind: "purchase", text: broken, hasImage: true, media: "pdf_text" }, d);
    expect(d.aiRenault).toHaveBeenCalledTimes(1);
    expect(d.aiText).not.toHaveBeenCalled();
    expect(d.aiVision).not.toHaveBeenCalled();
    expect(r.aiCalls).toBe(1);
    // PA déterministes cohérents avec le total : jamais écrasés par l'IA.
    expectNickel(r.fields);
  });
});
