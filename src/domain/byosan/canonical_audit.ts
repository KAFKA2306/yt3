type CanonicalAuditCheck = {
	name: string;
	description: string;
	status: "PASS" | "FAIL";
	details: string;
	critical: true;
	type: "DETERMINISTIC";
};

type CanonicalAuditClaim = {
	id?: string;
	sourceIds: string[];
	status: string;
};

type CanonicalAuditSource = { id: string; url: string };

export type CanonicalAuditInput = {
	claims: CanonicalAuditClaim[];
	sources: CanonicalAuditSource[];
	explanationIssues: string[];
	allowedHosts: string[];
	productionReport: {
		path: string;
		decision: string;
		requirements: Record<string, { status: string }>;
	};
	specPath: string;
	explanationPath: string;
};

type CanonicalAudit = Record<string, CanonicalAuditCheck>;

function check(
	name: string,
	description: string,
	failures: string[],
	details: string,
): CanonicalAuditCheck {
	return {
		name,
		description,
		status: failures.length === 0 ? "PASS" : "FAIL",
		details: failures.length === 0 ? details : failures.join("; "),
		critical: true,
		type: "DETERMINISTIC",
	};
}

export function hostOf(url: string): string {
	return new URL(url).hostname;
}

function isAllowedHost(host: string, allowedHosts: string[]): boolean {
	return allowedHosts.some(
		(allowed) => host === allowed || host.endsWith(`.${allowed}`),
	);
}

export function buildCanonicalAudit(
	input: CanonicalAuditInput,
): CanonicalAudit {
	const sourceIds = new Set(input.sources.map((source) => source.id));
	const unlinkedClaims = input.claims
		.filter(
			(claim) =>
				claim.sourceIds.length === 0 ||
				claim.sourceIds.some((id) => !sourceIds.has(id)) ||
				claim.status.trim() === "",
		)
		.map((claim) => claim.id ?? "(no id)");
	const factualFailures = [
		...(unlinkedClaims.length > 0
			? [
					`claims without a resolvable source or status: ${unlinkedClaims.join(",")}`,
				]
			: []),
		...input.explanationIssues,
	];
	const disallowedSources = input.sources
		.filter((source) => !isAllowedHost(hostOf(source.url), input.allowedHosts))
		.map((source) => `${source.id}=${hostOf(source.url)}`);
	const productionFailures = [
		...(input.productionReport.decision === "PASS"
			? []
			: [`decision=${input.productionReport.decision}`]),
		...Object.entries(input.productionReport.requirements)
			.filter(([, requirement]) => requirement.status !== "PASS")
			.map(([name, requirement]) => `${name}=${requirement.status}`),
	];

	return {
		production_quality: check(
			"production_quality",
			"Production quality report decision and every requirement must PASS",
			productionFailures,
			input.productionReport.path,
		),
		factual_integrity: check(
			"factual_integrity",
			"Every claim links to a declared source and the explanation figures match the script",
			factualFailures,
			`${input.specPath}; ${input.explanationPath}`,
		),
		provenance: check(
			"provenance",
			"Every script source resolves to the discovery registry or the source policy allowlist",
			disallowedSources.map((entry) => `disallowed ${entry}`),
			input.specPath,
		),
	};
}
