import { describe, expect, test } from "bun:test";
import { runCommand } from "../src/domain/agents/audit.js";

const echoArgument = (value: string) =>
	runCommand([
		process.execPath,
		"-e",
		"process.stdout.write(process.argv.slice(1).join('\\n'))",
		value,
	]);

describe("audit runCommand", () => {
	test("passes hostile path characters as a single literal argument", () => {
		const path = `/tmp/with space/"quoted" $(touch /tmp/pwned) \`id\` ; é.mp4`;
		expect(echoArgument(path)).toBe(path);
	});

	test("returns stdout of a successful command", () => {
		expect(
			runCommand([process.execPath, "-e", "process.stdout.write('ok')"]),
		).toBe("ok");
	});

	test("throws when the command exits non-zero", () => {
		expect(() =>
			runCommand([process.execPath, "-e", "process.exit(3)"]),
		).toThrow("Command failed:");
	});

	test("merged output contains stderr after stdout", () => {
		const output = runCommand(
			[
				process.execPath,
				"-e",
				"process.stdout.write('out');process.stderr.write('err')",
			],
			{ output: "merged" },
		);
		expect(output).toBe("outerr");
	});

	test("silent output returns an empty string and still throws on failure", () => {
		expect(
			runCommand([process.execPath, "-e", "process.stdout.write('x')"], {
				output: "silent",
			}),
		).toBe("");
		expect(() =>
			runCommand([process.execPath, "-e", "process.exit(1)"], {
				output: "silent",
			}),
		).toThrow("Command failed:");
	});
});
