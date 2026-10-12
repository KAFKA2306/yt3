export interface TtsVoiceControls {
	speedScale?: number;
	pitchScale?: number;
	intonationScale?: number;
	volumeScale?: number;
	prePhonemeLength?: number;
	postPhonemeLength?: number;
	pauseLengthScale?: number;
	outputSamplingRate?: number;
	outputStereo?: boolean;
}

export interface TtsRequest {
	text: string;
	speakerId: number;
	voice?: TtsVoiceControls;
}

interface TtsAudioQueryResponse {
	[key: string]: unknown;
}

export interface TtsOrchestrationConfig {
	ttsUrl: string;
	speakers: Record<string, number>;
	timeout: {
		query: number;
		synthesis: number;
	};
}

export interface TtsSynthesisResult {
	audio: Buffer;
}

export class TtsOrchestrator {
	private ttsUrl: string;
	private speakers: Record<string, number>;
	private queryTimeout: number;
	private synthesisTimeout: number;

	constructor(config: TtsOrchestrationConfig) {
		this.ttsUrl = config.ttsUrl;
		this.speakers = config.speakers;
		this.queryTimeout = config.timeout.query;
		this.synthesisTimeout = config.timeout.synthesis;
	}

	async synthesize(request: TtsRequest): Promise<TtsSynthesisResult> {
		this.assertSpeakerId(request.speakerId);
		const queryResponse = await this.getAudioQuery(
			request.text,
			request.speakerId,
		);
		this.applyVoiceControls(queryResponse, request.voice);
		return {
			audio: await this.synthesizeAudio(queryResponse, request.speakerId),
		};
	}

	private applyVoiceControls(
		query: TtsAudioQueryResponse,
		voice?: TtsVoiceControls,
	): void {
		if (!voice) return;
		for (const [key, value] of Object.entries(voice)) {
			if (value !== undefined) query[key] = value;
		}
	}

	private async getAudioQuery(
		text: string,
		speakerId: number,
	): Promise<TtsAudioQueryResponse> {
		const response = await this.post(
			"/audio_query",
			{ text, speaker: String(speakerId) },
			this.queryTimeout,
		);
		return (await response.json()) as TtsAudioQueryResponse;
	}

	private async synthesizeAudio(
		queryData: TtsAudioQueryResponse,
		speakerId: number,
	): Promise<Buffer> {
		const response = await this.post(
			"/synthesis",
			{ speaker: String(speakerId) },
			this.synthesisTimeout,
			queryData,
		);
		return Buffer.from(await response.arrayBuffer());
	}

	private async post(
		endpoint: string,
		params: Record<string, string>,
		timeout: number,
		body?: TtsAudioQueryResponse,
	): Promise<Response> {
		const response = await fetch(
			`${this.ttsUrl}${endpoint}?${new URLSearchParams(params)}`,
			{
				method: "POST",
				headers: {
					Connection: "close",
					...(body && { "Content-Type": "application/json" }),
				},
				body: body && JSON.stringify(body),
				signal: AbortSignal.timeout(timeout),
			},
		);
		if (!response.ok) {
			throw new Error(
				`VOICEVOX ${endpoint} failed with HTTP ${response.status}`,
			);
		}
		return response;
	}

	private assertSpeakerId(speakerId: number): void {
		const validSpeakerIds = new Set(Object.values(this.speakers));
		if (!validSpeakerIds.has(speakerId)) {
			throw new Error(
				`CRITICAL: Unknown voice ID '${speakerId}' supplied to TTS synthesis.`,
			);
		}
	}

	isSpeakerValid(speakerName: string): boolean {
		return speakerName in this.speakers;
	}
}
