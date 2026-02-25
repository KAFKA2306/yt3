import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import type { AppConfig } from "./types.js";
export const ROOT = process.cwd();
export function readYamlFile<T>(p: string): T {
	if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
	return yaml.load(fs.readFileSync(p, "utf-8")) as T;
}
export function loadConfig(): AppConfig {
	const configPath = path.join(ROOT, "config", "default.yaml");
	const cfg = readYamlFile<AppConfig>(configPath);
	if (process.env.DRY_RUN === "true") {
		if (cfg.steps.youtube) cfg.steps.youtube.dry_run = true;
		if (cfg.steps.twitter) cfg.steps.twitter.dry_run = true;
	}
	return cfg;
}
