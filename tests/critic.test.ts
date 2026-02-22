import { describe, expect, it, spyOn } from "bun:test";
import path from "node:path";
import { CriticAgent } from "../src/agents/critic.js";
import { AssetStore, ROOT } from "../src/core.js";
import type { Script } from "../src/types.js";

// Mock the core runLlm logic since we don't want real API calls in unit tests
describe("CriticAgent", () => {
  const store = new AssetStore("test-run");
  const agent = new CriticAgent(store);

  const mockupScript: Script = {
    title: "Test Video",
    description: "Test Description",
    lines: [
      { speaker: "春日部つむぎ", text: "Hello", duration: 0 },
      { speaker: "ずんだもん", text: "Hi", duration: 0 },
    ],
    total_duration: 0,
  };

  it("should return a passing report for high scores", async () => {
    // Mock the LLM call to return a high score
    spyOn(agent, "runLlm").mockImplementation(() => {
      return Promise.resolve({ score: 95, critique: "Excellent script!" } as any);
    });

    const report = await agent.run(mockupScript);
    expect(report.score).toBe(95);
    expect(report.score).toBeGreaterThanOrEqual(80);
  });

  it("should return a failing report for low scores", async () => {
    // Reset and mock the LLM call to return a low score
    spyOn(agent, "runLlm").mockImplementation(() => {
      return Promise.resolve({ score: 40, critique: "Too short and boring." } as any);
    });

    const report = await agent.run(mockupScript);
    expect(report.score).toBe(40);
    expect(report.score).toBeLessThan(80);
  });
});
