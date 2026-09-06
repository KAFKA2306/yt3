import { z } from "zod";

export const DigestBaselineStatusSchema = z.enum([
	"UNCHANGED",
	"REALIGNED",
	"UNVERIFIED",
]);

export const DigestBaselineAlignmentSchema = z.object({
	metric: z.string().min(2).max(120),
	authorityName: z.string().min(2).max(120),
	authorityUrl: z.string().url(),
	baselineVersion: z.string().min(1).max(80),
	baselineAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	status: DigestBaselineStatusSchema,
	inputs: z
		.array(
			z.object({
				runId: z.string().min(1),
				originalValue: z.string().min(1),
				originalBaselineVersion: z.string().min(1).max(80).optional(),
				originalAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				normalizedValue: z.string().min(1).optional(),
				formula: z.string().min(3).max(300).optional(),
			}),
		)
		.min(1),
	limitations: z.array(z.string().min(3).max(300)).max(6),
});

export const DigestMacroSynthesisSchema = z.object({
	axis: z.enum([
		"structure",
		"relative_economics",
		"policy_distribution_risk",
	]),
	claim: z.string().min(12).max(500),
	sourceRunIds: z.array(z.string().min(1)).min(1),
	sourceClaimIds: z.array(z.string().min(1)).min(1),
	sourceUrls: z.array(z.string().url()).min(1),
});

export const DigestWatchlistItemSchema = z.object({
	event: z.string().min(3).max(180),
	scheduledAt: z.string().datetime(),
	status: z.enum(["confirmed", "tentative"]),
	sourceUrl: z.string().url(),
	whatWouldChange: z.string().min(8).max(300),
});

export const DigestNavigationSchema = z.object({
	runId: z.string().min(1),
	title: z.string().min(3),
	videoUrl: z.string().url().optional(),
});

export const ByosanDigestContextSchema = z.object({
	schemaVersion: z.literal("byosan_digest_context_v2"),
	period: z.enum(["week", "month"]),
	start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	baselineAlignments: z.array(DigestBaselineAlignmentSchema),
	macroSynthesis: z.array(DigestMacroSynthesisSchema).length(3),
	watchlist: z.array(DigestWatchlistItemSchema).min(3).max(5),
	navigation: z.array(DigestNavigationSchema).min(1),
});

export type ByosanDigestContext = z.infer<typeof ByosanDigestContextSchema>;

export type DigestContextIssue = {
	code: string;
	details: string;
};

export function auditByosanDigestContext(
	input: ByosanDigestContext,
	inputRunIds: string[],
	claimIdsByRun: Map<string, Set<string>>,
): DigestContextIssue[] {
	const context = ByosanDigestContextSchema.parse(input);
	const issues: DigestContextIssue[] = [];
	const allowedRuns = new Set(inputRunIds);

	for (const alignment of context.baselineAlignments) {
		for (const item of alignment.inputs) {
			if (!allowedRuns.has(item.runId)) {
				issues.push({
					code: "baseline_unknown_input_run",
					details: `${alignment.metric}: ${item.runId}`,
				});
			}
			const baselineChanged =
				(item.originalBaselineVersion !== undefined &&
					item.originalBaselineVersion !== alignment.baselineVersion) ||
				item.originalAsOf !== alignment.baselineAsOf;
			if (alignment.status === "UNCHANGED" && baselineChanged) {
				issues.push({
					code: "baseline_mismatch_not_realigned",
					details: `${alignment.metric}: ${item.runId}`,
				});
			}
			if (alignment.status === "REALIGNED") {
				if (!item.normalizedValue || !item.formula) {
					issues.push({
						code: "realignment_provenance_incomplete",
						details: `${alignment.metric}: ${item.runId}`,
					});
				}
			}
			if (
				alignment.status === "UNVERIFIED" &&
				(item.normalizedValue || item.formula)
			) {
				issues.push({
					code: "unverified_baseline_must_not_fake_normalization",
					details: `${alignment.metric}: ${item.runId}`,
				});
			}
		}
	}

	for (const synthesis of context.macroSynthesis) {
		for (const runId of synthesis.sourceRunIds) {
			if (!allowedRuns.has(runId)) {
				issues.push({
					code: "synthesis_unknown_input_run",
					details: `${synthesis.axis}: ${runId}`,
				});
			}
		}
		const unionClaims = new Set(
			synthesis.sourceRunIds.flatMap((runId) => [
				...(claimIdsByRun.get(runId) ?? new Set<string>()),
			]),
		);
		for (const claimId of synthesis.sourceClaimIds) {
			if (!unionClaims.has(claimId)) {
				issues.push({
					code: "synthesis_claim_provenance_missing",
					details: `${synthesis.axis}: ${claimId}`,
				});
			}
		}
	}

	for (const nav of context.navigation) {
		if (!allowedRuns.has(nav.runId)) {
			issues.push({
				code: "navigation_unknown_input_run",
				details: nav.runId,
			});
		}
	}

	return issues;
}

export function formatDigestWatchlistItem(
	item: z.infer<typeof DigestWatchlistItemSchema>,
): string {
	const prefix = item.status === "tentative" ? "暫定予定" : "確定予定";
	return `${prefix}: ${item.event} (${item.scheduledAt})。注目点: ${item.whatWouldChange}`;
}
