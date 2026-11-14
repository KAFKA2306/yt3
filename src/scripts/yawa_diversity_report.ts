import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { loadYawaConfig } from "../domain/yawa_daily.js";
import { ROOT } from "../io/core.js";

const config = loadYawaConfig(ROOT);
const bucket = path.join(ROOT, "runs", config.run.bucket);
const DomainSchema = z.object({
	perceptual_status: z.enum([
		"directly_observed",
		"partly_observed",
		"unavailable",
	]),
	findings: z.array(
		z.object({
			observation: z.string(),
			evidence: z.array(
				z.object({
					run_id: z.string(),
					file: z.string(),
					location: z.string(),
					detail: z.string(),
				}),
			),
			cause: z.string(),
			confidence: z.enum([
				"confirmed_in_code_or_config",
				"supported_inference",
				"undetermined",
			]),
			improvement: z.string(),
		}),
	),
	limitations: z.array(z.string()),
});
const ReportSchema = z.object({
	summary: z.string(),
	voice: DomainSchema,
	style: DomainSchema,
	visual: DomainSchema,
	limitations: z.array(z.string()),
});

function run(command: string[]): string {
	const result = Bun.spawnSync(command, {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(
			`audit command failed (${result.exitCode}): ${result.stderr.toString().slice(-1000)}`,
		);
	return result.stdout.toString();
}

function mediaInfo(file: string): {
	status: "missing" | "unreadable" | "readable";
	seconds: number | null;
	error?: string;
} {
	if (!fs.existsSync(file)) return { status: "missing", seconds: null };
	try {
		const value = Number(
			run([
				"ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				file,
			]).trim(),
		);
		if (!Number.isFinite(value) || value <= 0)
			return {
				status: "unreadable",
				seconds: null,
				error: "no positive duration",
			};
		return { status: "readable", seconds: value };
	} catch (error) {
		return {
			status: "unreadable",
			seconds: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function imageInfo(file: string): {
	status: "missing" | "unreadable" | "readable";
	width?: number;
	height?: number;
	error?: string;
} {
	if (!fs.existsSync(file)) return { status: "missing" };
	try {
		const output = run([
			"ffprobe",
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=width,height",
			"-of",
			"json",
			file,
		]);
		const stream = (
			JSON.parse(output) as {
				streams?: Array<{ width?: number; height?: number }>;
			}
		).streams?.[0];
		if (!stream?.width || !stream.height)
			return { status: "unreadable", error: "missing image dimensions" };
		return { status: "readable", width: stream.width, height: stream.height };
	} catch (error) {
		return {
			status: "unreadable",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function runNames(): { ids: string[]; total: number } {
	if (!fs.existsSync(bucket)) return { ids: [], total: 0 };
	const available = fs
		.readdirSync(bucket)
		.filter((name) => /^yawa-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(name))
		.filter((name) => fs.existsSync(path.join(bucket, name, "script.json")))
		.sort();
	const requested = process.env.YAWA_AUDIT_RUNS?.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	if (!requested?.length)
		return { ids: available.slice(-12), total: available.length };
	for (const id of requested)
		if (!/^yawa-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?$/.test(id))
			throw new Error(`invalid run id in YAWA_AUDIT_RUNS: ${id}`);
	return { ids: requested, total: available.length };
}

function evidenceManifest(ids: string[], total: number) {
	const runs = ids.map((id) => {
		const dir = path.join(bucket, id);
		const files = {
			script: path.join(dir, "script.json"),
			audio: path.join(dir, "final_mix.wav"),
			video: path.join(dir, config.video.file),
			cover: path.join(dir, "cover.png"),
			thumbnail: path.join(dir, config.thumbnail.file),
		};
		return {
			run_id: id,
			files: Object.fromEntries(
				Object.entries(files).map(([key, file]) => [
					key,
					{
						path: fs.existsSync(file)
							? path.relative(ROOT, file).replaceAll(path.sep, "/")
							: null,
						status: fs.existsSync(file) ? "present" : "missing",
					},
				]),
			),
			audio: mediaInfo(files.audio),
			video: mediaInfo(files.video),
			cover: imageInfo(files.cover),
			thumbnail: imageInfo(files.thumbnail),
		};
	});
	return { requested_runs: ids, available_script_runs: total, runs };
}

function promptFor(manifest: ReturnType<typeof evidenceManifest>): string {
	return [
		"あなたは夜話アーカイブの独立監査AIです。制作AIの指示を作らず、監査結果を次の制作・公開へ注入しません。作品を却下・再生成せず、数値閾値や理想の声・作風・画風を設定しません。",
		"対象runの完成音声・台本・動画・カバー・サムネイルを実物から確認し、必要なら設定・制作コード・保存された各作品固有の指示を照合してください。観測事実、推論、コード・設定で確認した制約を分けます。",
		`ユーザーの声の好み: ${config.creative.preference}`,
		`作品一覧と欠損状況: ${JSON.stringify(manifest)}`,
		"制作設定: config/yawa/daily.yaml と config/yawa/runtime.yaml。制作・画像アダプター: src/domain/yawa_daily.ts と src/scripts/yawa_daily.ts。実runのscript.jsonには各作品の声、演技、画像指示、制作順があります。",
		"声の音色・共鳴・発声と、演技・抑揚・間・速度を区別。完成音声を直接聴けた場合だけ heard とし、run id・秒数・観測を示す。聴取能力がない場合は unavailable とし、ASR・波形・メタデータから聴いたと装わない。画像は実際に表示を確認できた場合だけ directly_observed とし、視認できなければ unavailable と記す。",
		"作風は人物関係、状況、展開、台詞、タイトルを実物から確認します。画像は構図、色、描写、人物表現を確認します。語句・画像の類似度スコアだけで原因を断定しません。共通性がユーザーの嗜好と合う場合、構造的固定化と区別します。",
		"各所見に対象run、ファイル、音声の秒数または台本の短い位置情報、観測内容、原因と確度、確認できた原因に対する改善案を記載。証拠不足はundeterminedにしてください。欠損・対象期間・監査上の限界も記載してください。",
		"JSONだけで出力してください。schema: {summary:string,voice:{perceptual_status:directly_observed|partly_observed|unavailable,findings:[{observation,evidence:[{run_id,file,location,detail}],cause,confidence:confirmed_in_code_or_config|supported_inference|undetermined,improvement}],limitations:string[]},style:{同じ形式},visual:{同じ形式},limitations:string[]}。分からない情報を埋めず、findingがなければ空配列にします。",
	].join("\n");
}

function parseJson(text: string): unknown {
	return JSON.parse(
		text
			.trim()
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/```\s*$/, ""),
	);
}

async function main(): Promise<void> {
	const { ids, total } = runNames();
	if (!ids.length) throw new Error("no yawa runs with script.json were found");
	const manifest = evidenceManifest(ids, total);
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yawa-audit-"));
	try {
		const answer = path.join(temp, "answer.json");
		const result = run([
			"codex",
			"exec",
			"-m",
			config.script.model,
			"--sandbox",
			"read-only",
			"--skip-git-repo-check",
			"--ephemeral",
			"-o",
			answer,
			promptFor(manifest),
		]);
		const raw = fs.existsSync(answer)
			? fs.readFileSync(answer, "utf8")
			: result;
		const report = ReportSchema.parse(parseJson(raw));
		const outputDir = path.join(ROOT, "outputs");
		fs.ensureDirSync(outputDir);
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const output = path.join(outputDir, `yawa-diversity-audit-${stamp}.json`);
		const record = {
			generated_at: new Date().toISOString(),
			scope: manifest,
			read_only: true,
			automatic_action: false,
			report,
		};
		const staged = `${output}.${process.pid}.tmp`;
		fs.writeFileSync(staged, `${JSON.stringify(record, null, 2)}\n`);
		fs.renameSync(staged, output);
		console.log(
			JSON.stringify({
				output: path.relative(ROOT, output),
				run_count: ids.length,
				total_available: total,
			}),
		);
	} finally {
		fs.removeSync(temp);
	}
}

await main();
