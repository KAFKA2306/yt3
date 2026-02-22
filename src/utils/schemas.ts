import { z } from "zod";

export const IqaResultSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  metrics: z.object({
    sharpness: z.number(),
    contrastRatio: z.number(),
    isResolutionCorrect: z.boolean(),
    cognitiveRecognitionScore: z.number(),
    xHeightLegibilityScore: z.number(),
    mobileEdgeStrength: z.number(),
  }),
  backgroundRisk: z.enum(["low", "medium", "high"]),
  textLayout: z
    .object({
      isTextClipped: z.boolean(),
      clipBoundaryRatio: z.number(),
      isTextOverlappingCharacter: z.boolean(),
      overlapRatio: z.number(),
    })
    .optional(),
  reason: z.string().optional(),
});

export type IqaResult = z.infer<typeof IqaResultSchema>;
