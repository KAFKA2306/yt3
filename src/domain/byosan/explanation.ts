import { z } from "zod";

export const ExplanationSchema = z.object({
	conclusion: z.string().min(1),
	principle: z.string().min(1),
	figures: z
		.array(
			z.object({
				metric: z.string().min(1),
				population: z.string().min(1),
				period: z.string().min(1),
				unit: z.string().min(1),
				value: z.string().min(1),
				quote: z.string().min(1),
				kind: z.enum(["actual", "estimate", "forecast"]),
			}),
		)
		.min(2),
	check: z.string().min(1),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

const squeeze = (text: string): string => text.replace(/\s+/g, "");

export function ungroundedFigureValues(
	explanation: Explanation,
	articleBodies: string[],
): string[] {
	const bodies = articleBodies.map(squeeze);
	return explanation.figures
		.filter(
			(figure) =>
				!bodies.some((body) => body.includes(squeeze(figure.quote))) ||
				!figure.quote.includes(figure.value),
		)
		.map((figure) => figure.value);
}
