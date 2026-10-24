import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { loadEnvFile } from "../src/io/utils/env.js";

const KEY = "YT3_ENV_LOAD_TEST_KEY";
let dir: string;

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-env-"));
});

afterEach(() => {
	delete process.env[KEY];
	fs.removeSync(dir);
});

describe("loadEnvFile", () => {
	test("keeps an existing value when the file assigns an empty string", () => {
		const file = path.join(dir, ".env");
		fs.writeFileSync(file, `${KEY}=\n`);
		process.env[KEY] = "existing";

		loadEnvFile(file);

		expect(process.env[KEY]).toBe("existing");
	});

	test("overrides an existing value with a non-empty value from the file", () => {
		const file = path.join(dir, ".env");
		fs.writeFileSync(file, `${KEY}=from-file\n`);
		process.env[KEY] = "existing";

		loadEnvFile(file);

		expect(process.env[KEY]).toBe("from-file");
	});

	test("ignores a missing file", () => {
		expect(() => loadEnvFile(path.join(dir, "missing.env"))).not.toThrow();
		expect(process.env[KEY]).toBeUndefined();
	});
});
