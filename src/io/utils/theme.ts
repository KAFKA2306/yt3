import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import { ROOT, loadConfig } from "../base.js";
import type { AssetStore } from "../storage/asset_store.js";

export function loadMemoryContext(store: AssetStore, limit = 5): string {
	const f = path.isAbsolute(store.cfg.workflow.memory.essence_file)
		? store.cfg.workflow.memory.essence_file
		: path.join(ROOT, store.cfg.workflow.memory.essence_file);
	if (!fs.existsSync(f)) return "";
	const data = fs.readJsonSync(f) as {
		essences?: {
			topic: string;
			key_insights: string[];
			universal_principles: string[];
		}[];
	};
	if (!data.essences?.length) return "";
	return data.essences
		.slice(-limit)
		.reverse()
		.map(
			(e) =>
				`【${e.topic}】\n${e.key_insights.slice(0, 2).join("\n")}\n原則: ${e.universal_principles[0] || ""}`,
		)
		.join("\n\n");
}

export function fetchRecentThemes(store: AssetStore, days = 7): string {
	const cfg = loadConfig() as { workflow: { paths: { runs_dir: string } } };
	const root = path.join(ROOT, cfg.workflow.paths.runs_dir);
	if (!fs.existsSync(root)) return "";
	const themes: { date: string; cats: string[] }[] = [];
	const now = new Date();
	for (let i = 0; i < days; i++) {
		const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
		const p = path.join(root, d, "research", "output.yaml");
		if (fs.existsSync(p)) {
			const o = yaml.load(fs.readFileSync(p, "utf-8")) as {
				selected_topics?: { category: string }[];
				angle?: string;
			};
			if (o.selected_topics)
				themes.push({
					date: d,
					cats: o.selected_topics.map((t) => t.category).filter(Boolean),
				});
			else if (o.angle)
				themes.push({ date: d, cats: [inferCategory(o.angle)] });
		}
	}
	return themes.map((t) => `${t.date}: ${t.cats.join(", ")}`).join("\n");
}

function inferCategory(angle: string): string {
	const l = angle.toLowerCase();
	if (l.match(/金利|インフレ|cpi|gdp|frb/)) return "マクロ経済";
	if (l.match(/決算|投資|m&a|配当|earnings/)) return "企業財務";
	if (l.match(/地政学|戦争|制裁|国際|geopolitics/)) return "地政学";
	if (l.match(/技術|ai|半導体|新製品|technology/)) return "テクノロジー";
	if (l.match(/投資家|変動性|トレンド|心理|sentiment/)) return "市場心理";
	return "その他";
}
