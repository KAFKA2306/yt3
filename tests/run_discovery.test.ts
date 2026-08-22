import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import {
	isCanonicalActiveRunDir,
	isCanonicalActiveRunId,
} from "../src/io/utils/run_discovery.js";

function tempRoot(): string {
	const root = path.join(
		process.cwd(),
		".tmp-run-discovery-tests",
		randomUUID(),
	);
	fs.ensureDirSync(root);
	return root;
}

describe("active run discovery", () => {
	test("requires canonical run_id and bucket state", () => {
		const root = tempRoot();
		try {
			const active = path.join(root, "runs", "byosan_money", "active");
			const incomplete = path.join(root, "runs", "byosan_money", "incomplete");
			fs.ensureDirSync(active);
			fs.ensureDirSync(incomplete);
			fs.writeJsonSync(path.join(active, "state.json"), {
				run_id: "byosan_money/active",
				bucket: "byosan_money",
			});

			expect(isCanonicalActiveRunDir(active)).toBe(true);
			expect(isCanonicalActiveRunDir(incomplete)).toBe(false);
			expect(isCanonicalActiveRunId(root, "byosan_money/active")).toBe(true);
			expect(isCanonicalActiveRunId(root, "byosan_money/incomplete")).toBe(false);
		} finally {
			fs.removeSync(root);
		}
	});

	test("rejects malformed and non-namespaced run ids", () => {
		const root = tempRoot();
		try {
			const malformed = path.join(root, "runs", "byosan_money", "bad");
			fs.ensureDirSync(malformed);
			fs.writeFileSync(path.join(malformed, "state.json"), "not json");
			expect(isCanonicalActiveRunDir(malformed)).toBe(false);
			expect(isCanonicalActiveRunId(root, "latest")).toBe(false);
		} finally {
			fs.removeSync(root);
		}
	});
});
