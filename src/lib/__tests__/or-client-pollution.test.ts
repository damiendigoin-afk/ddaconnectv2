import { describe, expect, it } from "vitest";
import { sanitizeRepairOrder, stripOrAdminLabels } from "../doc-rules";
import { clientSuspicions, cutGarageTail, isGarageName, isGaragePhone, stripGarageContacts } from "../garage-identity";
import { captureSummary } from "../or-client-review";

type F = Record<string, Record<string, unknown>>;
const clean = (client: Record<string, unknown>) => (sanitizeRepairOrder({ client, vehicle: {}, order: {} }).fields as F)["client"]!;

describe("OR 17220 — « YOLANDE SAS DAMIEN », téléphone garage mal lu", () => {
  const read = { last_name: "SAS DAMIEN", first_name: "YOLANDE", account_number: "003269", phone: "05 52 24 77 18", mobile: "06 22 77 28 43", address: "302C CHEMIN DES POURROUTOUX" };
  it("nom garage tronqué retiré, prénom/compte/mobile/adresse conservés", () => {
    const c = stripGarageContacts(clean(read));
    expect(c["last_name"] ?? null).toBeNull();
    expect(c["first_name"]).toBe("YOLANDE");
    expect(c["account_number"]).toBe("003269");
    expect(c["mobile"]).toBe("06 22 77 28 43");
    expect(c["phone"] ?? null).toBeNull();
    expect(c["address"]).toBe("302C CHEMIN DES POURROUTOUX");
  });
  it("fiche existante signalée", () => {
    expect(clientSuspicions(read)).toEqual(expect.arrayContaining(["nom_garage", "telephone_garage"]));
  });
});

describe("OR 17167 — « RÉGIS O.A.M SAS DAMIEN DIGOIN A »", () => {
  it("en-tête complet retiré, prénom gardé, aucun nom de famille inventé", () => {
    const c = stripGarageContacts(clean({ last_name: "SAS DAMIEN DIGOIN A", first_name: "RÉGIS O.A.M", account_number: "002315", phone: "05 53 24 04 81" }));
    expect(c["last_name"] ?? null).toBeNull();
    expect(c["first_name"]).toBe("RÉGIS O.A.M");
    expect(c["phone"]).toBe("05 53 24 04 81"); // 3 chiffres d'écart : pas le garage
    expect(c["account_number"]).toBe("002315");
  });
  it("fin d'en-tête collée au nom coupée", () => {
    expect(cutGarageTail("REGIS SAS DAMIEN DIGOIN A")).toEqual({ value: "REGIS", cut: true });
  });
});

describe("OR 16441 — nom doublé et date dans l'adresse", () => {
  it("prénom retiré du nom, date tronquée retirée de l'adresse", () => {
    const c = clean({ last_name: "AUDOIN VERONIQUE", first_name: "VERONIQUE", address: "05/08/2 58 PLACE DE L AMANDIER" });
    expect(c["last_name"]).toBe("AUDOIN");
    expect(c["first_name"]).toBe("VERONIQUE");
    expect(c["address"]).toBe("58 PLACE DE L AMANDIER");
  });
  it("« 12/14 rue » n'est pas une date", () => {
    expect(stripOrAdminLabels("12/14 RUE DES ECOLES")).toBe("12/14 RUE DES ECOLES");
  });
  it("fiche existante signalée", () => {
    expect(clientSuspicions({ last_name: "AUDOIN VERONIQUE", first_name: "VERONIQUE", address: "05/08/2 58 PLACE DE L AMANDIER" })).toEqual(["adresse_date", "prenom_double"]);
  });
});

describe("OR 17257 — aucun client lu", () => {
  it("signalé comme absent", () => {
    expect(clientSuspicions(null)).toEqual(["client_absent"]);
  });
  it("brouillon de capture lisible", () => {
    expect(captureSummary({ first_name: "YOLANDE", account_number: "003269", mobile: "06 22 77 28 43" })).toBe("Prénom : YOLANDE · Compte : 003269 · Mobile : 06 22 77 28 43");
  });
});

describe("téléphone garage lu par OCR", () => {
  it("exact et à un chiffre près rejetés", () => {
    expect(isGaragePhone("05 53 24 77 18")).toBe(true);
    expect(isGaragePhone("05 52 24 77 18")).toBe(true);
    expect(isGaragePhone("+33 5 53 29 20 23")).toBe(true);
  });
  it("numéro client voisin de deux chiffres conservé", () => {
    expect(isGaragePhone("05 53 24 77 81")).toBe(false);
    expect(isGaragePhone("06 22 77 28 43")).toBe(false);
  });
});

describe("vrais noms préservés", () => {
  it("sociétés et prénoms Damien non confondus avec le garage", () => {
    expect(isGarageName("SARL TRANSPORTS DUPONT")).toBe(false);
    expect(isGarageName("DAMIEN MARTIN")).toBe(false);
    expect(isGarageName("SAS DUPONT")).toBe(false);
    expect(clean({ last_name: "SARL TRANSPORTS DUPONT", first_name: null })["last_name"]).toBe("SARL TRANSPORTS DUPONT");
  });
  it("nom propre sans doublon inchangé", () => {
    expect(clientSuspicions({ last_name: "PELTIER", first_name: "YOLANDE", mobile: "0622772843", address: "302C CHEMIN" })).toEqual([]);
  });
});
