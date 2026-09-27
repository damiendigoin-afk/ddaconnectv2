import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { loadPublicQuote, respondPublicLine, selectPublicTireOffer } from "./quote-client.server";

export const getPublicQuote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(8).max(120) }).parse(d))
  .handler(async ({ data }) => loadPublicQuote(data.token));

export const respondQuoteLine = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(8).max(120),
        lineId: z.string().uuid(),
        response: z.enum(["accepted", "refused", "later", "contact", "pending"]),
        comment: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    respondPublicLine({
      token: data.token,
      lineId: data.lineId,
      response: data.response,
      ...(data.comment ? { comment: data.comment } : {}),
    }),
  );

export const choosePublicTireOffer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: z.string().min(8).max(120), lineId: z.string().uuid(), slot: z.string().min(2).max(50) }).parse(d))
  .handler(async ({ data }) => selectPublicTireOffer(data));
