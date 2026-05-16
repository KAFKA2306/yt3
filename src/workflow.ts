import path from "node:path";
import fs from "fs-extra";
import { AssetStore } from "./io/core.js";
import { TrendScout } from "./domain/agents/research.js";
import { ScriptSmith } from "./domain/agents/content.js";
import { VisualDirector } from "./domain/agents/media.js";
import { PublishAgent } from "./domain/agents/publish.js";
import { AuditAgent } from "./domain/agents/audit.js";
import { AgentLogger } from "./io/utils/logger.js";
import type { AgentState } from "./domain/types.js";

/**
 * Sequential Pipeline: Decision-free execution of the video production loop.
 * Each stage produces artifacts and persists state.
 */
export async function runSequentialWorkflow(store: AssetStore, initialState: Partial<AgentState>) {
    let state: AgentState = { ...initialState } as AgentState;

    // 1. Research (Trend discovery)
    AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Research...");
    const research = new TrendScout(store);
    const researchResults = await research.run(state.bucket, state.limit, state.mission_file);
    state = { ...state, news: researchResults.news, director_data: researchResults.director_data, memory_context: researchResults.memory_context };
    
    // Save research.json
    fs.writeJsonSync(path.join(store.runDir, "research.json"), researchResults, { spaces: 2 });

    // 2. Script & Metadata (Narrative synthesis)
    AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Content Synthesis...");
    const scriptSmith = new ScriptSmith(store);
    const contentResults = await scriptSmith.run(state.news || [], state.director_data!, state.memory_context || "");
    state = { ...state, script: contentResults.script, metadata: contentResults.metadata };
    
    // Save script.yaml & metadata.json
    store.save("content", "output", contentResults);
    fs.writeJsonSync(path.join(store.runDir, "metadata.json"), contentResults.metadata, { spaces: 2 });

    // 3. Media (TTS & Video Rendering)
    AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Media Rendering...");
    const media = new VisualDirector(store);
    const mediaResults = await media.run(state.script!);
    state = { ...state, ...mediaResults };
    
    // Save media artifacts are handled inside VisualDirector (audio/, video.mp4)
    store.save("media", "output", mediaResults);

    // 4. Audit (Strict Zero-Trust Quality Gate)
    AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Quality Audit...");
    const auditor = new AuditAgent(store);
    const auditResults = await auditor.run(state);
    state = { ...state, audit_results: auditResults };
    
    // Save audit/result.json
    fs.writeJsonSync(path.join(store.runDir, "audit", "result.json"), auditResults, { spaces: 2 });

    // Check Audit PASS/FAIL
    const hasCriticalFailure = Object.values(auditResults).some(r => r.passed === false && r.critical === true);
    if (hasCriticalFailure) {
        AgentLogger.error("SYSTEM", "WORKFLOW", "BLOCK", "Publish blocked by Audit failure.");
        state.status = "PUBLISH_BLOCKED";
        return state;
    }

    // 5. Publish (Upload to YouTube)
    AgentLogger.info("SYSTEM", "WORKFLOW", "STEP", "Starting Publication...");
    const publisher = new PublishAgent(store);
    const publishResults = await publisher.run(state);
    state = { ...state, publish_results: publishResults };
    
    // Save publish/receipt.json
    fs.writeJsonSync(path.join(store.runDir, "publish", "receipt.json"), publishResults, { spaces: 2 });

    state.status = "SUCCESS";
    return state;
}
