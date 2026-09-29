import { describe, expect, it } from "vitest";
import { repairOrderRules } from "../doc-rules";
import { isGarageName, normText, stripGarageContacts } from "../garage-identity";

type F = Record<string, Record<string, unknown>>;

const LALINDE = `SAS DAMIEN DIGOIN AUTOMOBILE
27, AVENUE EUGENE LEROY
24150 LALINDE
Tél : 05 53 24 77 18
contact@dda-lalinde.fr
ORDRE DE REPARATION N° 16991
Client : M. MARTIN Paul
4 rue des Chênes
24480 LE BUISSON
Portable : 06 11 22 33 44
paul.martin@orange.fr
Immat : HG 732 GH`;

const CASTILLON = `GARAGE CASTILLON VEYSSIERE
contact@garagecastillon.fr
ORDRE DE REPARATION N° 50826
Client : MME DURAND Claire
claire.durand@gmail.com
Immat : DM-418-KV`;

describe("scan OR : coordonnées du garage exclues", () => {
  it("Lalinde : seul l'e-mail / téléphone / adresse client sont retenus", () => {
    const c = (repairOrderRules(LALINDE) as F)["client"]!;
    expect(c["email"]).toBe("paul.martin@orange.fr");
    expect(c["phone"]).toBeNull();
    expect(c["mobile"]).toBe("06 11 22 33 44");
    expect(c["last_name"]).toBe("MARTIN");
    expect(c["postal_code"]).toBe("24480");
  });
  it("Castillon : même principe", () => {
    const c = (repairOrderRules(CASTILLON) as F)["client"]!;
    expect(c["email"]).toBe("claire.durand@gmail.com");
    expect(c["last_name"]).toBe("DURAND");
  });
  it("aucune fiche interne DDA retenue comme client", () => {
    const s = stripGarageContacts({ last_name: "SAS DAMIEN DIGOIN AUTOMOBILE", account_number: "004238", email: "contact@dda-lalinde.fr", phone: "0553247718", address: "27, AVENUE EUGENE LEROY" });
    expect(s).toEqual({});
    expect(isGarageName("DAMIEN DIGOIN AUTOMOBILE")).toBe(true);
    expect(isGarageName("MARTIN")).toBe(false);
  });
  it("données du site actif utilisées (multi-sites)", () => {
    const s = stripGarageContacts({ email: "atelier@nouveau-garage.fr", phone: "05 00 00 00 01" }, { email_from_address: "contact@nouveau-garage.fr", phone: "0500000001" });
    expect(s).toEqual({});
  });
  it("adresse identique à la casse/accents près = équivalente", () => {
    expect(normText("27, AVENUE EUGENE LEROY")).toBe(normText("27 Avenue Eugène Leroy"));
  });
});
