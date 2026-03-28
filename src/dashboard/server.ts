import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "fs-extra";
import yaml from "js-yaml";
import serveIndex from "serve-index";
import {
	AssetStore,
	BaseAgent,
	createLlm,
	getCurrentDateString,
	loadConfig,
} from "../io/core.js";
import { createQuotaRouter } from "./quota.js";
import { createDashboardRoutes } from "./routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../../");
const RUNS_DIR = path.join(ROOT_DIR, "runs");
const app = express();
const cfg = loadConfig();
const PORT = cfg.dashboard?.port ?? 3000;

function escape(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Register Quota Dashboard routes
app.use("/dashboard", createDashboardRoutes());
app.use("/api/quota", createQuotaRouter());

const authMiddleware = (
	req: express.Request,
	res: express.Response,
	next: Function,
) => {
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	const token = authHeader.substring(7);
	if (token !== process.env.DASHBOARD_TOKEN) {
		return res.status(401).json({ error: "Unauthorized" });
	}
	next();
};

class ChatAgent extends BaseAgent {
	constructor() {
		super(new AssetStore("chat_session"), "chat");
	}
}

let lastPrompt = "";

app.post("/api/chat", authMiddleware, (req, res) => {
	try {
		lastPrompt = req.body.prompt;
		res.send(
			'<div id="chat-output" hx-ext="sse" sse-connect="/api/chat/sse" sse-swap="message">Waiting for Gemini...</div>',
		);
	} catch (error) {
		console.error("Error in POST /api/chat:", error);
		res
			.status(500)
			.send(
				'<div id="chat-output" style="color: var(--text-dim);">An error occurred. Please try again.</div>',
			);
	}
});

app.get("/api/chat/sse", authMiddleware, async (req, res) => {
	try {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");

		const agent = new ChatAgent();
		const llm = createLlm({ temperature: 0.7 });
		const stream = await llm.stream([
			{
				role: "system",
				content:
					"You are a helpful assistant in the YT3 project. Answer concisely.",
			},
			{ role: "user", content: lastPrompt },
		]);

		let fullText = "";
		for await (const chunk of stream) {
			fullText += (chunk.content as string) || "";
			const display = fullText.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
			res.write(`data: ${display}\n\n`);
		}
		res.write("event: close\ndata: \n\n");
		res.end();
	} catch (error) {
		console.error("Error in GET /api/chat/sse:", error);
		res.write("event: error\ndata: An error occurred\n\n");
		res.end();
	}
});

app.use(
	"/runs",
	express.static(RUNS_DIR),
	serveIndex(RUNS_DIR, { icons: true }),
);
app.get(
	"/api/runs",
	authMiddleware,
	async (req: express.Request, res: express.Response) => {
		try {
			const dirs = await fs.readdir(RUNS_DIR);
			const runs = dirs
				.filter((d) => d.match(/^\d{4}-\d{2}-\d{2}/) || d.startsWith("run_"))
				.sort()
				.reverse();
			let html = "";
			for (const runId of runs) {
				const escapedRunId = escape(runId);
				html += `
                <div class="run-item" hx-get="/api/runs/${escapedRunId}" hx-target="#main-content" hx-push-url="true">
                    <span class="run-status-dot"></span>
                    <span class="run-id">${escapedRunId}</span>
                </div>
            `;
			}
			res.send(html);
		} catch (e) {
			console.error("Error in GET /api/runs:", e);
			res.status(500).send("An error occurred. Please try again.");
		}
	},
);
app.get(
	"/api/runs/:id",
	async (req: express.Request, res: express.Response) => {
		try {
			const runId = req.params.id as string;
			const runPath = path.join(RUNS_DIR, runId);
			const contentPath = path.join(runPath, "content", "output.yaml");

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
                        <p class="meta-title">${escape(data.metadata.title || "")}</p>
                        <p class="meta-desc">${escape(data.metadata.description || "")}</p>
                        <div class="meta-tags">
                            ${(data.metadata.tags || []).map((t: string) => `<span class="tag">#${escape(t)}</span>`).join("")}
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
																(l: { speaker: string; text: string }) => `
                                <div class="script-line">
                                    <span class="speaker">${escape(l.speaker)}:</span>
                                    <span class="text">${escape(l.text)}</span>
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
                    <p class="sub">Identifier: <code>${escape(runId)}</code></p>
                </div>
                <div class="dashboard-grid">
                    <div class="main-column">
                        <div class="card media-card" style="padding: 10px; overflow: hidden;">
                            <div class="media-preview">
                                ${hasThumb ? `<img src="${escape(thumbPath)}" alt="Thumbnail">` : '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--text-dim);">No preview available</div>'}
                            </div>
                        </div>
                        ${metadataHtml}
                        ${scriptHtml}
                    </div>
                    <div class="side-column">
                        <div class="card">
                            <h3>Asset Hub</h3>
                            <div class="btn-group" style="flex-direction: column; display: flex;">
                                <a href="/runs/${escape(runId)}/research" target="_blank" class="btn btn-outline">
                                    <span>🔍</span> Research Data (Browse)
                                </a>
                                <a href="/runs/${escape(runId)}/content" target="_blank" class="btn btn-outline">
                                    <span>📝</span> Content Data (Browse)
                                </a>
                                <a href="${escape(actualVideoLink)}" target="_blank" class="btn btn-primary">
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
			console.error("Error in GET /api/runs/:id:", e);
			res.status(500).send("An error occurred. Please try again.");
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
				} catch (e) {}
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
			console.error("Error in GET /api/stats/daily:", e);
			res.status(500).send("An error occurred. Please try again.");
		}
	},
);

app.listen(PORT, () => {
	console.log(`✨ Dashboard hub refined at http://localhost:${PORT}`);
});

export default app;
