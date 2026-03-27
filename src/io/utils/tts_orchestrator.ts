import axios from "axios";
import type { AxiosInstance } from "axios";

interface TtsRequest {
	text: string;
	speaker: number;
}

interface TtsAudioQueryResponse {
	// Voicevox audio_query response structure
	[key: string]: unknown;
}

export interface TtsOrchestrationConfig {
	ttsUrl: string;
	speakers: Record<string, number>;
	defaultSpeaker: number;
	timeout: {
		query: number;
		synthesis: number;
	};
}

export class TtsOrchestrator {
	private ttsUrl: string;
	private speakers: Record<string, number>;
	private defaultSpeaker: number;
	private queryTimeout: number;
	private synthesisTimeout: number;
	private axiosInstance: AxiosInstance;

	constructor(config: TtsOrchestrationConfig) {
		this.ttsUrl = config.ttsUrl;
		this.speakers = config.speakers;
		this.defaultSpeaker = config.defaultSpeaker;
		this.queryTimeout = config.timeout.query;
		this.synthesisTimeout = config.timeout.synthesis;
		this.axiosInstance = axios.create({
			headers: {
				Connection: "close",
			},
		});
	}

	async synthesize(request: TtsRequest): Promise<Buffer> {
		const speakerId = this.resolveSpeakerId(request.speaker);
		const queryResponse = await this.getAudioQuery(
			request.text,
			speakerId,
		);
		const synthesisBuffer = await this.synthesizeAudio(
			queryResponse,
			speakerId,
		);
		return synthesisBuffer;
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

	private resolveSpeakerId(speaker: number): number {
		return speaker !== undefined && speaker in this.speakers
			? speaker
			: this.defaultSpeaker;
	}

	isSpeakerValid(speakerName: string): boolean {
		return speakerName in this.speakers;
	}
}
