import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const fileInput = z.object({ dataUrl: z.string().min(10), filename: z.string().optional() });

export const analyzeExpertReportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const { analyzeExpertReport } = await import("./bodyshop-ai.server");
    return analyzeExpertReport(data.dataUrl, data.filename);
  });

export const analyzeCreditNoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const { analyzeCreditNote } = await import("./bodyshop-ai.server");
    return analyzeCreditNote(data.dataUrl, data.filename);
  });

export const analyzeScanFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const { analyzeScan } = await import("./bodyshop-ai.server");
    return analyzeScan(data.dataUrl, data.filename);
  });

const batchInput = z.object({
  images: z.array(z.object({ dataUrl: z.string().min(10), filename: z.string().optional() })).min(1),
});

export const analyzeReturnBatchFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => batchInput.parse(data))
  .handler(async ({ data }) => {
    const { analyzeReturnBatch } = await import("./bodyshop-ai.server");
    return analyzeReturnBatch(data.images);
  });
