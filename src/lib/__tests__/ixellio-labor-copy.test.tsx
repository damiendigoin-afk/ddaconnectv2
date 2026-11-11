// @vitest-environment jsdom
import React, { useRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/ixellio.functions", () => ({}));
import { toast } from "sonner";
import { CopyDiagButton } from "@/components/IxellioLaborDiag";

function Host() {
  const r = useRef<HTMLDivElement>(null);
  return (<div><CopyDiagButton target={r} label="Diagnostic TM v2" /><div ref={r}><div>ok — page lue</div><div>B. Formulaires (1)</div></div><div>autre outil</div></div>);
}

describe("copie diagnostic TM", () => {
  it("copie seulement le rapport ciblé, sans libellé du bouton", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: /Copier le diagnostic/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Diagnostic copié"));
    expect(writeText).toHaveBeenCalledWith("Diagnostic TM v2\nok — page lue\nB. Formulaires (1)");
  });
});
