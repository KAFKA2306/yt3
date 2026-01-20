import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), "config", ".env") });
const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, "runs");
const MEMORY_DIR = path.join(ROOT, "memory");

async function sync() {
    const runDirs = fs.readdirSync(RUNS_DIR).filter(n => fs.statSync(path.join(RUNS_DIR, n)).isDirectory());
    const videos = runDirs.map(n => {
        const s = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, n, "state.json"), "utf8"));
        return { id: n, date: n, topic: s.director_data.title_hook, angle: s.director_data.angle, title: s.metadata.title, keywords: s.metadata.tags };
    });
    fs.writeFileSync(path.join(MEMORY_DIR, "index.yaml"), yaml.dump({ videos }));

    const llm = new ChatGoogleGenerativeAI({ model: "gemini-2.0-flash", apiKey: process.env.GEMINI_API_KEY });
    const essPath = path.join(MEMORY_DIR, "essences.yaml");
    const existing = fs.existsSync(essPath) ? (yaml.load(fs.readFileSync(essPath, "utf8")) as any).essences : [];
    const doneIds = new Set(existing.map((e: any) => e.video_id));

    const pending = runDirs.filter(n => !doneIds.has(n));
    const newEss = await Promise.all(pending.map(async n => {
        const s = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, n, "state.json"), "utf8"));
        const res = await llm.invoke(`Extract insights from script: ${s.script.lines.map((l: any) => l.text).join(" ")}\nOutput JSON: {key_insights:[], data_points:[], universal_principles:[], connections:[]}`);
        return { video_id: n, topic: s.metadata.title, ...JSON.parse((res.content as string).match(/\{[\s\S]*\}/)![0]) };
    }));

    fs.writeFileSync(essPath, yaml.dump({ essences: [...existing, ...newEss] }));
}

sync().catch(console.error);
