
import fs from "fs-extra";
import path from "path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const RUNS_DIR = path.join(ROOT, "runs");
const MEMORY_DIR = path.join(ROOT, "memory");
const INDEX_PATH = path.join(MEMORY_DIR, "index.yaml");

interface VideoEntry {
    id: string;
    date: string;
    topic: string;
    angle: string;
    title: string;
    keywords: string[];
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

    for (const run of runDirs) {
        const statePath = path.join(run.path, "state.json");
        if (!fs.existsSync(statePath)) continue;

        try {
            const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

            // Extract topic from director_data or bucket
            const topic = state.director_data?.title_hook
                || state.bucket
                || run.name;

            // Extract angle
            const angle = state.director_data?.angle || "Unknown";

            // Extract title from metadata
            const title = state.metadata?.title || topic;

            // Extract keywords from metadata tags
            const keywords = state.metadata?.tags || [];

            videos.push({
                id: run.name,
                date: run.name.match(/^\d{4}-\d{2}-\d{2}$/) ? run.name : new Date().toISOString().split("T")[0],
                topic,
                angle,
                title,
                keywords
            });

            console.log(`  [+] ${run.name}: ${topic.substring(0, 40)}...`);
        } catch (e) {
            console.log(`  [!] ${run.name}: Failed to parse state.json`);
        }
    }

    // Sort by date descending
    videos.sort((a, b) => b.date.localeCompare(a.date));

    // Write index
    fs.ensureDirSync(MEMORY_DIR);
    fs.writeFileSync(INDEX_PATH, yaml.dump({ videos }, { lineWidth: 120 }));

    console.log(`[Memory Sync] Indexed ${videos.length} videos to ${INDEX_PATH}`);
}

syncMemory().catch(console.error);
