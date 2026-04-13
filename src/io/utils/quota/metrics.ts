import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../base.js";

export type QuotaMetric = {
	keyName: string;
	model: string;
	tokens: number;
	timestamp: string;
};

const METRICS_PATH = path.join(ROOT, "logs/quota_metrics.jsonl");

export function recordQuotaMetric(metric: QuotaMetric) {
	fs.appendFileSync(METRICS_PATH, `${JSON.stringify(metric)}\n`);
}

export function getQuotaMetrics(): QuotaMetric[] {
	if (!fs.existsSync(METRICS_PATH)) return [];
	return fs
		.readFileSync(METRICS_PATH, "utf-8")
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l));
}
