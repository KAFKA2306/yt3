import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../io/core.js";

type CastCharacter = {
	id: string;
	name: string;
	visual_identity: string;
};

type CastDoc = {
	characters: CastCharacter[];
};

const EXPRESSIONS: Array<{ id: string; prompt: string }> = [
	{
		id: "neutral",
		prompt:
			"calm, gentle, attentive neutral expression with soft eyes looking slightly toward the viewer",
	},
	{
		id: "smile",
		prompt:
			"warm, affectionate, bright gentle smile with slightly crinkled happy eyes, keeping the exact same character, hair, outfit, pose, framing, and solid #00FF00 chroma green background",
	},
	{
		id: "shy",
		prompt:
			"slightly blushing, shy and flustered gentle expression with softly averted or bashful eyes and a tiny embarrassed smile, keeping the exact same character, hair, outfit, pose, framing, and solid #00FF00 chroma green background",
	},
];

function runImageGen(prompt: string, outPath: string, refPath?: string): void {
	const args = [prompt, outPath, "--size", "1024x1536"];
	if (refPath) {
		args.push("--ref", refPath);
	}
	const res = spawnSync("codex-imagegen", args, {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 10 * 60 * 1000,
	});
	if (res.status !== 0 || !fs.existsSync(outPath)) {
		throw new Error(
			`codex-imagegen failed for ${outPath}: ${res.stderr || res.stdout}`,
		);
	}
}

async function main() {
	const force = process.argv.includes("--force");
	const onlyChar = process.argv
		.find((a) => a.startsWith("--character="))
		?.split("=")[1];
	const castDoc = fs.readJsonSync(
		path.join(ROOT, "docs", "yawa", "characters.json"),
	) as CastDoc;
	const outRoot = path.join(ROOT, "data", "state", "yawa", "portraits");
	fs.ensureDirSync(outRoot);

	for (const char of castDoc.characters) {
		if (onlyChar && char.id !== onlyChar) continue;
		const charDir = path.join(outRoot, char.id);
		fs.ensureDirSync(charDir);
		const neutralPath = path.join(charDir, "neutral.png");

		for (const expr of EXPRESSIONS) {
			const targetPath = path.join(charDir, `${expr.id}.png`);
			if (!force && fs.existsSync(targetPath)) {
				console.log(`[skip] ${char.id}/${expr.id}.png already exists`);
				continue;
			}
			const prompt =
				expr.id === "neutral"
					? [
							"Japanese anime visual novel character standing sprite (tachie), waist-up portrait centered cleanly with headroom, facing viewer.",
							char.visual_identity,
							`Expression: ${expr.prompt}.`,
							"Warm cinematic anime illustration lighting, crisp clean linework, isolated on a completely flat uniform solid chroma-key green (#00FF00) background with no shadows on the background, no props outside body, no text, no watermark.",
						].join(" ")
					: [
							"Edit only the facial expression of this exact anime visual novel character standing sprite.",
							`New expression: ${expr.prompt}.`,
							"Do not change hair, outfit, pose, camera framing, lighting, or the flat uniform solid #00FF00 green background. No text.",
						].join(" ");

			console.log(`[gen] ${char.id}/${expr.id}.png ...`);
			runImageGen(
				prompt,
				targetPath,
				expr.id === "neutral" ? undefined : neutralPath,
			);
			console.log(`[ok] ${char.id}/${expr.id}.png`);
		}
	}
}

main();
