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
	alpha: z.number().default(1),
	beta: z.number().default(1),
});
export type AceBullet = z.infer<typeof AceBulletSchema>;

export const PlaybookSchema = z.object({
	bullets: z.array(AceBulletSchema),
});
export type Playbook = z.infer<typeof PlaybookSchema>;
