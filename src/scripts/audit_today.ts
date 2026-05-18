import fs from "node:fs/promises";
import path from "node:path";

type ChannelKey = "daily_pulse" | "humanity_observatory";

type ChannelReport = {
	channel: ChannelKey;
	run_dir: string;
	research_done: boolean;
	video_done: boolean;
	publish_done: boolean;
	missing: string[];
	brainstorm: string[];
};

type AuditTodayReport = {
	today: string;
	reports: ChannelReport[];
};

const ROOT = process.cwd();
const today = new Intl.DateTimeFormat("en-CA", {
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
	const runDir = path.join(
		ROOT,
		"runs",
		channel,
		today,
	);

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

	const research_done = await Promise.all(researchCandidates.map(exists)).then((items) => artifactExists(...items.map(String)) && items.some(Boolean));
	const video_done = await Promise.all(videoCandidates.map(exists)).then((items) => artifactExists(...items.map(String)) && items.some(Boolean));
	const publish_done = await Promise.all(publishCandidates.map(exists)).then((items) => artifactExists(...items.map(String)) && items.some(Boolean));

	const missing: string[] = [];
	if (!research_done) missing.push("research/web_search");
	if (!video_done) missing.push("video_production");
	if (!publish_done) missing.push("publish");

	const brainstorm: string[] = [];
	if (!research_done) brainstorm.push("Gather today's raw facts and choose a fresh angle.");
	if (!video_done) brainstorm.push("Check the latest script and media artifacts, then identify the smallest missing production step.");
	if (!publish_done) brainstorm.push("Verify the publish receipt and the channel state before deciding the run is done.");
	if (missing.length > 0) {
		brainstorm.push("If the topic feels stale, pivot to a more concrete or more local angle instead of forcing the old one.");
	}

	return {
		channel,
		run_dir: runDir,
		research_done,
		video_done,
		publish_done,
		missing,
		brainstorm,
	};
}

function formatReport(report: AuditTodayReport): string {
	const lines: string[] = [];
	lines.push(`# Audit Today ${report.today}`);
	for (const item of report.reports) {
		lines.push("");
		lines.push(`[${item.channel}] ${item.run_dir}`);
		lines.push(`research/web_search: ${item.research_done ? "yes" : "no"}`);
		lines.push(`video_production: ${item.video_done ? "yes" : "no"}`);
		lines.push(`publish: ${item.publish_done ? "yes" : "no"}`);
		if (item.missing.length > 0) {
			lines.push("brainstorm:");
			for (const idea of item.brainstorm) lines.push(`- ${idea}`);
		}
	}
	return lines.join("\n");
}

async function notifyDiscord(message: string): Promise<void> {
	const webhook = process.env.DISCORD_WEBHOOK_URL;
	if (!webhook) return;

	const response = await fetch(webhook, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ content: message }),
	});

	if (!response.ok) {
		throw new Error(`Discord webhook failed with status ${response.status}`);
	}
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
	await fs.writeFile(path.join(outputDir, "audit_today.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await fs.writeFile(path.join(outputDir, "audit_today.md"), `${markdown}\n`, "utf8");

	for (const item of report.reports) {
		console.log(`[${item.channel}] ${item.run_dir}`);
		console.log(`  research/web_search: ${item.research_done ? "yes" : "no"}`);
		console.log(`  video_production: ${item.video_done ? "yes" : "no"}`);
		console.log(`  publish: ${item.publish_done ? "yes" : "no"}`);
		if (item.missing.length > 0) {
			console.log("  brainstorm:");
			for (const idea of item.brainstorm) console.log(`    - ${idea}`);
		}
	}

	await notifyDiscord(markdown);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
