import path from "node:path";
import fs from "fs-extra";

type Check = {
	name: string;
	status: "PASS" | "FAIL";
	details: string;
};

type AuditScope = "source" | "runtime" | "all";

const ROOT = process.cwd();
const SOURCE_ROOTS = [
	"src",
	"scripts",
	"config",
	"Taskfile.yml",
	"package.json",
];
const FORBIDDEN_CODE_PATTERNS = [
	/FALLBACK_SUCCESS/,
	/QUOTA_FALLBACK/,
	/LLM_FALLBACK/,
	/PUBLISH_FALLBACK/,
	/buildFallback[A-Za-z0-9_]*/,
	/findLatestVideoForBucket/,
	/ls\s+-td[^\n]*runs\/[^\n]*\|\s*head\s+-n\s*1/,
	/kind:\s*["']fallback["']/,
	/usedFallback/,
];
const ALLOWED_PATTERN_FILES = new Set([
	"src/scripts/audit_no_fallback_policy.ts",
]);

function pass(name: string, details: string): Check {
	return { name, status: "PASS", details };
}

function fail(name: string, details: string): Check {
	return { name, status: "FAIL", details };
}

function resolveScope(args: string[]): AuditScope {
	const raw = args
		.find((arg) => arg.startsWith("--scope="))
		?.slice("--scope=".length);
	if (!raw) return "all";
	if (raw === "source" || raw === "runtime" || raw === "all") return raw;
	throw new Error(`Unknown audit scope '${raw}'. Expected source, runtime, or all.`);
}

function listFiles(target: string): string[] {
	const targetPath = path.join(ROOT, target);
	if (!fs.existsSync(targetPath)) return [];
	if (fs.statSync(targetPath).isFile()) return [targetPath];
	return fs
		.readdirSync(targetPath)
		.flatMap((name) => listFiles(path.join(target, name)));
}

function scanForbiddenCode(): Check {
	const matches: string[] = [];
	for (const sourceRoot of SOURCE_ROOTS) {
		for (const filePath of listFiles(sourceRoot)) {
			const relativePath = path.relative(ROOT, filePath);
			if (ALLOWED_PATTERN_FILES.has(relativePath)) continue;
			if (
				!/\.(ts|tsx|js|json|ya?ml|sh)$/.test(filePath) &&
				relativePath !== "Taskfile.yml"
			) {
				continue;
			}
			const text = fs.readFileSync(filePath, "utf8");
			for (const pattern of FORBIDDEN_CODE_PATTERNS) {
				if (pattern.test(text)) matches.push(`${relativePath}: ${pattern}`);
			}
		}
	}
	return matches.length === 0
		? pass(
				"forbidden_code_patterns",
				"no fallback implementation or implicit latest-run selection hooks found",
			)
		: fail("forbidden_code_patterns", matches.join("; "));
}

function auditFallbackReceipts(): Check {
	const pulseRoot = path.join(ROOT, "runs", "pulse_nlm");
	if (!fs.existsSync(pulseRoot)) {
		return pass("fallback_receipts_deleted", "no pulse_nlm runs found");
	}
	const failures: string[] = [];
	for (const runName of fs.readdirSync(pulseRoot)) {
		const runDir = path.join(pulseRoot, runName);
		if (!fs.statSync(runDir).isDirectory()) continue;
		const visibilityPath = path.join(
			runDir,
			"publish",
			"visibility_attestation.json",
		);
		if (!fs.existsSync(visibilityPath)) continue;
		const visibility = fs.readJsonSync(visibilityPath) as { title?: string };
		if (visibility.title !== "Fallback Daily Pulse") continue;
		const deletionPath = path.join(
			runDir,
			"publish",
			"deletion_attestation.json",
		);
		if (!fs.existsSync(deletionPath)) {
			failures.push(`pulse_nlm/${runName}: missing deletion_attestation.json`);
			continue;
		}
		const deletion = fs.readJsonSync(deletionPath) as { status?: string };
		if (
			deletion.status !== "deleted" &&
			deletion.status !== "already_missing"
		) {
			failures.push(`pulse_nlm/${runName}: deletion status=${deletion.status}`);
		}
	}
	return failures.length === 0
		? pass(
				"fallback_receipts_deleted",
				"all Fallback Daily Pulse receipts have deletion attestations",
			)
		: fail("fallback_receipts_deleted", failures.join("; "));
}

function checksForScope(scope: AuditScope): Check[] {
	if (scope === "source") return [scanForbiddenCode()];
	if (scope === "runtime") return [auditFallbackReceipts()];
	return [scanForbiddenCode(), auditFallbackReceipts()];
}

function formatMarkdown(scope: AuditScope, checks: Check[]): string {
	const lines = ["# No Fallback Policy Audit", ""];
	lines.push(`Scope: ${scope}`, `Generated: ${new Date().toISOString()}`, "");
	for (const check of checks) {
		lines.push(`- ${check.status} ${check.name}: ${check.details}`);
	}
	return lines.join("\n");
}

async function main() {
	const scope = resolveScope(process.argv.slice(2));
	const checks = checksForScope(scope);
	const outDir = path.join(ROOT, "logs");
	await fs.ensureDir(outDir);
	await fs.writeJson(
		path.join(outDir, `no_fallback_policy_audit.${scope}.json`),
		checks,
		{
			spaces: 2,
		},
	);
	await fs.writeFile(
		path.join(outDir, `no_fallback_policy_audit.${scope}.md`),
		`${formatMarkdown(scope, checks)}\n`,
	);
	console.log(formatMarkdown(scope, checks));
	if (checks.some((check) => check.status === "FAIL")) process.exit(1);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
