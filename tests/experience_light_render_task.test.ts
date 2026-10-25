import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import * as yaml from "js-yaml";

type Taskfile = {
	tasks: Record<string, { cmds?: string[] }>;
};

const taskfile = yaml.load(fs.readFileSync("Taskfile.yml", "utf8")) as Taskfile;

describe("LIGHT short render task", () => {
	test("never publishes or invokes the DEEP workflow", () => {
		const commands = (
			taskfile.tasks["experience:render-light"]?.cmds ?? []
		).join("\n");
		expect(commands.length).toBeGreaterThan(0);
		expect(commands).not.toMatch(/byosan:daily|task run\b|publish|KIND=main/i);
	});
});
