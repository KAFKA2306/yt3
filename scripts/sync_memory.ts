
import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), "config", ".env") });

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, "runs");
const MEMORY_DIR = path.join(ROOT, "memory");
const INDEX_PATH = path.join(MEMORY_DIR, "index.yaml");
const ESSENCES_PATH = path.join(MEMORY_DIR, "essences.yaml");

interface VideoEntry {
    id: string;
    date: string;
    topic: string;
    angle: string;
    title: string;
    keywords: string[];
}

interface Essence {
    video_id: string;
    topic: string;
    key_insights: string[];
    data_points: string[];
    universal_principles: string[];
    connections: { related_topic: string; relation: string }[];
}

async function extractEssence(state: any): Promise<Essence | null> {
    if (!state.script?.lines || !process.env.GEMINI_API_KEY) return null;

    const script = state.script.lines.map((l: any) => `${l.speaker}: ${l.text}`).join("\n");

    const llm = new ChatGoogleGenerativeAI({
        model: "gemini-2.0-flash",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: 0.3
    });

    const prompt = `以下の金融動画スクリプトから、永続的な価値を持つエッセンスを抽出してください。

スクリプト:
${script}

JSON形式で出力:
{
  "key_insights": ["普遍的な洞察1", "普遍的な洞察2"],
  "data_points": ["具体的数値1", "具体的数値2"],
  "universal_principles": ["金融の法則1"],
  "connections": [{"related_topic": "関連テーマ", "relation": "関係性"}]
}`;

    try {
        const response = await llm.invoke(prompt);
        const text = typeof response.content === "string" ? response.content : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);
        return {
            video_id: state.run_id,
            topic: state.metadata?.title || state.bucket,
            ...parsed
        };
    } catch (e) {
        console.log(`  [!] Essence extraction failed: ${e}`);
        return null;
    }
}

async function syncMemory() {
    console.log("[Memory Sync] Scanning runs directory...");

    if (!fs.existsSync(RUNS_DIR)) {
        console.log("[Memory Sync] No runs directory found.");
        return;
    }

    const runDirs = fs.readdirSync(RUNS_DIR)
        .map(name => ({ name, path: path.join(RUNS_DIR, name) }))
        .filter(d => fs.statSync(d.path).isDirectory());

    const videos: VideoEntry[] = [];
    const existingEssences: Essence[] = fs.existsSync(ESSENCES_PATH)
        ? (yaml.load(fs.readFileSync(ESSENCES_PATH, "utf8")) as any)?.essences || []
        : [];
    const existingIds = new Set(existingEssences.map(e => e.video_id));
    const newEssences: Essence[] = [];

    for (const run of runDirs) {
        const statePath = path.join(run.path, "state.json");
        if (!fs.existsSync(statePath)) continue;

        try {
            const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

            const topic = state.director_data?.title_hook || state.bucket || run.name;
            const angle = state.director_data?.angle || "Unknown";
            const title = state.metadata?.title || topic;
            const keywords = state.metadata?.tags || [];

            videos.push({
                id: run.name,
                date: run.name.match(/^\d{4}-\d{2}-\d{2}$/) ? run.name : new Date().toISOString().split("T")[0],
                topic, angle, title, keywords
            });

            console.log(`  [+] ${run.name}: ${topic.substring(0, 40)}...`);

            // Extract essence if not already done
            if (!existingIds.has(run.name) && state.script?.lines) {
                console.log(`      Extracting essence...`);
                const essence = await extractEssence(state);
                if (essence) {
                    newEssences.push(essence);
                    console.log(`      ✓ Extracted ${essence.key_insights.length} insights`);
                }
            }
        } catch (e) {
            console.log(`  [!] ${run.name}: Failed to parse`);
        }
    }

    // Sort by date descending
    videos.sort((a, b) => b.date.localeCompare(a.date));

    // Write index
    fs.ensureDirSync(MEMORY_DIR);
    fs.writeFileSync(INDEX_PATH, yaml.dump({ videos }, { lineWidth: 120 }));
    console.log(`[Memory Sync] Indexed ${videos.length} videos`);

    // Write essences
    const allEssences = [...existingEssences, ...newEssences];
    fs.writeFileSync(ESSENCES_PATH, yaml.dump({ essences: allEssences }, { lineWidth: 120 }));
    console.log(`[Memory Sync] ${newEssences.length} new essences extracted, ${allEssences.length} total`);
}

syncMemory().catch(console.error);
