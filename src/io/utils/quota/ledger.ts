import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../../base.js";

export type QuotaLedger = Record<
	string,
	{ requests: number; tokens: number; reset_at: string }
>;

const LEDGER_PATH = path.join(ROOT, "data/state/llm_quotas.json");
let ledger: QuotaLedger | null = null;

function load() {
	if (ledger) return ledger;
	if (fs.existsSync(LEDGER_PATH)) ledger = fs.readJsonSync(LEDGER_PATH);
	else ledger = {};
	return ledger as QuotaLedger;
}

export function saveQuotaLedger() {
	if (!ledger) return;
	fs.ensureDirSync(path.dirname(LEDGER_PATH));
	fs.writeJsonSync(LEDGER_PATH, ledger, { spaces: 2 });
}

export function getQuota(key: string) {
	const l = load();
	if (!l[key])
		l[key] = { requests: 0, tokens: 0, reset_at: new Date().toISOString() };
	return l[key];
}

export function getQuotas() {
	const l = load();
	return Object.entries(l).map(([name, q]) => ({ name, ...q }));
}

export function updateQuota(key: string, reqs: number, tokens: number) {
	const q = getQuota(key);
	q.requests += reqs;
	q.tokens += tokens;
	saveQuotaLedger();
}
