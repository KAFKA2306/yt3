import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import './setup.js';
import path from 'path';
import fs from 'fs-extra';
import { AssetStore } from '../src/core.js';

describe('AssetStore', () => {
    const testRunId = 'test-store-run';
    const testDir = path.join(process.cwd(), 'runs', testRunId);

    before(() => {
        fs.removeSync(testDir);
    });

    after(() => {
        fs.removeSync(testDir);
    });

    it('should initialize and create run directory', () => {
        const store = new AssetStore(testRunId);
        assert.ok(fs.existsSync(testDir));
        assert.ok(fs.existsSync(path.join(testDir)));
    });

    it('should save and load yaml data', () => {
        const store = new AssetStore(testRunId);
        const data = { foo: 'bar', num: 123 };

        store.save('test_stage', 'data', data);

        const loaded = store.load<typeof data>('test_stage', 'data');
        assert.deepStrictEqual(loaded, data);

        const filePath = path.join(testDir, 'test_stage', 'data.yaml');
        assert.ok(fs.existsSync(filePath));
    });

    it('should update and load state', () => {
        const store = new AssetStore(testRunId);

        store.updateState({ workingOn: 'something' });
        let state = store.loadState();
        assert.strictEqual(state.workingOn, 'something');

        store.updateState({ workingOn: 'something else', step: 'publish' });
        state = store.loadState();
        assert.strictEqual(state.workingOn, 'something else');
        assert.strictEqual(state.step, 'publish');
    });

    it('should create audio and video directories', () => {
        const store = new AssetStore(testRunId);
        const audioDir = store.audioDir();
        const videoDir = store.videoDir();

        assert.ok(fs.existsSync(audioDir));
        assert.strictEqual(audioDir, path.join(testDir, 'audio'));

        assert.ok(fs.existsSync(videoDir));
        assert.strictEqual(videoDir, path.join(testDir, 'video'));
    });
});
