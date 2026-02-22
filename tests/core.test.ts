import { describe, expect, it } from "bun:test";
import "./setup.js"; // Ensure env vars are set
import path from "node:path";
import { cleanCodeBlock, loadConfig, parseLlmJson, readYamlFile } from "../src/core.js";

describe("src/core.ts", () => {
  describe("cleanCodeBlock", () => {
    it("should remove markdown code blocks", () => {
      const input = '```json\n{"foo": "bar"}\n```';
      const expected = '{"foo": "bar"}';
      expect(cleanCodeBlock(input)).toBe(expected);
    });

    it("should handle raw strings without code blocks", () => {
      const input = "just a string";
      expect(cleanCodeBlock(input)).toBe(input);
    });
  });

  describe("parseLlmJson", () => {
    it("should parse valid JSON from LLM output", () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = parseLlmJson<{ key: string }>(input);
      expect(result).toEqual({ key: "value" });
    });
  });

  describe("loadConfig", () => {
    it("should load default config", () => {
      const config = loadConfig();
      expect(config).toBeDefined();
      expect(config.steps).toBeDefined();
    });

    it("should enforce dry_run when DRY_RUN env var is set (which is enforced by setup.ts)", () => {
      const config = loadConfig();
      // We assume setup.ts has run or environment is set
      expect(process.env.DRY_RUN).toBe("true");
      if (config.steps.youtube) {
        expect(config.steps.youtube.dry_run).toBe(true);
      }
    });
  });

  describe("readYamlFile", () => {
    it("should fail fast if file does not exist", () => {
      expect(() => {
        readYamlFile("non_existent_file.yaml");
      }).toThrow();
    });
  });
});
