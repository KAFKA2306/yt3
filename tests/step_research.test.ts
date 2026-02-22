import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import "./setup.js";
import path from "node:path";
import fs from "fs-extra";
import { TrendScout } from "../src/agents/research.js";
import { AssetStore, ROOT } from "../src/core.js";

describe("TrendScout Step", () => {
  let store: AssetStore;
  let runId: string;
  const testRunDir = path.join(process.cwd(), "runs", "test-research-run");

  beforeAll(() => {
    runId = "test-research-run";
    fs.removeSync(testRunDir);
    store = new AssetStore(runId);
  });

  afterAll(() => {
    fs.removeSync(testRunDir);
  });

  it("should return valid research result", async () => {
    const agent = new TrendScout(store);

    spyOn(agent, "runLlm").mockImplementation(async (sys: string) => {
      // "グローバル・インテリジェンス・オフィサー" in sys identifies the deep dive call
      if (sys.includes("インテリジェンス")) {
        return {
          results: [
            {
              angle: "Angle",
              title_hook: "Title",
              key_questions: ["Q1"],
              news: [{ title: "News", url: "http://test.com", summary: "Sum" }],
            },
          ],
        } as any;
      }
      // Assume first call (Trend Scout / Editor-in-Chief)
      return {
        selected_topic: "Interest Rates",
        reason: "Crucial",
        search_query: "rates",
        angle: "The inverse relationship between rates and growth stocks",
        trends: [],
      } as any;
    });

    const result = await agent.run("macro_economy", 1);

    expect(result).toBeDefined();
    expect(result.director_data).toBeDefined();
    expect(result.director_data.angle).toBe(
      "The inverse relationship between rates and growth stocks",
    );
  });
});
