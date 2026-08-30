import fs from "node:fs/promises";
import path from "node:path";

type CheckResult = {
	name: string;
	ok: boolean;
	message: string;
};

const ROOT = process.cwd();

function record(
	results: CheckResult[],
	name: string,
	ok: boolean,
	message: string,
) {
	results.push({ name, ok, message });
}

async function readTextIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch {
		return null;
	}
}

function checkContains(
	results: CheckResult[],
	name: string,
	text: string | null,
	required: string[],
) {
	if (text === null) {
		record(results, name, false, "file missing");
		return;
	}

	const missing = required.filter((needle) => !text.includes(needle));
	record(
		results,
		name,
		missing.length === 0,
		missing.length === 0
			? "all required markers present"
			: `missing markers: ${missing.join(", ")}`,
	);
}

async function main() {
	const results: CheckResult[] = [];

	const referencePath = path.join(
		ROOT,
		"docs/standard/ontology-standard-reference.md",
	);
	const governancePath = path.join(
		ROOT,
		"docs/standard/ontology-governance-standard.md",
	);
	const termsPath = path.join(
		ROOT,
		"src/domain/humanity_audit/humanity_audit_terms.ts",
	);
	const taskfilePath = path.join(ROOT, "Taskfile.yml");
	const packageJsonPath = path.join(ROOT, "package.json");
	const doctorPath = path.join(ROOT, "src/scripts/harness_doctor.ts");

	const referenceText = await readTextIfExists(referencePath);
	const governanceText = await readTextIfExists(governancePath);
	const termsText = await readTextIfExists(termsPath);
	const taskfileText = await readTextIfExists(taskfilePath);
	const packageText = await readTextIfExists(packageJsonPath);
	const doctorText = await readTextIfExists(doctorPath);

	checkContains(results, "reference_doc", referenceText, [
		"ISO/IEC 21838-1:2021",
		"ISO 5127:2017",
		"ISO/IEC TR 20943-6:2013",
	]);

	checkContains(results, "governance_doc", governanceText, [
		"local domain vocabulary",
		"machine-checkable",
		"task audit:ontology",
		"top-level ontology",
	]);

	checkContains(results, "humanity_terms", termsText, [
		"Mundane Object Lexicon",
		"local domain vocabulary",
		"projectOntologyAlignment",
		"ISO/IEC 21838-1:2021",
	]);

	checkContains(results, "taskfile_entry", taskfileText, ["audit:ontology"]);
	checkContains(results, "package_json_script", packageText, [
		'"audit:ontology"',
	]);
	checkContains(results, "doctor_hook", doctorText, ["audit:ontology"]);

	for (const result of results) {
		const icon = result.ok ? "✅" : "❌";
		console.log(`[${icon}] ${result.name}: ${result.message}`);
	}

	if (results.some((result) => !result.ok)) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack || error.message : error);
	process.exit(1);
});
