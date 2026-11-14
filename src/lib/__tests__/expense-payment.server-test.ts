import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator() { return this; },
    handler(fn: unknown) { return fn; },
  }),
}));
const read = vi.hoisted(() => vi.fn());
vi.mock("../doc-pipeline.server", () => ({ readDocument: read }));

import { ocrExpenseReceipt } from "../expense-ocr.functions";

const call = ocrExpenseReceipt as unknown as (arg: unknown) => Promise<{ ok: boolean; json: string }>;
const baseFields = {
  merchant: "Carrefour Market Saint-Cyprien",
  date: "2026-11-07",
  amount_ttc: 93.28,
  vat_amount: 15.55,
  vat_rate: 20,
  vat_amount_source: "ticket",
  quantity_litres: 44.04,
  category: "carburant",
};

beforeEach(() => {
  vi.clearAllMocks();
  read.mockResolvedValue({ fields: { ...baseFields, payment_text: "PAIEMENT CLIP PRO" }, missing: [], visionFailed: false });
});

describe("scan serveur du paiement CLIPRO", () => {
  it("renvoie En compte depuis le texte brut vision, sans choisir de sous-compte", async () => {
    const result = await call({ data: { dataUrl: "data:image/jpeg;base64,synthetic", text: "" } });
    expect(result.ok).toBe(true);
    const output = JSON.parse(result.json);
    expect(output.payment_method).toBe("en_compte");
    expect(output.payment_method_source).toBe("carrefour_clipro");
    expect(output.account_ref).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    const input = read.mock.calls[0]?.[0] as { prompt: string };
    expect(input.prompt).toContain("PAIEMENT CLIPRO");
    expect(input.prompt).toContain("compte reste un choix manuel obligatoire");
  });

  it("reconnaît aussi le texte OCR local transmis au pipeline", async () => {
    read.mockResolvedValue({ fields: baseFields, missing: [], visionFailed: false });
    const result = await call({ data: { dataUrl: "data:image/jpeg;base64,synthetic", text: "CARREFOUR MARKET LA STATION\nPAIEMENT CLIPRO 93,28" } });
    expect(JSON.parse(result.json).payment_method).toBe("en_compte");
  });

  it("ne renvoie aucun paiement En compte hors Carrefour", async () => {
    read.mockResolvedValue({ fields: { ...baseFields, merchant: "Autre station", payment_text: "PAIEMENT CLIPRO" }, missing: [], visionFailed: false });
    const result = await call({ data: { dataUrl: "data:image/jpeg;base64,synthetic", text: "" } });
    expect(JSON.parse(result.json).payment_method).toBeUndefined();
  });
});
