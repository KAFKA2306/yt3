import { afterEach, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import {
	type AudioEpisode,
	copyIfChanged,
	dedupeRssItems,
	isEligibleRun,
	itemXml,
	syncRunIsolated,
	xmlEscape,
} from "../src/domain/audio_syndication.js";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.removeSync(dir);
});

const episode: AudioEpisode = {
	product: "yawa",
	runId: "yawa-2026-11-25",
	runDir: "/tmp/run",
	title: "雨音 & 古書",
	description: "静かな夜 <episode>",
	date: "2026-11-25",
	audioPath: "/tmp/final_mix.wav",
	guid: "yt3:yawa:yawa-2026-11-25",
};

describe("audio syndication", () => {
	test("escapes XML and declares exact enclosure bytes and audio/mp4", () => {
		expect(xmlEscape(`A&B <C> "D" 'E'`)).toBe(
			"A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;",
		);
		const item = itemXml(episode, "yawa-yawa-2026-11-25.m4a", 123456, 367.9);
		expect(item).toContain(
			'<enclosure url="https://github.com/KAFKA2306/yt3/releases/download/audio-yawa/yawa-yawa-2026-11-25.m4a" length="123456" type="audio/mp4" />',
		);
		expect(item).toContain("yt3:yawa:yawa-2026-11-25");
		expect(item).toContain("雨音 &amp; 古書");
		expect(item).toContain("0:06:07");
	});

	test("deduplicates by stable GUID and replaces stale enclosure metadata", () => {
		const oldItem = itemXml(episode, "old.m4a", 10, 7);
		const freshItem = itemXml(episode, "new.m4a", 20, 7);
		const result = dedupeRssItems([oldItem], [freshItem]);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain('length="20"');
		expect(result[0]).toContain("new.m4a");
	});

	test("allows prepared and verified runs while rejecting junk metadata or audio", () => {
		const prepared = { status: "READY" };
		const published = { status: "READY" };
		expect(isEligibleRun(prepared, "Prepared episode", 6, true)).toBe(true);
		expect(
			isEligibleRun(published, "Published episode", 6, true, true, "VERIFIED"),
		).toBe(true);
		expect(
			isEligibleRun(
				{ status: "SUCCESS" },
				"Published episode",
				6,
				true,
				true,
				"VERIFIED",
			),
		).toBe(true);
		expect(isEligibleRun(prepared, "", 6, true)).toBe(false);
		expect(isEligibleRun(prepared, "Junk", 5, true)).toBe(false);
		expect(isEligibleRun(prepared, "Junk", 8, false)).toBe(false);
		expect(isEligibleRun({ status: "FAILED" }, "Failed", 8, true)).toBe(false);
	});

	test("copies Humanity tracks only when bytes differ", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yt3-audio-test-"));
		tempDirs.push(dir);
		const source = path.join(dir, "tagged.m4a");
		const target = path.join(dir, "music", "track.m4a");
		fs.writeFileSync(source, Buffer.from([0, 1, 2, 3]));
		expect(copyIfChanged(source, target)).toBe(true);
		const originalMtime = fs.statSync(target).mtimeMs;
		expect(copyIfChanged(source, target)).toBe(false);
		expect(fs.statSync(target).mtimeMs).toBe(originalMtime);
		fs.writeFileSync(source, Buffer.from([4, 5]));
		expect(copyIfChanged(source, target)).toBe(true);
		expect(fs.readFileSync(target)).toEqual(Buffer.from([4, 5]));
	});

	test("keeps preparation safe when audio delivery is unavailable", async () => {
		const originalError = console.error;
		console.error = () => undefined;
		try {
			await expect(
				syncRunIsolated("byosan", "missing-run-for-test"),
			).resolves.toBeUndefined();
		} finally {
			console.error = originalError;
		}
	});
});
