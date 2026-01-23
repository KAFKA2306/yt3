import { describe, it } from 'node:test';
import assert from 'node:assert';
import './setup.js'; // Ensure env vars are set
import path from 'path';
import { readYamlFile, cleanCodeBlock, parseLlmJson, loadConfig } from '../src/core.js';

describe('src/core.ts', () => {

    describe('cleanCodeBlock', () => {
        it('should remove markdown code blocks', () => {
            const input = '```json\n{"foo": "bar"}\n```';
            const expected = '{"foo": "bar"}';
            assert.strictEqual(cleanCodeBlock(input), expected);
        });

        it('should handle raw strings without code blocks', () => {
            const input = 'just a string';
            assert.strictEqual(cleanCodeBlock(input), input);
        });
    });

    describe('parseLlmJson', () => {
        it('should parse valid JSON from LLM output', () => {
            const input = '```json\n{"key": "value"}\n```';
            const result = parseLlmJson<{ key: string }>(input);
            assert.deepStrictEqual(result, { key: "value" });
        });
    });

    describe('loadConfig', () => {
        it('should load default config', () => {
            const config = loadConfig();
            assert.ok(config);
            assert.ok(config.steps);
        });

        it('should enforce dry_run when DRY_RUN env var is set (which is enforced by setup.ts)', () => {
            const config = loadConfig();
            // We assume setup.ts has run or environment is set
            assert.strictEqual(process.env.DRY_RUN, 'true');
            if (config.steps.youtube) {
                assert.strictEqual(config.steps.youtube.dry_run, true);
            }
        });
    });

    describe('readYamlFile', () => {
        it('should fail fast if file does not exist', () => {
            assert.throws(() => {
                readYamlFile('non_existent_file.yaml');
            });
        });
    });

});
