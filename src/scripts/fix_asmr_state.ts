import fs from "fs-extra";
import path from "node:path";

const BASE = "/home/kafka/2511youtuber/v3/yt3";
const RUNS = [
	"2026-05-10/echo_memory_rental_v1",
	"2026-05-10/publish_oneesan_safe_long",
	"2026-05-10/publish_new_work",
	"2026-05-10/publish_midnight_maid_safe",
	"2026-05-10/publish_safe_trilogy",
];

function parseMetadata(mdPath: string) {
	if (!fs.existsSync(mdPath)) return null;
	const content = fs.readFileSync(mdPath, "utf-8");
	const titleMatch = content.match(/## タイトル\n(.*)/);
	const descMatch = content.match(/## 説明文\n([\s\S]*?)\n##/);
	const tagsMatch = content.match(/## タグ\n(.*)/);

	return {
		title: titleMatch && titleMatch[1] ? titleMatch[1].trim() : "ASMR Archive",
		description:
			descMatch && descMatch[1]
				? descMatch[1].trim()
				: "Quiet late-night ASMR.",
		tags:
			tagsMatch && tagsMatch[1]
				? tagsMatch[1].split(",").map((t) => t.trim())
				: ["ASMR", "healing"],
		thumbnail_title: "ASMR",
	};
}

for (const runId of RUNS) {
	const fullRunDir = path.join(BASE, "runs", runId);
	const metadata = parseMetadata(path.join(fullRunDir, "youtube_metadata.md"));

	const state = {
		run_id: runId.split("/").pop(),
		bucket: "asmr",
		video_path: path.join(fullRunDir, "final_video.mp4"),
		thumbnail_path: path.join(fullRunDir, "thumbnail.png"),
		metadata: metadata || {
			title: "ASMR Archive",
			description: "Quiet late-night ASMR.",
			tags: ["ASMR", "healing"],
			thumbnail_title: "ASMR",
		},
	};

	const statePath = path.join(fullRunDir, "state.json");
	fs.writeJsonSync(statePath, state, { spaces: 2 });
	console.log(`Created state.json for ${runId} at ${statePath}`);
}
