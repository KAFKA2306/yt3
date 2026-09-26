import { loadByosanExperienceConfig } from "../domain/experience/config.js";

try {
	const config = await loadByosanExperienceConfig();
	console.log(
		JSON.stringify(
			{
				status: "PASS",
				channel: config.profile.channel,
				visual_vocabulary_count: config.world.visual_vocabulary.length,
				benchmark_scene_ids: config.benchmark.items.map((item) => item.id),
			},
			null,
			2,
		),
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
