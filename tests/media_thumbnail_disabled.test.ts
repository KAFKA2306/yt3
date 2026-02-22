import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";

// MOCK FLUENT-FFMPEG BEFORE IMPORTING AGENT
mock.module("fluent-ffmpeg", () => {
  const mockFfmpeg = () => ({
    input: () => mockFfmpeg(),
    on: (event: string, cb: any) => {
      if (event === "end") setTimeout(cb, 0);
      return mockFfmpeg();
    },
    mergeToFile: (path: string, tmp: string) => {},
    inputFormat: () => mockFfmpeg(),
    complexFilter: () => mockFfmpeg(),
    outputOptions: () => mockFfmpeg(),
    save: (path: string) => {
      const m = mockFfmpeg();
      // @ts-ignore
      m.on("end", () => {});
      return m;
    },
  });
  return {
    default: mockFfmpeg,
    setFfmpegPath: () => {},
    setFfprobePath: () => {},
    ffprobe: (p: any, cb: any) => cb(null, { format: { duration: 1.0 } }),
  };
});

import "./setup.js";
import path from "node:path";
// @ts-ignore
import axios from "axios";
import fs from "fs-extra";
import { VisualDirector } from "../src/agents/media.js";
import { AssetStore } from "../src/core.js";

describe("VisualDirector Thumbnail Disabled", () => {
  let store: AssetStore;
  let runId: string;
  const testRunDir = path.join(process.cwd(), "runs", "test-media-disabled");

  // Tiny valid WAV (PCM 16bit mono 8000Hz, 1 sample)
  const DUMMY_WAV = Buffer.from(
    "UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA",
    "base64",
  );

  beforeAll(() => {
    runId = "test-media-disabled";
    fs.removeSync(testRunDir);
    store = new AssetStore(runId);
  });

  afterAll(() => {
    fs.removeSync(testRunDir);
  });

  it("should GENERATE thumbnail but NOT use it in video overlay if disabled in video config", async () => {
    const agent = new VisualDirector(store);

    // ENABLE THUMBNAIL GENERATION
    agent.thumbConfig.enabled = true;
    // DISABLE VIDEO OVERLAY
    agent.videoConfig.thumbnail_overlay = { enabled: false };

    // Fix speaker mapping for test
    agent.speakers = { TestSpeaker: 1 };

    // Mock dependencies
    const renderThumbnailMock = mock(async (plan: any, title: any, outPath: any) => {
      const tinyPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      );
      fs.writeFileSync(outPath, tinyPng);
    });
    agent.layout.renderThumbnail = renderThumbnailMock as any;

    agent.validator.validate = mock(async () => {
      return {
        passed: true,
        score: 1.0,
        metrics: {
          sharpness: 150,
          contrastRatio: 10,
          isResolutionCorrect: true,
          cognitiveRecognitionScore: 1.0,
          xHeightLegibilityScore: 0.95,
        },
      } as any;
    }) as any;

    // Mock generateVideo
    const generateVideoMock = mock(async () => {
      return;
    });
    // @ts-ignore
    agent.generateVideo = generateVideoMock;

    // Mock getAudioDuration
    // @ts-ignore
    agent.getAudioDuration = async () => 1.0;

    // Mock axios
    const axiosPostMock = spyOn(axios, "post").mockImplementation(async (url: string) => {
      if (url?.includes("synthesis")) {
        return { data: DUMMY_WAV };
      }
      return { data: {} };
    });

    const script = {
      title: "Test Video",
      description: "Test",
      lines: [{ speaker: "TestSpeaker", text: "Hello", duration: 1 }],
      total_duration: 1,
    };

    try {
      // Run
      await agent.run(script, "Test Title");

      // Verify 1: Thumbnail generation MUST happen
      expect(renderThumbnailMock).toHaveBeenCalled();

      // Verify 2: generateVideo receives the path
      expect(generateVideoMock).toHaveBeenCalledTimes(1);
      const args = generateVideoMock.mock.calls[0];
      const thumbPathArg = args[1];
      expect(typeof thumbPathArg).toBe("string");
      expect(thumbPathArg.endsWith("thumbnail.png")).toBe(true);

      // Verify 3: Config is set correctly to disable overlay
      expect(agent.videoConfig.thumbnail_overlay?.enabled).toBe(false);
    } finally {
      axiosPostMock.mockRestore();
    }
  });
});
