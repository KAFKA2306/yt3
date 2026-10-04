import { describe, expect, test } from "bun:test";
import fs from "fs-extra";
import yaml from "js-yaml";

type Taskfile = {
	tasks: Record<string, { desc?: string; cmds?: string[] }>;
};

const taskfile = yaml.load(fs.readFileSync("Taskfile.yml", "utf8")) as Taskfile;

describe("LIGHT short render task", () => {
	test("audits and renders a prepared LIGHT episode without invoking the DEEP workflow", () => {
		const task = taskfile.tasks["experience:render-light"];
		expect(task?.desc).toContain("LIGHT");
		expect(task?.desc).toContain("Short");
		expect(task?.cmds).toHaveLength(4);
		expect(task?.cmds?.[0]).toContain(
			"EPISODE, COMPILED, and OUTPUT are required",
		);
		expect(task?.cmds?.slice(1)).toEqual([
			'task experience:audit EPISODE="{{.EPISODE}}" LANE=LIGHT',
			'task episode:compile EPISODE="{{.EPISODE}}" OUT="{{.COMPILED}}"',
			'task episode:render COMPILED="{{.COMPILED}}" OUTPUT="{{.OUTPUT}}" KIND=short',
		]);
		expect((task?.cmds ?? []).join("\n")).not.toMatch(
			/byosan:daily|task run\b|publish|KIND=main/i,
		);
	});

	test("lets the shared Experience audit require a caller-selected lane", () => {
		const auditTask = taskfile.tasks["experience:audit"];
		expect((auditTask?.cmds ?? []).join("\n")).toContain('--lane "{{.LANE}}"');
	});
});
