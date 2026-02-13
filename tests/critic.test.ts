import { test, describe, it, mock } from "node:test";
import assert from "node:assert";
import path from "path";
import { AssetStore, ROOT } from "../src/core.js";
import { CriticAgent } from "../src/agents/critic.js";
import { Script } from "../src/types.js";

// Mock the core runLlm logic since we don't want real API calls in unit tests
describe("CriticAgent", () => {
    const store = new AssetStore("test-run");
    const agent = new CriticAgent(store);

    const mockupScript: Script = {
        title: "Test Video",
        description: "Test Description",
        lines: [
            { speaker: "春日部つむぎ", text: "Hello", duration: 0 },
            { speaker: "ずんだもん", text: "Hi", duration: 0 }
        ],
        total_duration: 0
    };

    it("should return a passing report for high scores", async () => {
        // Mock the LLM call to return a high score
        mock.method(agent, "runLlm", () => {
            return Promise.resolve({ score: 95, critique: "Excellent script!" });
        });

        const report = await agent.run(mockupScript);
        assert.strictEqual(report.score, 95);
        assert.ok(report.score >= 80, "Score should be passing");
    });

    it("should return a failing report for low scores", async () => {
        // Reset and mock the LLM call to return a low score
        mock.method(agent, "runLlm", () => {
            return Promise.resolve({ score: 40, critique: "Too short and boring." });
        });

        const report = await agent.run(mockupScript);
        assert.strictEqual(report.score, 40);
        assert.ok(report.score < 80, "Score should be failing");
    });
});
