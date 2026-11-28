import {
	type AudioProduct,
	findEligibleEpisodes,
	syncAudioEpisodes,
	syncRun,
} from "../domain/audio_syndication.js";

const args = process.argv.slice(2);
const productNames = ["byosan", "yawa", "humanity"] as const;
const runIndex = args.indexOf("--run");
if (runIndex >= 0) {
	const value = args[runIndex + 1] ?? "";
	const [product, ...runParts] = value.split("/");
	if (!productNames.includes(product as AudioProduct) || !runParts.length)
		throw new Error(
			"usage: sync_audio_feeds.ts [--run <product>/<run-id>] [--all]",
		);
	await syncRun(product as AudioProduct, runParts.join("/"));
	console.log(JSON.stringify({ synced: `${product}/${runParts.join("/")}` }));
} else {
	const all = args.includes("--all");
	const eligible = findEligibleEpisodes();
	const selected = all
		? eligible
		: productNames.flatMap((product) =>
				eligible.filter((episode) => episode.product === product).slice(-3),
			);
	try {
		const result = await syncAudioEpisodes(selected);
		console.log(
			JSON.stringify(
				{
					...result,
					eligible: selected.map(
						(episode) => `${episode.product}/${episode.runId}`,
					),
				},
				null,
				2,
			),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
