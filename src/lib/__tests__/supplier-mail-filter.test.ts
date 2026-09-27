import { describe, expect, it } from "vitest";
import { documentAttachments, effectiveMailSite, isDocumentMail, isOpenRecent, operationalMails } from "@/lib/supplier-mail-filter";

const sites = [{ id: "C", code: "castillon" }, { id: "D", code: "dda" }];
const now = new Date("2026-09-27T12:00:00Z");
const base = { triage_status: "a_traiter", site_id: null, cc_addresses: [] as string[] };
const cazes = (d: string) => ({ ...base, sent_at: d, from_address: "vos.documents@groupecazes.fr", to_addresses: ["contact@garagecastillon.fr", "bl@garagecastillon.fr"], subject: "Votre original de Facture", files: ["APV_20260919_911817.pdf"] });

describe("file e-mails Pièces & achats", () => {
  it("garde les factures Cazes récentes, site Castillon", () => {
    const r = operationalMails([cazes("2026-09-19T08:00:00Z"), cazes("2026-09-17T08:00:00Z"), cazes("2026-09-09T08:00:00Z")], sites, "C", now);
    expect(r).toHaveLength(3);
    expect(r[0]!.effective_site_id).toBe("C");
    expect(operationalMails([cazes("2026-09-19T08:00:00Z")], sites, "D", now)).toHaveLength(0);
  });
  it("BL déjà traité disparaît", () => {
    expect(isOpenRecent({ sent_at: "2026-08-27T08:00:00Z", triage_status: "traite" }, now)).toBe(false);
    expect(isOpenRecent({ sent_at: "2026-09-20T08:00:00Z", triage_status: "done" }, now)).toBe(false);
  });
  it("plus de 60 jours exclu", () => {
    expect(isOpenRecent({ sent_at: "2025-06-01T08:00:00Z", triage_status: null }, now)).toBe(false);
  });
  it("exclut Mobilians, marketing, tarifs, signatures, scanner générique", () => {
    const m = (subject: string, files: string[], from = "x@mobilians.fr") => ({ from_address: from, to_addresses: ["contact@garagecastillon.fr"], cc_addresses: [], subject, files });
    expect(isDocumentMail(m("Obligations consommateurs", ["guide.pdf"]))).toBe(false);
    expect(isDocumentMail(m("Nos offres du mois", ["promo.pdf"], "anaelle.lefranc@x.fr"))).toBe(false);
    expect(isDocumentMail(m("Nouveau tarif 2026", ["tarif.pdf"]))).toBe(false);
    expect(isDocumentMail(m("Votre facture", ["image001.png", "image002.jpg"]))).toBe(false);
    expect(isDocumentMail(m("Votre Document", ["scan.pdf"], "bncyp-caisse1@x.fr"))).toBe(false);
    expect(isDocumentMail({ ...m("Votre original Bon de Livraison", ["BL.pdf"], "a.garrigou@x.fr"), to_addresses: ["bl@garagecastillon.fr"] })).toBe(true);
  });
  it("pièces jointes et site effectif", () => {
    expect(documentAttachments(["image001.png", "a.pdf"])).toEqual(["a.pdf"]);
    expect(effectiveMailSite({ site_id: null, from_address: "a@dda-lalinde.fr", to_addresses: [] }, sites)).toBe("D");
    expect(effectiveMailSite({ site_id: null, from_address: "a@dda-lalinde.fr", to_addresses: ["b@garagecastillon.fr"] }, sites)).toBeNull();
  });
});
