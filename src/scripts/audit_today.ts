import fs from "node:fs/promises";
import path from "node:path";
import { sendAlert } from "../io/utils/discord.js";

type ChannelKey = "daily_pulse" | "humanity_observatory";

type ChannelReport = {
	channel: ChannelKey;
	run_dir: string;
	research_done: boolean;
	video_done: boolean;
	publish_done: boolean;
	audit_passed: boolean;
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

function artifactExists(...candidates: string[]): boolean {
	return candidates.some((candidate) => candidate.length > 0);
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function reportChannel(channel: ChannelKey): Promise<ChannelReport> {
	const runDir = path.join(ROOT, "runs", channel, today);

	const researchCandidates =
		channel === "daily_pulse"
			? [
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

	const publishCandidates =
		channel === "daily_pulse"
			? [
					path.join(runDir, "publish", "output.yaml"),
					path.join(runDir, "publish", "receipt.json"),
				]
			: [path.join(runDir, "publish", "output.yaml")];

	const research_done = await Promise.all(researchCandidates.map(exists)).then(
		(items) => artifactExists(...items.map(String)) && items.some(Boolean),
	);
	const video_done = await Promise.all(videoCandidates.map(exists)).then(
		(items) => artifactExists(...items.map(String)) && items.some(Boolean),
	);
	const publish_done = await Promise.all(publishCandidates.map(exists)).then(
		(items) => artifactExists(...items.map(String)) && items.some(Boolean),
	);

	// Audit Report Analysis
	const auditReportPath = path.join(runDir, "audit", "report.json");
	let audit_passed = true;
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
		} catch (e) {
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
		lines.push(
			`## [${item.channel === "daily_pulse" ? "秒算マネー" : "人類観測所"}]`,
		);
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
			const channelName =
				item.channel === "daily_pulse" ? "秒算マネー" : "人類観測所";
			return `${channelName}: research=${item.research_done ? "✅" : "❌"}, video=${item.video_done ? "✅" : "❌"}, publish=${item.publish_done ? "✅" : "❌"}, audit=${item.audit_passed ? "✅" : "⚠️"}`;
		})
		.join("\n");

	await sendAlert(`Audit Today ${report.today}\n${summary}`, "info");
}

async function main(): Promise<void> {
	const reports = await Promise.all([
		reportChannel("daily_pulse"),
		reportChannel("humanity_observatory"),
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
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
