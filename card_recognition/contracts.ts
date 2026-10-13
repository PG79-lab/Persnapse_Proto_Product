import { z } from "zod";

import { businessCardDraftV1Schema } from "../src/domain/business-card/business-card-draft";

export const confirmCardFieldsRequestSchema = z
  .object({ draft: businessCardDraftV1Schema })
  .strict();

const cardPointSchema = z
  .object({
    x: z.number().finite().min(0).max(20_000),
    y: z.number().finite().min(0).max(20_000),
  })
  .strict();

export const restoredCardMetadataSchema = z
  .object({
    corners: z.tuple([
      cardPointSchema,
      cardPointSchema,
      cardPointSchema,
      cardPointSchema,
    ]),
    coverage: z.number().finite().min(0.01).max(1),
  })
  .strict();
