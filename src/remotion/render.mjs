import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const [propsPath, outputPath, chrome, crf, publicDir] = process.argv.slice(2);
const inputProps = JSON.parse(fs.readFileSync(propsPath, "utf8"));
const serveUrl = await bundle({
	entryPoint: path.resolve("src/remotion/index.ts"),
	publicDir: path.resolve(publicDir),
});
const browserExecutable = chrome || null;
const composition = await selectComposition({
	serveUrl,
	id: "ByosanVideo",
	inputProps,
	browserExecutable,
});
await renderMedia({
	composition,
	serveUrl,
	codec: "h264",
	crf: Number(crf),
	colorSpace: "bt709",
	pixelFormat: "yuv420p",
	outputLocation: outputPath,
	inputProps,
	browserExecutable,
});
