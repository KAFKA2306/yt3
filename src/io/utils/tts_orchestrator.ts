import axios from "axios";
import type { AxiosInstance } from "axios";

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

export class TtsOrchestrator {
	private ttsUrl: string;
	private speakers: Record<string, number>;
	private queryTimeout: number;
	private synthesisTimeout: number;
	private axiosInstance: AxiosInstance;

	constructor(config: TtsOrchestrationConfig) {
		this.ttsUrl = config.ttsUrl;
		this.speakers = config.speakers;
		this.queryTimeout = config.timeout.query;
		this.synthesisTimeout = config.timeout.synthesis;
		this.axiosInstance = axios.create({
			headers: {
				Connection: "close",
			},
		});
	}

	async synthesize(request: TtsRequest): Promise<Buffer> {
		this.assertSpeakerId(request.speakerId);
		const queryResponse = await this.getAudioQuery(
			request.text,
			request.speakerId,
		);
		this.applyVoiceControls(queryResponse, request.voice);
		return this.synthesizeAudio(queryResponse, request.speakerId);
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
		const response = await this.axiosInstance.post(
			`${this.ttsUrl}/audio_query`,
			null,
			{
				params: { text, speaker: speakerId },
				timeout: this.queryTimeout,
			},
		);
		return response.data as TtsAudioQueryResponse;
	}

	private async synthesizeAudio(
		queryData: TtsAudioQueryResponse,
		speakerId: number,
	): Promise<Buffer> {
		const response = await this.axiosInstance.post(
			`${this.ttsUrl}/synthesis`,
			queryData,
			{
				params: { speaker: speakerId },
				responseType: "arraybuffer",
				timeout: this.synthesisTimeout,
			},
		);
		return Buffer.from(response.data as ArrayBuffer);
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
