import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

type CheckStatus = "PASS" | "FAIL";

type CheckResult = {
	id: string;
	title: string;
	status: CheckStatus;
	details: string;
};

type AuditResult = {
	pass: boolean;
	checks: CheckResult[];
};

const REQUIRED_TIER1_SOURCES = [
	{ name: "FRED", identifier: "fred", host: "fred.stlouisfed.org" },
	{
		name: "Federal Reserve",
		identifier: "federal_reserve",
		host: "federalreserve.gov",
	},
	{ name: "US Treasury", identifier: "us_treasury", host: "home.treasury.gov" },
	{ name: "BLS", identifier: "bls", host: "bls.gov" },
	{ name: "BEA", identifier: "bea", host: "bea.gov" },
	{ name: "BIS", identifier: "bis", host: "bis.org" },
	{ name: "IMF", identifier: "imf", host: "imf.org" },
	{ name: "ECB", identifier: "ecb", host: "ecb.europa.eu" },
	{ name: "BOJ", identifier: "boj", host: "boj.or.jp" },
	{ name: "OECD", identifier: "oecd", host: "oecd.org" },
	{ name: "World Bank", identifier: "world_bank", host: "worldbank.org" },
] as const;

const FORBIDDEN_PHRASES = [
	"全部終わり",
	"絶対暴落",
	"確定",
	"爆益",
	"今すぐ買え",
	"陰謀",
] as const;

const REQUIRED_STATE_VARIABLES = [
	"liquidity",
	"fiscal",
	"rates",
	"productivity",
	"ai_capex",
	"energy",
	"supply_chain",
	"geopolitical_regime",
] as const;

const REQUIRED_PROMPT_PHRASES = [
	"一次情報なし断定禁止",
	"生活影響への接続",
] as const;

