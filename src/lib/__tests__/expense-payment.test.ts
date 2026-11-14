import { describe, expect, it } from "vitest";

import { detectCarrefourCliproPayment, paymentMethodAfterScan } from "../expense-payment";

describe("paiement Carrefour CLIPRO", () => {
  it("Carrefour Market LA STATION + PAIEMENT CLIPRO => En compte", () => {
    expect(detectCarrefourCliproPayment({}, "Carrefour market LA STATION\nTOTAL 61,33\nPAIEMENT CLIPRO 61,33")).toBe("en_compte");
  });

  it.each(["PAIEMENT CLIP PRO", "Paiement cli pro", "PAIEMENT C L I P R O", "PAIEMENT CL1PR0"])(
    "reconnaît la variante bornée %s",
    (line) => {
      expect(detectCarrefourCliproPayment({ merchant: "CARREFOUR MARKET" }, line)).toBe("en_compte");
    },
  );

  it("utilise aussi les lignes de paiement brutes renvoyées par la vision", () => {
    expect(detectCarrefourCliproPayment({ merchant: "Carrefour Market Saint-Cyprien", payment_text: "PAIEMENT CLIPRO" })).toBe("en_compte");
  });

  it("un carburant Carrefour sans CLIPRO ne change pas le règlement", () => {
    expect(detectCarrefourCliproPayment({}, "CARREFOUR MARKET\nGazole 44,04 L\nPAIEMENT CB 93,28")).toBeNull();
  });

  it("n'exige pas Carrefour dans la même ligne mais exige un contexte paiement", () => {
    expect(detectCarrefourCliproPayment({ merchant: "Carrefour" }, "CLIPRO sans autre indication")).toBeNull();
  });

  it("Pro CB explicite sur un ticket non Carrefour ne devient jamais En compte", () => {
    expect(detectCarrefourCliproPayment({}, "RESTAURANT DU CENTRE\nPRO CB\nPAIEMENT 28,75")).toBeNull();
    expect(detectCarrefourCliproPayment({}, "AUTRE STATION\nPAIEMENT CLIPRO")).toBeNull();
  });

  it("le signal explicite prime sur Perso par défaut", () => {
    expect(paymentMethodAfterScan("perso", "en_compte", false)).toBe("en_compte");
  });

  it("la correction utilisateur Pro CB ou Perso reste prioritaire", () => {
    expect(paymentMethodAfterScan("pro_cb", "en_compte", true)).toBe("pro_cb");
    expect(paymentMethodAfterScan("perso", "en_compte", true)).toBe("perso");
  });
});
