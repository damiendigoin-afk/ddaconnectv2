import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { analyzeTireLabel, analyzeTireWheel } from "./tire-ai.server";

const images = z.object({ images: z.array(z.string().min(10)).min(1).max(5) });

export const analyzeWheelPhotos = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => images.parse(d))
  .handler(async ({ data }) => {
    const res = await analyzeTireWheel(data.images);
    return { ok: res.ok, error: res.ok ? "" : res.error, json: res.analysis ? JSON.stringify(res.analysis) : "" };
  });

export const analyzeTireLabelPhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => images.parse(d))
  .handler(async ({ data }) => {
    const res = await analyzeTireLabel(data.images);
    return { ok: res.ok, error: res.ok ? "" : res.error, json: res.label ? JSON.stringify(res.label) : "" };
  });
