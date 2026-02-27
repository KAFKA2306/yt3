import { z } from "zod";
export const AceBulletSchema = z.object({
	id: z.string(),
	content: z.string(),
	source: z.enum(["Acquisition", "Evolution", "Analytics"]),
	confidence: z.number().min(0).max(1),
	runs: z.number().default(0),
	successes: z.number().default(0),
	category: z.string().optional(),
	last_used: z.string().optional(),
});
export type AceBullet = z.infer<typeof AceBulletSchema>;
export const PlaybookSchema = z.object({
	bullets: z.array(AceBulletSchema),
});
export type Playbook = z.infer<typeof PlaybookSchema>;
export const EvaluationSignalSchema = z.object({
	bullet_id: z.string(),
	success: z.boolean(),
	reason: z.string(),
	weight: z.number().default(1.0),
});
export type EvaluationSignal = z.infer<typeof EvaluationSignalSchema>;
export const HypothesisSchema = z.object({
	content: z.string(),
	rationale: z.string(),
	category: z.string().optional(),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;
