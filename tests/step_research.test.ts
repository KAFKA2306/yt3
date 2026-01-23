import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert';
import './setup.js'; // Ensure env vars
import path from 'path';
import fs from 'fs-extra';
import { ResearchAgent } from '../src/agents/research.js';
import { AssetStore } from '../src/core.js';

// Enforce strict environment overrides for this test suite
process.env.SKIP_LLM = 'true';
process.env.DRY_RUN = 'true';

describe('ResearchAgent Step', () => {
    let store: AssetStore;
    let runId: string;
    const testRunDir = path.join(process.cwd(), 'runs', 'test-research-run');

    before(() => {
        runId = 'test-research-run';
        // Cleanup previous test run if exists
        fs.removeSync(testRunDir);
        store = new AssetStore(runId);

        // MOCK: Pre-load the expected "output" into the store
        // because SKIP_LLM=true causes the Agent to look for 'output.yaml' or similar in its store
        // OR we need to mock the `runLlm` method directly if we want to test parsing logic.
        // However, looking at BaseAgent.runLlm:
        // if (process.env.SKIP_LLM === "true") return this.store.load<T>(this.name, "output");

        // So we must seed the store with the expected "output" if we want SKIP_LLM to return it.
        // BUT, if we want to test the *logic* of the agent (e.g. prompt construction), verify it calls runLlm? 
        // With SKIP_LLM, it barely does anything logic-wise other than load from file.

        // To test robustly WITHOUT LLM but WITH logic:
        // We should probably spy/mock `runLlm` instead of relying on SKIP_LLM causing an early return,
        // OR we rely on `SKIP_LLM` but ensure the agent properly handles the data flow.

        // Let's seed the store to simulate a "cached" or "mocked" LLM response.
        const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'llm_research_response.json');
        const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

        // The ResearchAgent might look for specific file names. 
        // BaseAgent.runLlm calls this.store.load(this.name, "output")
        store.save('research', 'output', fixtureData);
    });

    after(() => {
        // clean up
        fs.removeSync(testRunDir);
    });

    it('should load research data from store (SKIP_LLM mode)', async () => {
        const agent = new ResearchAgent(store);

        // Mocking the input for run
        const topic = 'macro_economy';
        const limit = 2;

        // Execute
        // Since SKIP_LLM=true, this should basically just load the 'output' we saved in validation.
        const result = await agent.run(topic, limit);

        // Validation
        assert.ok(result);
        assert.ok(result.director_data, 'Result should contain director_data');
        assert.strictEqual(result.director_data.angle, "The inverse relationship between rates and growth stocks");

        const output = store.load<any>('research', 'output');
        assert.strictEqual(output.director_data.topic, "Impact of Interest Rates on Tech Stocks");
    });
});
