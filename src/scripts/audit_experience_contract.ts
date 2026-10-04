import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditEpisode } from "../domain/episode/compiler.js";
import { EpisodeSchema } from "../domain/episode/schema.js";
import { auditExperienceEpisode } from "../domain/experience/audit.js";
import { loadByosanExperienceConfig } from "../domain/experience/config.js";
import { ExperienceLaneSchema } from "../domain/experience/schema.js";

type ExperienceLane = (typeof ExperienceLaneSchema.options)[number];

function episodeArg(argv: string[]): string {
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--episode") return argv[index + 1] ?? "";
	}
	throw new Error("--episode is required");
}

function requestedLane(argv: string[]): ExperienceLane | undefined {
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] !== "--lane") continue;
		const value = argv[index + 1];
		const parsed = ExperienceLaneSchema.safeParse(value);
		if (!parsed.success)
			throw new Error("--lane must be LIGHT, EXPLAIN, or DEEP");
		return parsed.data;
	}
	return undefined;
}

export async function auditExperienceContract(
	episodePath: string,
	root = process.cwd(),
	requiredLane?: ExperienceLane,
): Promise<number> {
	const absoluteEpisodePath = path.resolve(episodePath);
	const parsed = EpisodeSchema.safeParse(
		JSON.parse(await readFile(absoluteEpisodePath, "utf8")),
	);
	if (!parsed.success) {
		console.error(
			JSON.stringify(
				{
					status: "FAIL",
					issues: parsed.error.issues.map((issue) => ({
						code: "episode_schema_invalid",
						path: issue.path.join("."),
						message: issue.message,
					})),
				},
				null,
				2,
			),
		);
		return 1;
	}

	const { profile } = await loadByosanExperienceConfig(root);
	const issues = [
		...auditEpisode(parsed.data),
		...auditExperienceEpisode(parsed.data, profile, { requiredLane }),
	];
	console.log(
		JSON.stringify(
			{
				status: issues.length === 0 ? "PASS" : "FAIL",
				profile: profile.channel,
				episode: absoluteEpisodePath,
				required_lane: requiredLane ?? null,
				issue_count: issues.length,
				issues,
			},
			null,
			2,
		),
	);
	return issues.length === 0 ? 0 : 1;
}

if (import.meta.main) {
	try {
		process.exitCode = await auditExperienceContract(
			episodeArg(process.argv.slice(2)),
			process.cwd(),
			requestedLane(process.argv.slice(2)),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
