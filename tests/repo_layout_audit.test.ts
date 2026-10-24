import { describe, expect, test } from "bun:test";
import {
	adrIndexViolations,
	unlistedRootPaths,
} from "../src/scripts/audit_repo_layout.js";

const root = { files: ["README.md"], directories: ["src", "docs"] };

describe("repo layout audit", () => {
	test("flags tracked root names that the allowlist does not list", () => {
		expect(
			unlistedRootPaths(
				["README.md", "src/main.ts", "TASKS.md", "research/weekly/a.md"],
				root,
			),
		).toEqual(["TASKS.md", "research/weekly/a.md"]);
	});

	test("flags duplicate ADR numbers", () => {
		expect(
			adrIndexViolations(
				[
					{ name: "0032-a.md", status: "Accepted" },
					{ name: "0032-b.md", status: undefined },
				],
				"- `0032-a.md`: first",
				["Accepted"],
			),
		).toEqual(["ADR number 0032 is used by more than one file"]);
	});
});
