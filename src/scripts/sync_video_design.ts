import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";

const DESIGN_DIR = path.join(process.cwd(), "config/design");
const SOURCE_PATH = path.join(DESIGN_DIR, "design_source.json");
const MAP_PATH = path.join(DESIGN_DIR, "byosan_video_token_map.json");
const BASE_PATH = path.join(DESIGN_DIR, "kafka_visual_system_v1.json");
const OUTPUT_PATH = path.join(DESIGN_DIR, "byosan_video_system_v1.json");

const HexSchema = z.string().regex(/^#[0-9A-F]{6}$/);

const DesignSourceSchema = z.object({
	repo: z.string().min(1),
	sha: z.string().regex(/^[0-9a-f]{40}$/),
	file: z.string().min(1),
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const ByosanTokenMapSchema = z.object({
	theme: z.literal("light"),
	targets: z.record(z.string().min(1), z.string().min(1)),
	exceptions: z.record(
		z.string().min(1),
		z.object({
			token: z.string().min(1).optional(),
			reason: z.string().min(1),
		}),
	),
	overrides: z.record(z.string().min(1), z.union([z.number(), z.string()])),
});

const TokenSchema = z.object({
	$value: z.union([
		z.object({ hex: HexSchema }),
		z.object({ value: z.number() }),
	]),
});

export type ByosanTokenMap = z.infer<typeof ByosanTokenMapSchema>;
export type DesignTokens = Record<string, unknown>;

export const BYOSAN_DESIGN_PATHS = {
	base: BASE_PATH,
	output: OUTPUT_PATH,
	map: MAP_PATH,
};

export function loadDesignTokens(): DesignTokens {
	const source = DesignSourceSchema.parse(fs.readJsonSync(SOURCE_PATH));
	const tokenPath = path.join(DESIGN_DIR, path.basename(source.file));
	const sha256 = createHash("sha256")
		.update(fs.readFileSync(tokenPath))
		.digest("hex");
	if (sha256 !== source.sha256)
		throw new Error(
			`BYOSAN_DESIGN_TOKEN_HASH_MISMATCH: ${tokenPath} ${sha256}`,
		);
	return fs.readJsonSync(tokenPath) as DesignTokens;
}

export function loadByosanTokenMap(): ByosanTokenMap {
	return ByosanTokenMapSchema.parse(fs.readJsonSync(MAP_PATH));
}

export function resolveToken(
	tokens: DesignTokens,
	tokenPath: string,
): string | number {
	const node = tokenPath
		.split(".")
		.reduce<unknown>(
			(current, key) => (current as Record<string, unknown>)[key],
			tokens,
		);
	const token = TokenSchema.parse(node);
	return "hex" in token.$value ? token.$value.hex : token.$value.value;
}

function setAt(
	root: Record<string, unknown>,
	pointer: string,
	value: string | number,
): void {
	const keys = pointer.split(".");
	const leaf = keys.pop();
	const parent = keys.reduce<Record<string, unknown>>(
		(node, key) => node[key] as Record<string, unknown>,
		root,
	);
	if (leaf === undefined || !(leaf in parent))
		throw new Error(`BYOSAN_DESIGN_UNKNOWN_POINTER: ${pointer}`);
	parent[leaf] = value;
}

export function buildByosanVideoSystem(
	base: Record<string, unknown>,
	map: ByosanTokenMap,
	tokens: DesignTokens,
): Record<string, unknown> {
	const next = structuredClone(base);
	const exceptionTokens = Object.entries(map.exceptions).flatMap(
		([pointer, exception]) =>
			exception.token ? [[pointer, exception.token] as const] : [],
	);
	for (const [pointer, tokenPath] of [
		...Object.entries(map.targets),
		...exceptionTokens,
	])
		setAt(next, pointer, resolveToken(tokens, tokenPath));
	for (const [pointer, value] of Object.entries(map.overrides))
		setAt(next, pointer, value);
	return next;
}

if (import.meta.main) {
	const tokens = loadDesignTokens();
	const map = loadByosanTokenMap();
	const base = fs.readJsonSync(BASE_PATH) as Record<string, unknown>;
	const next = buildByosanVideoSystem(base, map, tokens);
	fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(next, null, "\t")}\n`);
	console.log(`[sync-video-design] wrote ${OUTPUT_PATH}`);
}
