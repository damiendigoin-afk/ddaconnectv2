import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { siteHeader, type Site } from "../sites";

const base = { logo_url: null, active: true, is_default: false, email_from_name: "DDA", email_from_address: "contact@garagecastillon.fr", address: null, postal_code: null, city: null, phone: null };
const castillon = { ...base, id: "c", code: "castillon", name: "Castillon", legal_name: "Garage Castillon Veyssière", contact_email: "contact@garagecastillon.fr" } as Site;
const lalinde = { ...base, id: "l", code: "dda", name: "Damien Digoin Automobile", legal_name: null, contact_email: null } as Site;

describe("e-mail du site émetteur sur les documents", () => {
  it("Castillon garde son e-mail", () => expect(siteHeader(castillon).lines).toContain("contact@garagecastillon.fr"));
  it("Lalinde n'imprime jamais l'e-mail Castillon (expéditeur technique)", () => {
    expect(siteHeader(lalinde).lines.join(" ")).not.toContain("garagecastillon");
  });
  it("Lalinde imprime son e-mail configuré", () => {
    const l = siteHeader({ ...lalinde, contact_email: "contact@dd-lalinde.fr" });
    expect(l.lines).toContain("contact@dd-lalinde.fr");
    expect(l.lines.join(" ")).not.toContain("garagecastillon");
  });
});
