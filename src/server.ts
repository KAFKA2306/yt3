// Evolution Dashboard Bun Server
// High-performance, zero-fat, direct SQLite data broker

import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

const PORT = 3030;
const DB_FILE = "db/evolution.db";
const PUBLIC_DIR = "public";

// Initialize Database connection
const db = new Database(DB_FILE, { readonly: true });

console.log(`Starting Dashboard Server on http://localhost:${PORT}...`);

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		// CORS headers
		const headers = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Content-Type": "application/json",
		};

		if (req.method === "OPTIONS") {
			return new Response(null, { headers });
		}

		// API: Get all runs
		if (url.pathname === "/api/runs") {
			try {
				const runs = db.query("SELECT * FROM runs ORDER BY run_id DESC").all();
				return new Response(JSON.stringify(runs), { headers });
			} catch (err) {
				const error = err as Error;
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers,
				});
			}
		}

		// API: Get specific run detail
		const runDetailMatch = url.pathname.match(
			/^\/api\/runs\/([a-zA-Z0-9_-]+)$/,
		);
		if (runDetailMatch) {
			const runId = runDetailMatch[1] || "";
			try {
				const run = db.query("SELECT * FROM runs WHERE run_id = ?").get(runId);
				if (!run) {
					return new Response(JSON.stringify({ error: "Run not found" }), {
						status: 404,
						headers,
					});
				}

				const sources = db
					.query("SELECT * FROM source_evidence WHERE run_id = ?")
					.all(runId);
				const candidates = db
					.query("SELECT * FROM topic_candidates WHERE run_id = ?")
					.all(runId);
				const selection = db
					.query("SELECT * FROM selected_topics WHERE run_id = ?")
					.get(runId);
				const genome = db
					.query("SELECT * FROM strategy_genomes WHERE run_id = ?")
					.get(runId);
				const segments = db
					.query(
						"SELECT * FROM script_segments WHERE run_id = ? ORDER BY segment_index ASC",
					)
					.all(runId);
				const audits = db
					.query("SELECT * FROM audit_checks WHERE run_id = ?")
					.all(runId);
				const metrics = db
					.query("SELECT * FROM process_metrics WHERE run_id = ?")
					.get(runId);
				const media = db
					.query("SELECT * FROM media_audits WHERE run_id = ?")
					.all(runId);
				const gates = db
					.query("SELECT * FROM publish_gates WHERE run_id = ?")
					.get(runId);
				const signals = db
					.query("SELECT * FROM collapse_signals WHERE run_id = ?")
					.all(runId);
				const artifacts = db
					.query("SELECT * FROM raw_artifacts WHERE run_id = ?")
					.all(runId);

				return new Response(
					JSON.stringify({
						run,
						sources,
						candidates,
						selection,
						genome,
						segments,
						audits,
						metrics,
						media,
						gates,
						signals,
						artifacts,
					}),
					{ headers },
				);
			} catch (err) {
				const error = err as Error;
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers,
				});
			}
		}

		// API: Get evolution and mutation history
		if (url.pathname === "/api/evolution") {
			try {
				const mutations = db
					.query("SELECT * FROM mutation_plans ORDER BY id DESC")
					.all();
				const evolutions = db
					.query("SELECT * FROM evolution_events ORDER BY id DESC")
					.all();
				const learnings = db
					.query("SELECT * FROM learning_events ORDER BY id DESC")
					.all();
				const thresholdHistory = db
					.query("SELECT * FROM threshold_history ORDER BY id DESC")
					.all();

				return new Response(
					JSON.stringify({
						mutations,
						evolutions,
						learnings,
						thresholdHistory,
					}),
					{ headers },
				);
			} catch (err) {
				const error = err as Error;
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers,
				});
			}
		}

		// API: Get system stats/KPIs
		if (url.pathname === "/api/stats") {
			try {
				const totalRuns = db
					.query("SELECT COUNT(*) as count FROM runs")
					.get() as { count: number };
				const successRuns = db
					.query("SELECT COUNT(*) as count FROM runs WHERE status = 'SUCCESS'")
					.get() as { count: number };
				const blockedRuns = db
					.query(
						"SELECT COUNT(*) as count FROM runs WHERE status = 'PUBLISH_BLOCKED'",
					)
					.get() as { count: number };

				const latestSimilarity = db
					.query(
						"SELECT new_value FROM threshold_history WHERE metric_name = 'novelty_similarity_limit' ORDER BY id DESC LIMIT 1",
					)
					.get() as { new_value: number };
				const avgMetrics = db
					.query(
						"SELECT AVG(abstract_ratio) as abs, AVG(entity_density) as ent, AVG(similarity_score) as sim FROM process_metrics",
					)
					.get() as { abs: number; ent: number; sim: number };

				return new Response(
					JSON.stringify({
						total: totalRuns?.count || 0,
						success: successRuns?.count || 0,
						blocked: blockedRuns?.count || 0,
						currentSimilarityLimit: latestSimilarity?.new_value || 0.7,
						averages: {
							abstractRatio: avgMetrics?.abs || 0,
							entityDensity: avgMetrics?.ent || 0,
							similarityScore: avgMetrics?.sim || 0,
						},
					}),
					{ headers },
				);
			} catch (err) {
				const error = err as Error;
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers,
				});
			}
		}

		// API: Get generic database table rows
		const dbTableMatch = url.pathname.match(/^\/api\/db\/([a-zA-Z0-9_-]+)$/);
		if (dbTableMatch) {
			const tableName = dbTableMatch[1] || "";
			const allowedTables = [
				"runs",
				"raw_artifacts",
				"source_evidence",
				"topic_candidates",
				"selected_topics",
				"strategy_genomes",
				"script_segments",
				"audit_checks",
				"process_metrics",
				"repair_events",
				"media_audits",
				"publish_gates",
				"youtube_analytics",
				"learning_events",
				"threshold_history",
				"collapse_signals",
				"mutation_plans",
				"evolution_events",
			];
			if (!allowedTables.includes(tableName)) {
				return new Response(
					JSON.stringify({ error: "Unauthorized table query" }),
					{
						status: 403,
						headers,
					},
				);
			}

			try {
				const rows = db.query(`SELECT * FROM ${tableName} LIMIT 100`).all();
				return new Response(JSON.stringify(rows), { headers });
			} catch (err) {
				const error = err as Error;
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers,
				});
			}
		}

		// Serve Frontend static index.html
		if (url.pathname === "/" || url.pathname === "/index.html") {
			const indexFile = path.join(PUBLIC_DIR, "index.html");
			if (fs.existsSync(indexFile)) {
				return new Response(fs.readFileSync(indexFile), {
					headers: { "Content-Type": "text/html" },
				});
			}
			return new Response("Frontend index.html not found.", { status: 404 });
		}

		// Fallback for static assets in public/
		const filePath = path.join(PUBLIC_DIR, url.pathname);
		if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
			const ext = path.extname(filePath);
			let contentType = "text/plain";
			if (ext === ".css") contentType = "text/css";
			if (ext === ".js") contentType = "application/javascript";
			if (ext === ".png") contentType = "image/png";
			if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
			if (ext === ".svg") contentType = "image/svg+xml";

			return new Response(fs.readFileSync(filePath), {
				headers: { "Content-Type": contentType },
			});
		}

		return new Response("Not Found", { status: 404 });
	},
});
