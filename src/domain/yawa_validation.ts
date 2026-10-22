import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { sha256File } from "./publication_state.js";

const ReceiptSchema = z.object({
	youtube: z.object({
		video_id: z.string().min(1),
		channel_title: z.string().min(1),
		privacy_status: z.string().min(1),
	}),
});

const PublishStateSchema = z.object({
	phase: z.string(),
	artifact_sha256: z.string(),
	video_id: z.string().optional(),
});

const AuditSchema = z.record(z.string(), z.object({ status: z.string() }));

export type YawaValidation = {
	run_id: string;
	status: "PASS" | "FAIL";
	failures: string[];
};

/**
 * 1 本の yawa run が公開まで整合しているかを確認する。
 * 失敗は理由を列挙して返し、黙って補完しない。
 */
export function validateYawaRun(
	runDir: string,
	expectedChannelTitle: string,
): YawaValidation {
	const runId = `yawa_archive/${path.basename(runDir)}`;
	const failures: string[] = [];
	const read = <T>(file: string, schema: z.ZodType<T>): T | undefined => {
		const target = path.join(runDir, file);
		if (!fs.existsSync(target)) {
			failures.push(`${file} is missing`);
			return undefined;
		}
		const parsed = schema.safeParse(fs.readJsonSync(target));
		if (!parsed.success) {
			failures.push(`${file} does not match schema`);
			return undefined;
		}
		return parsed.data;
	};

	const videoPath = path.join(runDir, "video.mp4");
	if (!fs.existsSync(videoPath)) failures.push("video.mp4 is missing");

	const audit = read("audit/result.json", AuditSchema);
	if (audit) {
		const bad = Object.entries(audit).filter(([, c]) => c.status !== "PASS");
		if (bad.length > 0)
			failures.push(`audit not PASS: ${bad.map(([n]) => n).join(", ")}`);
	}

	const state = read("publish/state.json", PublishStateSchema);
	if (state) {
		if (state.phase !== "VERIFIED")
			failures.push(`publish phase is ${state.phase}, expected VERIFIED`);
		if (
			fs.existsSync(videoPath) &&
			state.artifact_sha256 !== sha256File(videoPath)
		)
			failures.push("published artifact sha256 differs from video.mp4");
	}

	const receipt = read("publish/receipt.json", ReceiptSchema);
	if (receipt) {
		if (receipt.youtube.channel_title !== expectedChannelTitle)
			failures.push(
				`channel is ${receipt.youtube.channel_title}, expected ${expectedChannelTitle}`,
			);
		if (receipt.youtube.privacy_status !== "public")
			failures.push(
				`privacy is ${receipt.youtube.privacy_status}, expected public`,
			);
		if (state && state.video_id !== receipt.youtube.video_id)
			failures.push("state and receipt disagree on video_id");
	}

	return {
		run_id: runId,
		status: failures.length === 0 ? "PASS" : "FAIL",
		failures,
	};
}
