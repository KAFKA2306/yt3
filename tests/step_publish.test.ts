import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import "./setup.js";
import path from "node:path";
import fs from "fs-extra";
import { PublishAgent } from "../src/agents/publish.js";
import { AssetStore } from "../src/core.js";
import type { AgentState } from "../src/types.js";

describe("PublishAgent", () => {
  const testRunId = "test-publish-run";
  const testDir = path.join(process.cwd(), "runs", testRunId);
  let store: AssetStore;

  beforeAll(() => {
    // Enforce dry run for safety in tests
    process.env.DRY_RUN = "true";
    process.env.SKIP_LLM = "true";
    fs.removeSync(testDir);
    store = new AssetStore(testRunId);
  });

  afterAll(() => {
    fs.removeSync(testDir);
  });

  it("should respect dry_run configuration in youtube upload", async () => {
    const agent = new PublishAgent(store);
    // Ensure config is loaded with dry_run=true (enforced by setup.ts/env)

    const state: AgentState = {
      metadata: { title: "Test Video", description: "Test Desc", tags: ["test"] },
      video_path: "/tmp/fake_video.mp4",
      thumbnail_path: "/tmp/fake_thumb.jpg",
    };

    const result = await agent.run(state);

    expect(result.youtube).toBeDefined();
    expect(result.youtube.status).toBe("dry_run");
    expect(result.youtube.video_id).toBe("dry_run_id");
  });

  it("should respect dry_run configuration in twitter post", async () => {
    const agent = new PublishAgent(store);
    // FORCE ENABLE TWITTER for this test
    if (agent.config.steps.twitter) {
      agent.config.steps.twitter.enabled = true;
    } else {
      agent.config.steps.twitter = {
        enabled: true,
        dry_run: true,
        clip_duration_seconds: 60,
        start_offset_seconds: 0,
      };
    }

    const state: AgentState = {
      metadata: { title: "Test Video", description: "Test Desc", tags: ["test"] },
      video_path: "/tmp/fake_video.mp4",
    };

    const result = await agent.run(state);

    expect(result.twitter).toBeDefined();
    expect(result.twitter.status).toBe("dry_run");
    expect(result.twitter.tweet_id).toBe("dry_run_id");
  });

  it("should log input and output to store", async () => {
    const agent = new PublishAgent(store);
    const state: AgentState = {
      metadata: { title: "Logging Test" },
      video_path: "/tmp/fake.mp4",
    };

    await agent.run(state);

    const input = store.load<any>("publish", "input");
    expect(input.video_path).toBe("/tmp/fake.mp4");

    const output = store.load<any>("publish", "output");
    expect(output.youtube.status).toBe("dry_run");
  });
});
