import { vi, it, expect } from "vitest";
const send = vi.fn(async () => ({ ok: true, status: 200, id: "mock-message" }));
vi.mock("../email.server", () => ({ sendEmailWithAttachments: send, brandedEmail: (s: string) => s }));

it("transmet une correction ciblée avec pièce jointe et clé stable sans mail réel", async () => {
  const { sendExpenseToAccounting } = await import("../expense-mail.server");
  const result = await sendExpenseToAccounting({ to: "compta@dda-lalinde.fr", personal: false, amount: "94,39 €", merchant: "Carrefour", siteLabel: "Castillon", spentOn: "12/10/2026", purpose: "Extourne ancienne affectation", paymentLabel: "En compte", authorName: "Test", validatorName: "Test", pdfBase64: "PDF-MOCK", filename: "v2.pdf", idempotencyKey: "expense:test:v2:cancel:compta@dda-lalinde.fr", revisionNotice: "ANNULE note test v1 — correction v2" });
  expect(result.providerId).toBe("mock-message");
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "compta@dda-lalinde.fr", subject: "ANNULE note test v1 — correction v2", attachments: [{ filename: "v2.pdf", content: "PDF-MOCK" }], idempotencyKey: "expense:test:v2:cancel:compta@dda-lalinde.fr" }));
});