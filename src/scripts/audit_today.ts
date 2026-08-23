import fs from "node:fs/promises";
import path from "node:path";
import { sendAlert } from "../io/utils/discord.js";
import {
	findRunDirForDate,
	getLatestPublishedChannelUrls,
	getMissingEvidence,
	isEvidenceReady,
} from "../io/utils/stability.js";

type ChannelKey = "byosan_money" | "humanity_observatory";

type ChannelReport = {
	channel: ChannelKey;
	run_dir: string;
	research_done: boolean;
	video_done: boolean;
	publish_done: boolean;
	audit_passed: boolean;
	evidence_path: string;
	evidence_ready: boolean;
	latest_public_url?: string;
	missing_evidence: string[];
	discomfort_warnings: string[];
	missing: string[];
	brainstorm: string[];
};

type AuditTodayReport = {
	today: string;
	reports: ChannelReport[];
};

const ROOT = process.cwd();
const today =
	process.env.RUN_ID ||
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Tokyo",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());

function channelLabel(channel: ChannelKey): string {
	return channel === "byosan_money" ? "秒算マネー" : "人類観測所";
}

function gatePassed(report: AuditTodayReport): boolean {
	return (
		report.reports.length > 0 &&
		report.reports.every((item) => item.audit_passed && item.evidence_ready)
	);
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function evidenceStatus(runDir: string): Promise<{
	evidence_path: string;
	evidence_ready: boolean;
	missing_evidence: string[];
}> {
	const evidencePath = path.join(runDir, "run_evidence.json");
	const ready = isEvidenceReady(runDir);
	const missing = getMissingEvidence(runDir);
	return {
		evidence_path: evidencePath,
		evidence_ready: ready,
		missing_evidence: missing,
	};
}

async function reportChannel(
	channel: ChannelKey,
	latestChannelUrlsByLabel: Map<
		string,
		Awaited<ReturnType<typeof getLatestPublishedChannelUrls>>[number]
	>,
): Promise<ChannelReport> {
	const runDir = findRunDirForDate(channel, today);
	const { evidence_path, evidence_ready, missing_evidence } =
		await evidenceStatus(runDir);

	const researchCandidates =
		channel === "byosan_money"
			? [
					path.join(runDir, "research.json"),
					path.join(runDir, "content", "output.yaml"),
					path.join(runDir, "research", "output.yaml"),
					path.join(runDir, "web_search", "input.yaml"),
				]
			: [
					path.join(runDir, "research.json"),
					path.join(runDir, "research", "output.yaml"),
				];

	const videoCandidates = [
		path.join(runDir, "media", "video", "video.mp4"),
		path.join(runDir, "video", "final_video.mp4"),
	];

	const publishCandidates = [path.join(runDir, "publish", "receipt.json")];

	const research_done = (
		await Promise.all(researchCandidates.map(exists))
	).some(Boolean);
	const video_done = (await Promise.all(videoCandidates.map(exists))).some(
		Boolean,
	);
	const publish_done = (await Promise.all(publishCandidates.map(exists))).some(
		Boolean,
	);

	const auditReportPath = path.join(runDir, "audit", "report.json");
	let audit_passed = false;
	const discomfort_warnings: string[] = [];

	if (await exists(auditReportPath)) {
		try {
			const report = JSON.parse(await fs.readFile(auditReportPath, "utf-8"));
			audit_passed = report.decision === "PASS";
			if (report.checks) {
				for (const check of Object.values(report.checks) as Array<{
					status: string;
					name: string;
					details?: string;
				}>) {
					if (check.status !== "PASS" && check.name.includes("Discomfort")) {
						discomfort_warnings.push(`${check.name}: ${check.details || ""}`);
					}
				}
			}
		} catch {
			audit_passed = false;
		}
	}

	const missing: string[] = [];
	if (!research_done) missing.push("research/web_search");
	if (!video_done) missing.push("video_production");
	if (!publish_done) missing.push("publish");

	const brainstorm: string[] = [];
	if (!research_done)
		brainstorm.push("Gather today's raw facts and choose a fresh angle.");
	if (!video_done)
		brainstorm.push(
			"Check the latest script and media artifacts, then identify the smallest missing production step.",
		);
	if (discomfort_warnings.length > 0) {
		brainstorm.push(
			"Address the discomfort warnings in the script template/prompt.",
		);
	}
	if (!publish_done && video_done)
		brainstorm.push(
			"Verify the publish receipt and the channel state before deciding the run is done.",
		);
	if (missing.length > 0) {
		brainstorm.push(
			"If the topic feels stale, pivot to a more concrete or more local angle instead of forcing the old one.",
		);
	}

	return {
		channel,
		run_dir: runDir,
		research_done,
		video_done,
		publish_done,
		audit_passed,
		evidence_path,
		evidence_ready,
		latest_public_url: latestChannelUrlsByLabel.get(channelLabel(channel))
			?.public_url,
		missing_evidence,
		discomfort_warnings,
		missing,
		brainstorm,
	};
}

function formatReport(report: AuditTodayReport): string {
	const lines: string[] = [];
	lines.push(`# Audit Today ${report.today}`);
	for (const item of report.reports) {
		lines.push("");
		lines.push(`## [${channelLabel(item.channel)}]`);
		lines.push(`- **Run Dir**: \`${item.run_dir}\``);
		lines.push(
			`- **Research**: ${item.research_done ? "✅ DONE" : "❌ MISSING"}`,
		);
		lines.push(`- **Video**: ${item.video_done ? "✅ DONE" : "❌ MISSING"}`);
		lines.push(
			`- **Publish**: ${item.publish_done ? "✅ DONE" : "❌ MISSING"}`,
		);
		lines.push(
			`- **Audit**: ${item.audit_passed ? "✅ PASS" : "⚠️ BLOCKED/FAIL"}`,
		);
		lines.push(
			`- **Evidence ready**: ${item.evidence_ready ? "✅ YES" : "❌ NO"}`,
		);
		lines.push(`- **Evidence path**: \`${item.evidence_path}\``);
		if (item.latest_public_url) {
			lines.push(`- **Latest URL**: \`${item.latest_public_url}\``);
		}
		if (item.missing_evidence.length > 0) {
			lines.push(`- **Missing evidence**: \`${item.missing_evidence[0]}\``);
		}

		if (item.discomfort_warnings.length > 0) {
			lines.push("### ⚠️ Discomfort Detected");
			for (const warn of item.discomfort_warnings) lines.push(`- ${warn}`);
		}

		if (item.missing.length > 0) {
			lines.push("### 💡 Brainstorm / Action");
			for (const idea of item.brainstorm) lines.push(`- ${idea}`);
		}
	}
	return lines.join("\n");
}

async function notifyDiscord(report: AuditTodayReport): Promise<void> {
	const summary = report.reports
		.map((item) => {
			const channelName = channelLabel(item.channel);
			return `${channelName}: research=${item.research_done ? "✅" : "❌"}, video=${item.video_done ? "✅" : "❌"}, publish=${item.publish_done ? "✅" : "❌"}, audit=${item.audit_passed ? "✅" : "⚠️"}, evidence=${item.evidence_ready ? "✅" : "❌"}`;
		})
		.join("\n");

	await sendAlert(`Audit Today ${report.today}\n${summary}`, "info");
}

async function main(): Promise<void> {
	const latestChannelUrls = await getLatestPublishedChannelUrls();
	const latestChannelUrlsByLabel = new Map(
		latestChannelUrls.map((item) => [item.channel_label, item]),
	);
	const reports = await Promise.all([
		reportChannel("byosan_money", latestChannelUrlsByLabel),
		reportChannel("humanity_observatory", latestChannelUrlsByLabel),
	]);

	const report: AuditTodayReport = { today, reports };
	const markdown = formatReport(report);
	const outputDir = path.join(ROOT, "logs");
	await fs.mkdir(outputDir, { recursive: true });
	await fs.writeFile(
		path.join(outputDir, "audit_today.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	await fs.writeFile(
		path.join(outputDir, "audit_today.md"),
		`${markdown}\n`,
		"utf8",
	);

	console.log(markdown);
	await notifyDiscord(report);
	if (process.argv.includes("--gate") && !gatePassed(report)) {
		process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
