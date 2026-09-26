import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
	type ExperienceBenchmark,
	ExperienceBenchmarkSchema,
	type ExperienceProfile,
	ExperienceProfileSchema,
	type ExperienceWorld,
	ExperienceWorldSchema,
} from "./schema.js";

export interface ByosanExperienceConfig {
	profile: ExperienceProfile;
	world: ExperienceWorld;
	benchmark: ExperienceBenchmark;
}

export async function loadByosanExperienceConfig(
	root = process.cwd(),
): Promise<ByosanExperienceConfig> {
	const channelDir = path.join(root, "config", "channels", "byosan");
	const [profileYaml, worldYaml, benchmarkJson] = await Promise.all([
		readFile(path.join(channelDir, "experience.yaml"), "utf8"),
		readFile(path.join(channelDir, "world.yaml"), "utf8"),
		readFile(path.join(channelDir, "benchmark-scenes.json"), "utf8"),
	]);
	return {
		profile: ExperienceProfileSchema.parse(yaml.load(profileYaml)),
		world: ExperienceWorldSchema.parse(yaml.load(worldYaml)),
		benchmark: ExperienceBenchmarkSchema.parse(JSON.parse(benchmarkJson)),
	};
}
