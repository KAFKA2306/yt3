import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import fs from "fs-extra";
import yaml from "js-yaml";
import serveIndex from "serve-index";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");
const RUNS_DIR = path.join(ROOT_DIR, "runs");
const app = express();
const PORT = 3000;
app.use(express.static(path.join(__dirname, "public")));
app.use(
	"/runs",
	express.static(RUNS_DIR),
	serveIndex(RUNS_DIR, { icons: true }),
);
app.get("/api/runs", async (req: express.Request, res: express.Response) => {
	try {
		const dirs = await fs.readdir(RUNS_DIR);
		const runs = dirs
			.filter((d) => d.match(/^\d{4}-\d{2}-\d{2}/) || d.startsWith("run_"))
			.sort()
			.reverse();
		let html = "";
		for (const runId of runs) {
			html += `
                <div class="run-item" hx-get="/api/runs/${runId}" hx-target="#main-content" hx-push-url="true">
                    <span class="run-status-dot"></span>
                    <span class="run-id">${runId}</span>
                </div>
            `;
		}
		res.send(html);
	} catch (e) {
		res.status(500).send("Error loading runs");
	}
});
app.get(
	"/api/runs/:id",
	async (req: express.Request, res: express.Response) => {
		const runId = req.params.id as string;
		const runPath = path.join(RUNS_DIR, runId);
		const contentPath = path.join(runPath, "content", "output.yaml");
		try {
			const thumbPath = `/runs/${runId}/thumbnail.png`;
			const videoPath = `/runs/${runId}/video/final_video.mp4`;
			const hasThumb = await fs.pathExists(path.join(runPath, "thumbnail.png"));
			let actualVideoLink = `/runs/${runId}/video`;
			if (await fs.pathExists(path.join(runPath, "video"))) {
				const videoFiles = await fs.readdir(path.join(runPath, "video"));
				const mp4 = videoFiles.find((f) => f.endsWith(".mp4"));
				if (mp4) actualVideoLink = `/runs/${runId}/video/${mp4}`;
			}
			let metadataHtml = "";
			let scriptHtml = "";
			if (await fs.pathExists(contentPath)) {
				const contentFile = await fs.readFile(contentPath, "utf8");
				const data = yaml.load(contentFile) as any;
				if (data?.metadata) {
					metadataHtml = `
                    <div class="card metadata-card">
                        <h3>Metadata</h3>
                        <p class="meta-title">${data.metadata.title || ""}</p>
                        <p class="meta-desc">${data.metadata.description || ""}</p>
                        <div class="meta-tags">
                            ${(data.metadata.tags || []).map((t: string) => `<span class="tag">#${t}</span>`).join("")}
                        </div>
                    </div>
                `;
				}
				if (data?.script?.lines) {
					scriptHtml = `
                    <div class="card script-card">
                        <h3>Script Content</h3>
                        <div class="script-lines">
                            ${data.script.lines
							.map(
								(l: any) => `
                                <div class="script-line">
                                    <span class="speaker">${l.speaker}:</span>
                                    <span class="text">${l.text}</span>
                                </div>
                            `,
							)
							.join("")}
                        </div>
                    </div>
                `;
				}
			}
			const html = `
            <div class="run-detail">
                <div class="content-header" style="animation: none; opacity: 1;">
                    <h2>Run Details</h2>
                    <p class="sub">Identifier: <code>${runId}</code></p>
                </div>
                <div class="dashboard-grid">
                    <div class="main-column">
                        <div class="card media-card" style="padding: 10px; overflow: hidden;">
                            <div class="media-preview">
                                ${hasThumb ? `<img src="${thumbPath}" alt="Thumbnail">` : '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-dim);">No preview available</div>'}
                            </div>
                        </div>
                        ${metadataHtml}
                        ${scriptHtml}
                    </div>
                    <div class="side-column">
                        <div class="card">
                            <h3>Asset Hub</h3>
                            <div class="btn-group" style="flex-direction: column; display: flex;">
                                <a href="/runs/${runId}/research" target="_blank" class="btn btn-outline">
                                    <span>🔍</span> Research Data (Browse)
                                </a>
                                <a href="/runs/${runId}/content" target="_blank" class="btn btn-outline">
                                    <span>📝</span> Content Data (Browse)
                                </a>
                                <a href="${actualVideoLink}" target="_blank" class="btn btn-primary">
                                    <span>🎬</span> Watch Production
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
			res.send(html);
		} catch (e) {
			console.error(e);
			res.status(404).send("Run not found");
		}
	},
);
app.get(
	"/api/stats/daily",
	async (req: express.Request, res: express.Response) => {
		try {
			const logFilePath = path.join(ROOT_DIR, "logs", "agent_activity.jsonl");
			if (!(await fs.pathExists(logFilePath))) {
				return res.send("<p>No logs available yet.</p>");
			}
			const lines = (await fs.readFile(logFilePath, "utf8"))
				.split("\n")
				.filter((l) => l.trim());
			const stats: Record<
				string,
				{ calls: number; input: number; output: number }
			> = {};
			for (const line of lines) {
				try {
					const entry = JSON.parse(line);
					if (entry.event === "LLM_USAGE" && entry.context) {
						const date = entry.timestamp.split("T")[0];
						if (!stats[date]) stats[date] = { calls: 0, input: 0, output: 0 };
						stats[date].calls++;
						stats[date].input += entry.context.input_tokens || 0;
						stats[date].output += entry.context.output_tokens || 0;
					}
				} catch (e) { }
			}
			const sortedDates = Object.keys(stats).sort().reverse();
			if (sortedDates.length === 0) {
				return res.send(
					'<p style="color: var(--text-dim); padding: 20px;">No usage data recorded yet.</p>',
				);
			}
			let html = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                <thead>
                    <tr style="text-align: left; border-bottom: 1px solid var(--border); color: var(--accent);">
                        <th style="padding: 12px 8px;">Date</th>
                        <th style="padding: 12px 8px;">Calls</th>
                        <th style="padding: 12px 8px;">Input</th>
                        <th style="padding: 12px 8px;">Output</th>
                    </tr>
                </thead>
                <tbody>
        `;
			for (const date of sortedDates) {
				const s = stats[date];
				if (!s) continue;
				html += `
                <tr style="border-bottom: 1px solid var(--border); font-size: 0.9rem;">
                    <td style="padding: 12px 8px; font-family: 'JetBrains Mono';">${date}</td>
                    <td style="padding: 12px 8px;">${s.calls}</td>
                    <td style="padding: 12px 8px;">${s.input.toLocaleString()}</td>
                    <td style="padding: 12px 8px;">${s.output.toLocaleString()}</td>
                </tr>
            `;
			}
			html += "</tbody></table>";
			res.send(html);
		} catch (e) {
			console.error(e);
			res.status(500).send("Error loading stats");
		}
	},
);
app.listen(PORT, () => {
	console.log(`✨ Dashboard hub refined at http://localhost:${PORT}`);
});
