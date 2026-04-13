import { z } from "zod";
import { ScriptLineSchema } from "./script.js";

export const FinancialFindingSchema = z.object({
	company: z.string().optional(),
	summary: z.string(),
	edinet_key_metrics: z.record(z.string(), z.string()).optional(),
});
export type FinancialFinding = z.infer<typeof FinancialFindingSchema>;

export const ContentOutlineSchema = z.object({
	title: z.string(),
	sections: z.array(
		z.object({
			title: z.string(),
			key_points: z.array(z.string()),
			estimated_duration: z.number(),
		}),
	),
});

export const ContentSegmentSchema = z.object({
	lines: z.array(ScriptLineSchema),
});
