import { describe, expect, it } from "vitest";
import { resolveOrForOrder, type LinkOr, type LinkOrder } from "../or-order-link";
import { cleanOrFreeText, emailLooksDegraded, sanitizeRepairOrder } from "../doc-rules";
import { formatDateOnly, formatWorkshopDateTime, workshopLocalToIso } from "../datetime";

const CAST = "23f64579-eaa9-406d-aec7-d29731ba0020";
const OR50888: LinkOr = { id: "bcf1c7af", site_id: CAST, or_number: "50888", plate: "ET-875-QJ" };
const order = (p: Partial<LinkOrder> = {}): LinkOrder => ({ site_id: CAST, repair_order_id: null, requested_or_number: "50888", plate: "et875qj", destination: "or", status: "ordered", ...p });

describe("liaison commande ↔ OR WinMotor", () => {
  it("cas réel 50888 : plaque sans tirets en minuscules => OR lié", () => expect(resolveOrForOrder(order(), [OR50888])).toBe("bcf1c7af"));
  it("commande saisie avant le dossier : aucun OR => rien, puis lié dès que l'OR existe", () => {
    expect(resolveOrForOrder(order(), [])).toBeNull();
    expect(resolveOrForOrder(order(), [OR50888])).toBe("bcf1c7af");
  });
  it("commande saisie après : repère « 050888 » normalisé", () => expect(resolveOrForOrder(order({ requested_or_number: " 050888 " }), [OR50888])).toBe("bcf1c7af"));
  it("sites distincts => jamais lié", () => expect(resolveOrForOrder(order({ site_id: "autre" }), [OR50888])).toBeNull());
  it("plaque contradictoire => pas de rapprochement", () => expect(resolveOrForOrder(order({ plate: "AA-123-BB" }), [OR50888])).toBeNull());
  it("repère libre sans OR correspondant / n° commande fournisseur => rien", () => {
    expect(resolveOrForOrder(order({ requested_or_number: "27173596" }), [OR50888])).toBeNull();
    expect(resolveOrForOrder(order({ requested_or_number: null }), [OR50888])).toBeNull();
  });
  it("OR ambigu (deux fiches) => rien", () => expect(resolveOrForOrder(order(), [OR50888, { ...OR50888, id: "x" }])).toBeNull());
  it("commande annulée ou stock => rien ; déjà liée => conservée", () => {
    expect(resolveOrForOrder(order({ status: "cancelled" }), [OR50888])).toBeNull();
    expect(resolveOrForOrder(order({ destination: "stock" }), [OR50888])).toBeNull();
    expect(resolveOrForOrder(order({ repair_order_id: "keep" }), [OR50888])).toBe("keep");
  });
});

describe("scan OR 50888 (SALAZAR BLANCHEZ)", () => {
  const raw = {
    client: { last_name: "SALAZAR", first_name: "BLANCHEZ CECILE SAS CASTILLON", email: "cecite.solazar13@gmoail.com" },
    vehicle: { plate: "ET875QJ", model: "306 XR" },
    order: { or_number: "50888", client_remarks: "(O] are DA] coue\nFUITEDE CARBURANT", requested_work: "prix unitaire non remisé ttc : 67,41€\nREMPLACEMENT DURITE REMPLISSAGE RESERVOIR CARBURANT\noe\nATD DURITE RESERVOIR METZGER 2152010 70.00\nERD ç" },
  };
  const { fields } = sanitizeRepairOrder(raw);
  const c = fields["client"] as Record<string, unknown>, o = fields["order"] as Record<string, unknown>;
  it("garage retiré du nom et découpage signalé à vérifier (vision)", () => {
    expect(String(c["first_name"])).not.toMatch(/SAS|CASTILLON/);
    expect(fields["_suspect"]).toEqual(expect.arrayContaining(["client.last_name", "client.first_name", "client.email"]));
  });
  it("e-mail dégradé détecté, e-mail correct accepté", () => {
    expect(emailLooksDegraded("cecite.solazar13@gmoail.com", ["salazar", "cecile"])).toBe(true);
    expect(emailLooksDegraded("cecile.salazar.13@gmail.com", ["salazar", "cecile"])).toBe(false);
  });
  it("remarques/travaux nettoyés des parasites", () => {
    expect(o["client_remarks"]).toBe("FUITE DE CARBURANT");
    expect(o["requested_work"]).toBe("REMPLACEMENT DURITE REMPLISSAGE RESERVOIR CARBURANT\nATD DURITE RESERVOIR METZGER 2152010 70.00");
    expect(cleanOrFreeText("Vidange\nPlaquettes AV")).toBe("Vidange\nPlaquettes AV");
  });
  it("plaque normalisée, kilométrage jamais inventé", () => {
    expect((fields["vehicle"] as Record<string, unknown>)["plate"]).toBe("ET-875-QJ");
    expect((fields["vehicle"] as Record<string, unknown>)["mileage"]).toBeUndefined();
  });
});

describe("dates/heures atelier sans décalage", () => {
  it("entrée 26/09 12:20 Paris => 10:20Z et réaffichée 12:20 quel que soit l'appareil", () => {
    expect(workshopLocalToIso("2026-09-26T12:20")).toBe("2026-09-26T10:20:00.000Z");
    expect(formatWorkshopDateTime("2026-09-26T10:20:00+00")).toBe("26/09/2026 12:20");
  });
  it("restitution sans heure => date seule ; ouverture => 26/09", () => {
    expect(formatWorkshopDateTime("2026-09-25T22:00:00+00")).toBe("26/09/2026");
    expect(formatDateOnly("2026-09-26")).toBe("26/09/2026");
  });
});