function normalize(value: unknown): string {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

function check(
	id: string,
	title: string,
	condition: boolean,
	detailsPass: string,
	detailsFail: string,
): CheckResult {
	return {
		id,
		title,
		status: condition ? "PASS" : "FAIL",
		details: condition ? detailsPass : detailsFail,
	};
}

async function readTextIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

async function readYamlIfExists(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	const text = await readTextIfExists(filePath);
	if (text === null) return null;
	if (text.trim().length === 0) return null;
	return yaml.load(text) as Record<string, unknown>;
}

async function readJsonIfExists(
	filePath: string,
): Promise<Record<string, unknown> | null> {
	const text = await readTextIfExists(filePath);
	if (text === null) return null;
	if (text.trim().length === 0) return null;
	return JSON.parse(text) as Record<string, unknown>;
}

function hasRequiredTerms(text: string, terms: readonly string[]): boolean {
	return terms.every((term) => text.includes(term));
}

function sourceMatchesRequired(
	item: Record<string, unknown>,
	required: (typeof REQUIRED_TIER1_SOURCES)[number],
): boolean {
	const name = normalize(item.name);
	const identifier = normalize(item.source_identifier);
	const url = normalize(item.url);
	return (
		name.includes(normalize(required.name)) ||
		identifier.includes(normalize(required.identifier)) ||
		url.includes(normalize(required.host))
	);
}

export async function auditByosanMoneyZeroTrust(
	rootDir = process.cwd(),
): Promise<AuditResult> {
	const configPath = path.join(rootDir, "config/domains/byosan_money.yaml");
	const sourcePolicySchemaPath = path.join(
		rootDir,
		"config/schemas/byosan_money_source_policy_v1.json",
	);
	const contentAuditSchemaPath = path.join(
		rootDir,
		"config/schemas/byosan_money_content_audit_v1.json",
	);
	const packageJsonPath = path.join(rootDir, "package.json");
	const taskfilePath = path.join(rootDir, "Taskfile.yml");
	const scriptPath = path.join(
		rootDir,
		"scripts/audit_byosan_money_zero_trust.ts",
	);
	const agentPaths = [
		path.join(rootDir, ".claude/agents/liquidity-regime-agent.md"),
		path.join(rootDir, ".claude/agents/humanity-impact-agent.md"),
	];

	const checks: CheckResult[] = [];

	const byosanConfig = await readYamlIfExists(configPath);
	checks.push(
		check(
			"config_exists",
			"byosan_money.yaml exists and is non-empty",
			byosanConfig !== null,
			"config/domains/byosan_money.yaml is readable",
			"config/domains/byosan_money.yaml is missing or empty",
		),
	);

	const sourcePolicy = byosanConfig?.source_policy as
		| Record<string, unknown>
		| undefined;
	const tier1Sources = Array.isArray(sourcePolicy?.tier1_sources)
		? (sourcePolicy?.tier1_sources as Array<Record<string, unknown>>)
		: [];
	checks.push(
		check(
			"tier1_source_list",
			"Tier 1 source list exists",
			sourcePolicy !== undefined && tier1Sources.length > 0,
			`tier1_sources=${tier1Sources.length}`,
			"source_policy.tier1_sources is missing or empty",
		),
	);

	const requiredSourceFailures: string[] = [];
	for (const required of REQUIRED_TIER1_SOURCES) {
		const matching = tier1Sources.find((item) =>
			sourceMatchesRequired(item, required),
		);
		if (!matching) {
			requiredSourceFailures.push(required.name);
			continue;
		}

		const sourceTier = Number(matching.source_tier);
		const hasUrl = String(matching.url ?? "").trim().length > 0;
		const hasIdentifier =
			String(matching.source_identifier ?? "").trim().length > 0;
		if (sourceTier !== 1 || (!hasUrl && !hasIdentifier)) {
			requiredSourceFailures.push(`${required.name} (tier/url/id invalid)`);
		}
	}
	checks.push(
		check(
			"tier1_required_sources",
			"Required Tier 1 sources are all present",
			requiredSourceFailures.length === 0,
			"All required Tier 1 sources are present with tier and URL/identifier",
			`Missing or invalid Tier 1 sources: ${requiredSourceFailures.join(", ")}`,
		),
	);

	const forbiddenPatterns = Array.isArray(sourcePolicy?.forbidden_patterns)
		? (sourcePolicy?.forbidden_patterns as unknown[]).map(String)
		: [];
	const forbiddenFailures = FORBIDDEN_PHRASES.filter(
		(phrase) => !forbiddenPatterns.some((pattern) => pattern.includes(phrase)),
	);
	checks.push(
		check(
			"forbidden_patterns",
			"Forbidden patterns include all banned hype terms",
			forbiddenFailures.length === 0,
			"All banned terms are present in forbidden_patterns",
			`Missing banned terms: ${forbiddenFailures.join(", ")}`,
		),
	);

	const requiredStateVariables = Array.isArray(
		sourcePolicy?.required_state_variables,
	)
		? (sourcePolicy?.required_state_variables as unknown[]).map(String)
		: [];
	const stateVariableFailures = REQUIRED_STATE_VARIABLES.filter(
		(variable) => !requiredStateVariables.includes(variable),
	);
	checks.push(
		check(
			"required_state_variables",
			"Required state variables include all eight requested dimensions",
			stateVariableFailures.length === 0,
			"All required state variables are present",
			`Missing state variables: ${stateVariableFailures.join(", ")}`,
		),
	);

	const sourcePolicySchemaText = await readTextIfExists(sourcePolicySchemaPath);
	checks.push(
		check(
			"source_policy_schema",
			"Source policy schema exists and is non-empty",
			sourcePolicySchemaText !== null &&
				sourcePolicySchemaText.trim().length > 0 &&
				sourcePolicySchemaText.includes("byosan_money_source_policy_v1") &&
				sourcePolicySchemaText.includes('"tier1_sources"') &&
				sourcePolicySchemaText.includes('"forbidden_patterns"') &&
				sourcePolicySchemaText.includes('"required_state_variables"'),
			"config/schemas/byosan_money_source_policy_v1.json is present",
			"config/schemas/byosan_money_source_policy_v1.json is missing or malformed",
		),
	);

	const contentAuditSchemaText = await readTextIfExists(contentAuditSchemaPath);
	checks.push(
		check(
			"content_audit_schema",
			"Content audit schema exists and is non-empty",
			contentAuditSchemaText !== null &&
				contentAuditSchemaText.trim().length > 0 &&
				contentAuditSchemaText.includes("byosan_money_content_audit_v1") &&
				contentAuditSchemaText.includes('"content_items"'),
			"config/schemas/byosan_money_content_audit_v1.json is present",
			"config/schemas/byosan_money_content_audit_v1.json is missing or malformed",
		),
	);

	const promptSources = [configPath, ...agentPaths];
	let promptText = "";
	for (const filePath of promptSources) {
		const text = await readTextIfExists(filePath);
		if (text !== null) {
			promptText += `${text}\n`;
		}
	}
	checks.push(
		check(
			"prompt_no_unbacked_assertion",
			"Byosan prompts and agents explicitly forbid unsupported assertions",
			hasRequiredTerms(promptText, [REQUIRED_PROMPT_PHRASES[0]]),
			"一次情報なし断定禁止 is present in the byosan prompts/agents",
			"一次情報なし断定禁止 is missing from the byosan prompts/agents",
		),
	);
	checks.push(
		check(
			"prompt_life_impact",
			"Byosan prompts and agents explicitly require life-impact connection",
			hasRequiredTerms(promptText, [REQUIRED_PROMPT_PHRASES[1]]),
			"生活影響への接続 is present in the byosan prompts/agents",
			"生活影響への接続 is missing from the byosan prompts/agents",
		),
	);

	const packageJson = await readJsonIfExists(packageJsonPath);
	const packageScripts =
		packageJson && typeof packageJson.scripts === "object"
			? (packageJson.scripts as Record<string, unknown>)
			: null;
	const hasPackageScript =
		packageScripts !== null && "audit:byosan-money" in packageScripts;
	const taskfileText = await readTextIfExists(taskfilePath);
	const hasTaskfileTask = taskfileText?.includes("audit:byosan-money") ?? false;
	checks.push(
		check(
			"execution_entrypoint",
			"Audit can be launched from package.json or Taskfile",
			Boolean(hasPackageScript || hasTaskfileTask),
			"Audit entrypoint is wired through package.json and/or Taskfile",
			"Neither package.json scripts nor Taskfile expose audit:byosan-money",
		),
	);

	const scriptText = await readTextIfExists(scriptPath);
	checks.push(
		check(
			"exit_code_support",
			"Audit script returns PASS/FAIL through process exit code",
			scriptText !== null &&
				(scriptText.includes("process.exitCode") ||
					scriptText.includes("process.exit(")),
			"scripts/audit_byosan_money_zero_trust.ts sets process exit code",
			"scripts/audit_byosan_money_zero_trust.ts does not set a process exit code",
		),
	);

	const pass = checks.every((entry) => entry.status === "PASS");
	return { pass, checks };
}

async function main(): Promise<void> {
	const result = await auditByosanMoneyZeroTrust(process.cwd());

	for (const checkResult of result.checks) {
		console.log(
			`[${checkResult.status}] ${checkResult.id} - ${checkResult.title}: ${checkResult.details}`,
		);
	}

	console.log(`SUMMARY: ${result.pass ? "PASS" : "FAIL"}`);
	process.exitCode = result.pass ? 0 : 1;
}

if (import.meta.main) {
	await main();
}
