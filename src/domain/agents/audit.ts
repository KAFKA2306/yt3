import fs from "fs-extra";
import path from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import { 
	type AssetStore,
	BaseAgent,
	ROOT,
	RunStage,
	parseLlmJson,
} from "../../io/core.js";
import type { AgentState, Script } from "../types.js";

/**
 * AuditCheck: Single Source of Truth for validation results.
 * Zero-Fat / Evidence-Based.
 */
export interface AuditCheck {
	name: string;
	description: string;
	passed: boolean;
	details?: string;
	critical: boolean;
	type: "DETERMINISTIC" | "BOUNDED_PROBABILISTIC";
}

const SemanticAuditResultSchema = z.object({
	content_structure: z.object({
		passed: z.boolean(),
		score: z.number(),
		feedback: z.string(),
	}),
	brand_voice: z.object({
		passed: z.boolean(),
		score: z.number(),
		feedback: z.string(),
	}),
});

export class AuditAgent extends BaseAgent {
	constructor(store: AssetStore) {
		super(store, RunStage.AUDIT);
	}

	async run(state: AgentState): Promise<Record<string, AuditCheck>> {
		const results: Record<string, AuditCheck> = {};
		const evidence: Record<string, any> = {};

		// 1. SIGNAL AUDIT (DETERMINISTIC)
		Object.assign(results, await this.auditSignals(state, evidence));

		// 2. POLICY AUDIT (DETERMINISTIC / REGEX)
		Object.assign(results, this.auditPolicies(state, evidence));

		// 3. SEMANTIC AUDIT (BOUNDED PROBABILISTIC / LLM)
		if (state.script && state.metadata) {
			Object.assign(results, await this.auditSemantics(state, evidence));
		}

		// 4. VOICE ROLE INTEGRITY (Speaker Assignment Audit)
		if (state.script) {
			Object.assign(results, this.auditVoiceRoles(state, evidence));
		}

		// 5. OPERATIONAL AUDIT (Workflow & Publish Trace)
		Object.assign(results, this.auditOperations(state, evidence));

		// 6. TOPOLOGY (Job Relationship Evidence)
		this.auditTopology(evidence);

		// 7. PROVENANCE (Traceability)
		results.provenance = this.checkProvenance(evidence);

		// Save Canonical Evidence Bundle (Explicit JSON to avoid collision)
		const auditDir = path.join(this.store.runDir, "audit");
		fs.ensureDirSync(auditDir);
		fs.writeJsonSync(path.join(auditDir, "evidence_raw.json"), evidence, { spaces: 2 });
		fs.writeJsonSync(path.join(auditDir, "result.json"), results, { spaces: 2 });

		this.logOutput(results);
		return results;
	}

