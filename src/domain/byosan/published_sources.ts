import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const PublishedRunSpecSchema = z.object({
	sources: z.array(z.object({ url: z.string().url() })),
});

export function normalizedSourceUrl(url: string): string | null {
	const parsed = new URL(url);
	const pathname = parsed.pathname.replace(/\/+$/, "");
	return pathname === "" ? null : `${parsed.origin}${pathname}`;
}

function recentByosanRunDirs(
	root: string,
	currentDate: Date,
	days: number,
): string[] {
	const runsDir = path.join(root, "runs", "byosan_money");
	if (!fs.existsSync(runsDir)) return [];
	const cutoff = new Date(currentDate);
	cutoff.setUTCDate(cutoff.getUTCDate() - days);
	return fs
		.readdirSync(runsDir)
		.filter((runId) => /^\d{4}-\d{2}-\d{2}/.test(runId))
		.filter((runId) => {
			const date = new Date(`${runId.slice(0, 10)}T00:00:00Z`);
			return (
				!Number.isNaN(date.getTime()) && date >= cutoff && date <= currentDate
			);
		})
		.map((runId) => path.join(runsDir, runId));
}

export function loadPublishedByosanSourceUrls(
	root: string,
	currentDate: Date,
	days: number,
): Set<string> {
	return new Set(
		recentByosanRunDirs(root, currentDate, days)
			.filter(
				(runDir) =>
					fs.existsSync(path.join(runDir, "publish", "receipt.json")) &&
					fs.existsSync(path.join(runDir, "source", "feature_spec.json")),
			)
			.flatMap((runDir) =>
				PublishedRunSpecSchema.parse(
					fs.readJsonSync(path.join(runDir, "source", "feature_spec.json")),
				).sources.flatMap((source) => {
					const key = normalizedSourceUrl(source.url);
					return key === null ? [] : [key];
				}),
			),
	);
}
