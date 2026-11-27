import { z } from "zod";
import {
	BYOSAN_NUMBER_PATTERN,
	canonicalNumber,
} from "./number_canonicalization.js";

export const ExplanationSchema = z.object({
	conclusion: z.string().min(1),
	principle: z.string().min(1),
	figures: z.array(
		z.object({
			metric: z.string().min(1),
			population: z.string().min(1),
			period: z.string().min(1),
			unit: z.string().min(1),
			value: z.string().min(1),
			quote: z.string().min(1),
			kind: z.enum(["actual", "estimate", "forecast"]),
		}),
	),
	check: z.string().min(1),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

const squeeze = (text: string): string =>
	text.normalize("NFKC").replace(/\s+/g, "");
const containsFigureValue = (quote: string, value: string): boolean => {
	const valueNumbers =
		value.normalize("NFKC").match(BYOSAN_NUMBER_PATTERN) ?? [];
	const quoteNumbers = new Set(
		(quote.normalize("NFKC").match(BYOSAN_NUMBER_PATTERN) ?? []).map(
			canonicalNumber,
		),
	);
	return (
		valueNumbers.length > 0 &&
		valueNumbers.some((token) => quoteNumbers.has(canonicalNumber(token)))
	);
};

export function ungroundedFigureValues(
	explanation: Explanation,
	articleBodies: string[],
): string[] {
	const bodies = articleBodies.map(squeeze);
	return explanation.figures
		.filter(
			(figure) =>
				!bodies.some((body) => body.includes(squeeze(figure.quote))) ||
				!containsFigureValue(figure.quote, figure.value),
		)
		.map((figure) => figure.value);
}
