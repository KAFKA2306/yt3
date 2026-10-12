import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	type TtsOrchestrationConfig,
	TtsOrchestrator,
} from "../src/io/utils/tts_orchestrator.js";

type ReceivedRequest = {
	path: string;
	method: string;
	params: Record<string, string>;
	body: unknown;
};

const audioBytes = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 3]);
const audioQuery = { accent_phrases: [], speedScale: 1 };
const received: ReceivedRequest[] = [];

const server = Bun.serve({
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const rawBody = await request.text();
		const body = rawBody === "" ? null : JSON.parse(rawBody);
		received.push({
			path: url.pathname,
			method: request.method,
			params: Object.fromEntries(url.searchParams),
			body,
		});
		if (url.searchParams.get("text") === "fail") {
			return new Response("engine error", { status: 500 });
		}
		if (url.pathname === "/audio_query") return Response.json(audioQuery);
		if (url.pathname === "/synthesis") {
			return new Response(audioBytes, {
				headers: { "content-type": "audio/wav" },
			});
		}
		return new Response("not found", { status: 404 });
	},
});

const config: TtsOrchestrationConfig = {
	ttsUrl: `http://127.0.0.1:${server.port}`,
	speakers: { metan: 2, zundamon: 3 },
	timeout: { query: 5000, synthesis: 5000 },
};

describe("TtsOrchestrator VOICEVOX synthesis", () => {
	beforeAll(() => {
		received.length = 0;
	});

	afterAll(() => {
		server.stop(true);
	});

	test("posts the audio query and synthesis with speaker, text, and voice controls", async () => {
		const orchestrator = new TtsOrchestrator(config);
		const result = await orchestrator.synthesize({
			text: "こんにちは",
			speakerId: 3,
			voice: { speedScale: 1.2, volumeScale: undefined },
		});

		expect(Buffer.from(result.audio).equals(Buffer.from(audioBytes))).toBe(
			true,
		);
		expect(received).toEqual([
			{
				path: "/audio_query",
				method: "POST",
				params: { text: "こんにちは", speaker: "3" },
				body: null,
			},
			{
				path: "/synthesis",
				method: "POST",
				params: { speaker: "3" },
				body: { accent_phrases: [], speedScale: 1.2 },
			},
		]);
	});

	test("rejects an unknown speaker id before calling the engine", async () => {
		const orchestrator = new TtsOrchestrator(config);
		const before = received.length;

		await expect(
			orchestrator.synthesize({ text: "やあ", speakerId: 99 }),
		).rejects.toThrow("Unknown voice ID '99'");
		expect(received.length).toBe(before);
	});

	test("rejects when the engine responds with an HTTP error status", async () => {
		const orchestrator = new TtsOrchestrator(config);

		await expect(
			orchestrator.synthesize({ text: "fail", speakerId: 2 }),
		).rejects.toThrow();
	});

	test("reports whether a speaker name is configured", () => {
		const orchestrator = new TtsOrchestrator(config);

		expect(orchestrator.isSpeakerValid("metan")).toBe(true);
		expect(orchestrator.isSpeakerValid("unknown")).toBe(false);
	});
});
