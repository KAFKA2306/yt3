import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { z } from "zod";

const VisibilitySchema = z.enum(["private", "unlisted", "public", "scheduled"]);

const CaptionsSchema = z.preprocess(
	(value) =>
		value === "required"
			? { required: true }
			: value === "optional"
				? { required: false }
				: value === "none"
					? { required: false }
					: value,
	z
		.object({
			required: z.boolean().default(false),
			path: z.string().min(1).optional(),
			language: z.string().min(2).max(16).default("ja"),
			name: z.string().min(1).max(150).default("Japanese"),
		})
		.default({ required: false, language: "ja", name: "Japanese" }),
);

export const PublishJobSchema = z.object({
	schema_version: z.literal("yt3.publish-job.v1"),
	job_id: z.string().min(1),
	profile: z.enum(["byosan", "yawa", "humanity"]),
	bucket: z.string().min(1),
	run_id: z.string().min(1),
	mission_file: z.string().min(1).optional(),
	target_visibility: VisibilitySchema.default("private"),
	publish_at: z.string().datetime().optional(),
	thumbnail_required: z.boolean().default(false),
	captions: CaptionsSchema,
	/** Job-scoped acknowledgement. It is never persisted to a .env file. */
	allow_publicize: z.boolean().default(false),
	metadata: z
		.object({
			title: z.string().min(1).optional(),
			description: z.string().optional(),
			tags: z.array(z.string()).optional(),
		})
		.optional(),
});

export type PublishJob = z.infer<typeof PublishJobSchema>;

export type UploadIntent = {
	schema_version: "yt3.upload-intent.v1";
	job_fingerprint: string;
	job_id: string;
	profile: PublishJob["profile"];
	run_id: string;
	video_path: string;
	created_at: string;
	status: "insert_started";
};

export type VerifiedReceipt = {
	schema_version: "yt3.verified-receipt.v1";
	receipt_status: "VERIFIED";
	job_fingerprint: string;
	job_id: string;
	verified_at: string;
	youtube: {
		status: "uploaded";
		video_id: string;
		channel_id: string;
		channel_title: string;
		staging_privacy_status: "private";
		target_visibility: "private" | "unlisted" | "public" | "scheduled";
		privacy_status: "private" | "unlisted" | "public" | "scheduled";
		processing_status: "succeeded";
		custom_thumbnail_verified: boolean;
		captions_verified: boolean;
		published_at?: string;
		publish_at?: string;
	};
	remote_audit: Record<string, unknown>;
};

export function parsePublishJobFile(jobPath: string): PublishJob {
	const resolved = path.resolve(jobPath);
	if (!fs.existsSync(resolved)) {
		throw new Error(`Publish job not found: ${resolved}`);
	}
	const raw = yaml.load(fs.readFileSync(resolved, "utf8"));
	const parsed = PublishJobSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Invalid publish job ${resolved}: ${parsed.error.issues
				.map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
				.join("; ")}`,
		);
	}
	if (
		parsed.data.target_visibility === "scheduled" &&
		!parsed.data.publish_at
	) {
		throw new Error("Scheduled publish jobs require publish_at");
	}
	if (parsed.data.captions.required && !parsed.data.captions.path) {
		throw new Error("Required captions need captions.path");
	}
	return parsed.data;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, item]) => [key, canonicalize(item)]),
		);
	}
	return value;
}

export function canonicalPublishJob(job: PublishJob): string {
	return JSON.stringify(canonicalize(job));
}

export function publishJobFingerprint(job: PublishJob): string {
	return crypto
		.createHash("sha256")
		.update(canonicalPublishJob(job), "utf8")
		.digest("hex");
}

function assTimestampToVtt(value: string): string {
	const [hours, minutes, secondsAndCentiseconds] = value.split(":");
	const [seconds, centiseconds = "00"] = (secondsAndCentiseconds || "0").split(
		".",
	);
	return `${String(Number(hours || 0)).padStart(2, "0")}:${String(Number(minutes || 0)).padStart(2, "0")}:${String(Number(seconds || 0)).padStart(2, "0")}.${String(Number(centiseconds) * 10).padStart(3, "0")}`;
}

export function convertAssToWebVtt(assPath: string, vttPath: string): void {
	const events = fs
		.readFileSync(assPath, "utf8")
		.split(/\r?\n/)
		.filter((line) => line.startsWith("Dialogue:"))
		.map((line) => {
			const fields = line.slice("Dialogue:".length).trim().split(",");
			if (fields.length < 10) return undefined;
			const start = fields[1];
			const end = fields[2];
			const text = fields
				.slice(9)
				.join(",")
				.replace(/\\N/g, "\n")
				.replace(/\{[^}]*\}/g, "")
				.trim();
			if (!start || !end || !text) return undefined;
			return `${assTimestampToVtt(start)} --> ${assTimestampToVtt(end)}\n${text}`;
		})
		.filter((event): event is string => Boolean(event));
	if (events.length === 0)
		throw new Error(`No timed Dialogue events found in ${assPath}`);
	fs.writeFileSync(vttPath, `WEBVTT\n\n${events.join("\n\n")}\n`, "utf8");
}

export function publishDirectory(runDir: string): string {
	const dir = path.join(runDir, "publish");
	fs.ensureDirSync(dir);
	return dir;
}

export function uploadIntentPath(runDir: string): string {
	return path.join(publishDirectory(runDir), "upload_intent.json");
}

export function receiptPath(runDir: string): string {
	return path.join(publishDirectory(runDir), "receipt.json");
}

export function readUploadIntent(runDir: string): UploadIntent | undefined {
	const file = uploadIntentPath(runDir);
	return fs.existsSync(file)
		? (fs.readJsonSync(file) as UploadIntent)
		: undefined;
}

export function readVerifiedReceipt(
	runDir: string,
): VerifiedReceipt | undefined {
	const file = receiptPath(runDir);
	if (!fs.existsSync(file)) return undefined;
	const receipt = fs.readJsonSync(file) as Partial<VerifiedReceipt>;
	if (receipt.receipt_status !== "VERIFIED") return undefined;
	if (!receipt.job_fingerprint || !receipt.youtube?.video_id) return undefined;
	return receipt as VerifiedReceipt;
}

export function writeUploadIntent(runDir: string, intent: UploadIntent): void {
	const target = uploadIntentPath(runDir);
	if (fs.existsSync(target)) {
		throw new Error(
			`UNCERTAIN_REMOTE_COMMIT: upload intent already exists at ${target}; videos.insert is forbidden`,
		);
	}
	fs.writeFileSync(target, `${JSON.stringify(intent, null, 2)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

export function writeVerifiedReceipt(
	runDir: string,
	receipt: VerifiedReceipt,
): void {
	const target = receiptPath(runDir);
	const temporary = `${target}.tmp-${process.pid}`;
	fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
	fs.renameSync(temporary, target);
}