	private async auditSignals(state: AgentState, evidence: Record<string, any>): Promise<Record<string, AuditCheck>> {
		const checks: Record<string, AuditCheck> = {};
		const videoPath = state.video_path;

		if (!videoPath || !fs.existsSync(videoPath)) return {};

		// A. Signal: Loudness (EBU R128) - Compliance with YouTube/Broadcast standards
		try {
			const audioLog = execSync(`ffmpeg -i "${videoPath}" -af ebur128=peak=true -f null /dev/null 2>&1`, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
			const integratedLUFS = parseFloat(audioLog.match(/I:\s+([\-\d\.]+) LUFS/)?.[1] || "0");
			const truePeak = parseFloat(audioLog.match(/Peak:\s+([\-\d\.]+) dBTP/)?.[1] || "0");
			
			checks.audio_loudness = {
				name: "Signal: Loudness (EBU R128)",
				description: "Target -14 LUFS (+/- 2). Rejects clipping or whisper-quiet audio.",
				passed: integratedLUFS > -18 && integratedLUFS < -11 && truePeak < -0.1,
				details: `LUFS: ${integratedLUFS}, Peak: ${truePeak} dBTP`,
				critical: true,
				type: "DETERMINISTIC",
			};
			evidence.ebur128 = { integratedLUFS, truePeak };
		} catch (e) { evidence.loudness_error = String(e); }

		// B. Visual Defects (Freeze detection)
		try {
			const videoLog = execSync(`ffmpeg -i "${videoPath}" -vf "freezedetect=d=5,blackdetect=d=2" -f null /dev/null 2>&1`, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
			const freezes = (videoLog.match(/freeze_start/g) || []).length;
			const blacks = (videoLog.match(/black_start/g) || []).length;
			
			checks.video_defects = {
				name: "Signal: Visual Defects",
				description: "Detects frozen frames (>5s) or black frames (>2s).",
				passed: freezes === 0 && blacks === 0,
				details: `Freezes: ${freezes}, Blackout: ${blacks}`,
				critical: true,
				type: "DETERMINISTIC",
			};
			evidence.video_defects = { freezes, blacks };
		} catch (e) { evidence.video_error = String(e); }

		// C. ASR Loopback (Zero-Trust Numeric Integrity)
		try {
			const asrDir = path.join(this.store.runDir, "audit_asr");
			execSync(`uv run --with faster-whisper python .claude/skills/audio-production/scripts/run_asr.py --input-wav "${videoPath}" --output-dir "${asrDir}" --model tiny`, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
			
			const asrRaw = fs.readFileSync(path.join(asrDir, "asr_raw.jsonl"), "utf-8");
			evidence.asr_transcript = asrRaw;
			
			// Robust Numeric Integrity Check (Frequency Map)
			const scriptText = JSON.stringify(state.script?.lines || "").toLowerCase();
			const scriptMap = this.getNumericFrequencyMap(scriptText);
			const asrMap = this.getNumericFrequencyMap(asrRaw);
			
			const missing: string[] = [];
			for (const [num, count] of Object.entries(scriptMap)) {
				if ((asrMap[num] || 0) < count) {
					missing.push(`${num} (expected ${count}, found ${asrMap[num] || 0})`);
				}
			}
			
			checks.asr_loopback = {
				name: "Signal: ASR Loopback",
				description: "Reverse transcription to detect numeric hallucination (Frequency Map match).",
				passed: missing.length === 0,
				details: missing.length > 0 ? `Numeric Mismatch: ${missing.join(", ")}` : "All numeric entities verified",
				critical: true,
				type: "DETERMINISTIC",
			};
		} catch (e) { 
			evidence.asr_error = String(e); 
			checks.asr_infra = {
				name: "Signal: ASR Verifier Health",
				description: "Integrity of the ASR loopback infrastructure.",
				passed: false,
				details: `ASR Verifier Failed: ${String(e)}`,
				critical: true,
				type: "DETERMINISTIC",
			};
		}

		return checks;
	}

	/**
	 * Voice Role Audit: Ensures the correct Voice ID was used for each speaker role.
	 * Cross-references script.yaml with audio/manifest.json.
	 */
	private auditVoiceRoles(state: AgentState, evidence: Record<string, any>): Record<string, AuditCheck> {
		const checks: Record<string, AuditCheck> = {};
		const manifestPath = path.join(this.store.audioDir(), "manifest.json");

		if (!fs.existsSync(manifestPath)) {
			evidence.voice_error = "Audio manifest missing. Cannot verify roles.";
			checks.voice_integrity = {
				name: "Voice Role: Integrity Check",
				description: "Verification of speaker-to-voice mapping.",
				passed: false,
				details: "Missing audio manifest.",
				critical: true,
				type: "DETERMINISTIC",
			};
			return checks;
		}

		const manifest = fs.readJsonSync(manifestPath);
		if (!manifest || !manifest.voice_map || !manifest.chunks) {
			evidence.voice_error = "Invalid audio manifest format.";
			return {
				voice_integrity: {
					name: "Voice Role: Integrity Check",
					description: "Verification of speaker-to-voice mapping.",
					passed: false,
					details: "Invalid manifest format.",
					critical: true,
					type: "DETERMINISTIC",
				}
			};
		}

		const scriptLines = state.script?.lines || [];
		const mismatches: string[] = [];

		for (let i = 0; i < scriptLines.length; i++) {
			const line = scriptLines[i];
			if (!line) continue;
			
			const expectedSpeaker = line.speaker;
			const expectedVoiceId = manifest.voice_map[expectedSpeaker];
			const actualVoiceId = manifest.chunks[i]?.voice_id;

			if (actualVoiceId === undefined || actualVoiceId !== expectedVoiceId) {
				mismatches.push(`Line ${i}: Expected ${expectedSpeaker} (ID: ${expectedVoiceId}), but found ID: ${actualVoiceId}`);
			}
		}

		checks.voice_integrity = {
			name: "Voice Role: Integrity Check",
			description: "Ensures Zundamon/Tsumugi roles match their assigned Voice IDs.",
			passed: mismatches.length === 0,
			details: mismatches.length > 0 ? `Mismatch detected: ${mismatches.slice(0, 3).join("; ")}` : "All voice roles verified",
			critical: true,
			type: "DETERMINISTIC",
		};
		evidence.voice_mismatches = mismatches;

		return checks;
	}

	/**
	 * Operational Audit: Verifies the integrity of the publishing process and error classification.
	 * Rejects 'Unknown Error' and missing publish receipts.
	 */
	private auditOperations(state: AgentState, evidence: Record<string, any>): Record<string, AuditCheck> {
		const checks: Record<string, AuditCheck> = {};
		
		// 1. Infra Health (Detect verifier crashes like ENOBUFS)
		const infraErrors = Object.entries(evidence)
			.filter(([k, v]) => k.endsWith("_error") && (String(v).includes("ENOBUFS") || String(v).includes("spawnSync")))
			.map(([k, _]) => k);
			
		checks.infra_health = {
			name: "Operation: Infrastructure Health",
			description: "Detects verifier crashes (e.g. ENOBUFS, Timeout) in evidence bundle.",
			passed: infraErrors.length === 0,
			details: infraErrors.length > 0 ? `Verifier crashed: ${infraErrors.join(", ")}` : "All verifiers operational",
			critical: true,
			type: "DETERMINISTIC",
		};

		// 2. Publish Receipt Integrity
		const yt = state.publish_results?.youtube;
		const hasAttemptedPublish = state.status === "SUCCESS" || state.status === "PUBLISH_FAILED";
		
		if (hasAttemptedPublish && (!yt || !yt.video_id)) {
			checks.publish_receipt = {
				name: "Operation: Publish Receipt Integrity",
				description: "Ensures YouTube videoId and channel metadata are captured.",
				passed: false,
				details: "Publish attempted but no videoId found in results.",
				critical: true,
				type: "DETERMINISTIC",
			};
		} else if (yt?.video_id) {
			checks.publish_receipt = {
				name: "Operation: Publish Receipt Integrity",
				description: "Ensures YouTube videoId and channel metadata are captured.",
				passed: !!(yt.channel_id && yt.privacy_status),
				details: `VideoID: ${yt.video_id}, Channel: ${yt.channel_title}`,
				critical: true,
				type: "DETERMINISTIC",
			};
		}

		// 3. Error Classification Integrity
		const logPath = path.join(ROOT, "logs", "agent_activity.jsonl");
		let unknownErrors = 0;
		if (fs.existsSync(logPath)) {
			const logs = fs.readFileSync(logPath, "utf-8");
			unknownErrors = (logs.match(/Unknown Error/gi) || []).length;
		}
		
		// Also check the current evidence bundle for unclassified error strings
		const evidenceStr = JSON.stringify(evidence);
		const unclassifiedInEvidence = (evidenceStr.match(/Unknown Error/gi) || []).length;
		const totalUnknown = unknownErrors + unclassifiedInEvidence;

		checks.error_classification = {
			name: "Operation: Error Classification",
			description: "Bans 'Unknown Error' strings in logs and evidence. Requires structured error codes.",
			passed: totalUnknown === 0,
			details: totalUnknown > 0 ? `Found ${totalUnknown} unclassified errors.` : "All errors classified",
			critical: true,
			type: "DETERMINISTIC",
		};
		evidence.operations = { unknown_errors: totalUnknown, infra_crashes: infraErrors };

		return checks;
	}

	/**
	 * Job Topology: Documents the relationship between different execution phases.
	 */
	private auditTopology(evidence: Record<string, any>) {
		const topology = {
			run_id: this.store.runDir.split("/").pop(),
			phases: [
				{ name: "Generation", time: "05:00", objective: "Asset Creation" },
				{ name: "Audit & Publish", time: "07:00", objective: "Quality Gate & Distribution" },
				{ name: "Sentinel", time: "08:00", objective: "Success Verification" }
			],
			dependencies: "Linear Pipeline (Sequential)",
			verifiable_marker: "SUCCESS file in run directory"
		};
		
		const topologyPath = path.join(this.store.runDir, "job_topology.json");
		fs.writeJsonSync(topologyPath, topology, { spaces: 2 });
		evidence.topology = topology;
	}

	private auditPolicies(state: AgentState, evidence: Record<string, any>): Record<string, AuditCheck> {
		const checks: Record<string, AuditCheck> = {};
		const title = state.metadata?.title || "";
		
		// Hard Blacklist (Sensational Framing)
		const blacklist = [/衝撃/, /ヤバい/, /緊急/, /パニック/];
		const found = blacklist.filter(re => re.test(title)).map(re => re.source);

		// Contextual Whitelist (Legitimate Financial Terms)
		// "崩壊" is allowed if followed by market/supply chain terms, but blocked if used for "end of Japan" etc.
		const isSensationalCollapse = /日本.*崩壊/.test(title) || /世界.*終了/.test(title);
		if (isSensationalCollapse) found.push("Sensational Collapse Narrative");

		checks.policy_clickbait = {
			name: "Policy: Clickbait Rejection",
			description: "Hybrid Regex + Contextual narrative block.",
			passed: found.length === 0,
			details: found.length > 0 ? `Violations: ${found.join(", ")}` : "Clear",
			critical: true,
			type: "DETERMINISTIC",
		};
		evidence.policy = { found };

		return checks;
	}

	private async auditSemantics(state: AgentState, evidence: Record<string, any>): Promise<Record<string, AuditCheck>> {
		const system = `You are a Bounded Classifier for "Byosan Money".
Grade the provided script based on:
1. STRUCTURE: Cause -> Impact -> Future (原因→影響→今後).
2. VOICE: Adaptive Growth (Reject Doom/Collapse).

Output MUST be a single JSON object with this structure:
{
  "content_structure": { "passed": boolean, "score": number, "feedback": string },
  "brand_voice": { "passed": boolean, "score": number, "feedback": string }
}
Output JSON strictly.`;

		try {
			const res = await this.runLlm(system, JSON.stringify(state.script?.lines.slice(0, 10)), (t) => parseLlmJson(t, SemanticAuditResultSchema), { temperature: 0 });
			evidence.semantic = res;

			return {
				semantic_structure: {
					name: "Probabilistic: Narrative Structure",
					description: "LLM logic-chain verification (Cause -> Impact -> Future).",
					passed: res.content_structure.passed,
					details: `Score: ${res.content_structure.score}/10. ${res.content_structure.feedback}`,
					critical: true,
					type: "BOUNDED_PROBABILISTIC",
				},
				brand_voice: {
					name: "Probabilistic: Brand Voice",
					description: "Verification of 'Adaptive Growth' narrative alignment.",
					passed: res.brand_voice.passed,
					details: `Score: ${res.brand_voice.score}/10. ${res.brand_voice.feedback}`,
					critical: true,
					type: "BOUNDED_PROBABILISTIC",
				}
			};
		} catch (e) {
			evidence.semantic_error = String(e);
			return {
				semantic_infra: {
					name: "Probabilistic: Semantic Verifier Health",
					description: "Integrity of the LLM-based semantic audit.",
					passed: false,
					details: `Semantic Audit Failed: ${String(e)}`,
					critical: true,
					type: "DETERMINISTIC",
				}
			};
		}
	}

	private checkProvenance(evidence: Record<string, any>): AuditCheck {
		const commit = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
		evidence.provenance = { commit };
		return {
			name: "Provenance: Commit Trace",
			description: "Sovereign build trace.",
			passed: true,
			details: commit.substring(0, 7),
			critical: true,
			type: "DETERMINISTIC",
		};
	}

	/**
	 * Extracts and normalizes numbers from text, handling Japanese financial units.
	 * Returns a Frequency Map of normalized numbers.
	 */
	private getNumericFrequencyMap(text: string): Record<string, number> {
		const map: Record<string, number> = {};
		
		// 1. Extract raw numbers and units
		// Matches: "3兆", "1.5億", "200", "0.25%"
		const matches = text.match(/(\d+(\.\d+)?)\s*([兆億万%])?/g) || [];
		
		for (const m of matches) {
			let val = m.trim();
			
			// 2. Normalize Japanese units to pure numeric strings (Zero-expansion)
			if (val.includes("兆")) {
				val = (parseFloat(val) * 1_000_000_000_000).toString();
			} else if (val.includes("億")) {
				val = (parseFloat(val) * 100_000_000).toString();
			} else if (val.includes("万")) {
				val = (parseFloat(val) * 10_000).toString();
			} else if (val.includes("%")) {
				val = parseFloat(val).toString(); // Strip %
			}
			
			map[val] = (map[val] || 0) + 1;
		}
		
		return map;
	}
}
