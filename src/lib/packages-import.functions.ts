import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  dataUrl: z.string().min(10),
  filename: z.string().optional(),
  pageFrom: z.number().int().positive().optional(),
  pageTo: z.number().int().positive().optional(),
});

export const analyzePackageMementoFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const { analyzePackageMemento } = await import("./packages-import.server");
    return analyzePackageMemento(data.dataUrl, data.filename, data.pageFrom, data.pageTo);
  });
