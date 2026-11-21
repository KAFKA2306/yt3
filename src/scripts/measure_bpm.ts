import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";

const SAMPLE_RATE = 8000;
const HOP_SIZE = 160; // 20ms frames -> 50 Hz envelope
const ENV_RATE = SAMPLE_RATE / HOP_SIZE; // 50 frames/sec

export type BpmMeasurement = {
	file: string;
	duration_seconds: number;
	bpm: number;
	four_on_the_floor_score: number;
	is_four_on_the_floor: boolean;
	rms_db: number;
};

function decodeLowEndMonoPcm(filePath: string): Float32Array {
	// Low-pass at 180Hz to isolate kick/bass pulse for 4-on-the-floor & tempo estimation.
	const res = spawnSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-i",
			filePath,
			"-ac",
			"1",
			"-ar",
			String(SAMPLE_RATE),
			"-af",
			"lowpass=f=180",
			"-f",
			"f32le",
			"pipe:1",
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	if (res.status !== 0 || !res.stdout || res.stdout.length < 4096) {
		throw new Error(
			`ffmpeg decode failed for ${filePath}: ${res.stderr?.toString("utf8") ?? "unknown error"}`,
		);
	}
	const buf = res.stdout;
	return new Float32Array(
		buf.buffer,
		buf.byteOffset,
		Math.floor(buf.byteLength / 4),
	);
}

export function measureAudioBpm(filePath: string): BpmMeasurement {
	const samples = decodeLowEndMonoPcm(filePath);
	const durationSeconds = samples.length / SAMPLE_RATE;

	// RMS energy envelope per 20ms frame
	const frameCount = Math.floor(samples.length / HOP_SIZE);
	const energy = new Float32Array(frameCount);
	let totalSq = 0;
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i] ?? 0;
		totalSq += s * s;
	}
	const rms = Math.sqrt(totalSq / Math.max(1, samples.length));
	const rmsDb = Number((20 * Math.log10(Math.max(rms, 1e-9))).toFixed(2));

	for (let f = 0; f < frameCount; f++) {
		let sum = 0;
		const start = f * HOP_SIZE;
		for (let j = 0; j < HOP_SIZE; j++) {
			const s = samples[start + j] ?? 0;
			sum += s * s;
		}
		energy[f] = Math.sqrt(sum / HOP_SIZE);
	}

	// Half-wave rectified onset strength
	const onset = new Float32Array(frameCount);
	for (let f = 1; f < frameCount; f++) {
		const diff = (energy[f] ?? 0) - (energy[f - 1] ?? 0);
		onset[f] = diff > 0 ? diff : 0;
	}

	// Autocorrelation over 65..185 BPM
	const minBpm = 65;
	const maxBpm = 185;
	const minLag = Math.max(1, Math.floor((60 / maxBpm) * ENV_RATE));
	const maxLag = Math.min(
		Math.floor(frameCount / 3),
		Math.ceil((60 / minBpm) * ENV_RATE),
	);

	let zeroLag = 0;
	for (let i = 0; i < frameCount; i++) {
		const v = onset[i] ?? 0;
		zeroLag += v * v;
	}
	zeroLag = Math.max(zeroLag, 1e-9);

	let bestLag = minLag;
	let bestScore = -1;
	const scores = new Map<number, number>();

	for (let lag = minLag; lag <= maxLag; lag++) {
		let corr = 0;
		for (let i = 0; i < frameCount - lag; i++) {
			corr += (onset[i] ?? 0) * (onset[i + lag] ?? 0);
		}
		const norm = corr / zeroLag;
		scores.set(lag, norm);
		if (norm > bestScore) {
			bestScore = norm;
			bestLag = lag;
		}
	}

	// Check octave (2x tempo) for 4-on-the-floor dance tracks where half-time lag can tie
	const halfLag = Math.round(bestLag / 2);
	const halfScore = scores.get(halfLag) ?? 0;
	if (halfLag >= minLag && halfScore >= bestScore * 0.85) {
		bestLag = halfLag;
		bestScore = halfScore;
	}

	const bpm = Number(((60 * ENV_RATE) / bestLag).toFixed(1));
	// 4-on-the-floor regularity: average normalized correlation at 1x, 2x, 4x beat lags
	const s1 = scores.get(bestLag) ?? 0;
	const s2 = scores.get(bestLag * 2) ?? s1;
	const s4 = scores.get(bestLag * 4) ?? s2;
	const fourOnTheFloorScore = Number(
		Math.min(1, ((s1 + s2 + s4) / 3) * 2.2).toFixed(3),
	);
	const isFourOnTheFloor = fourOnTheFloorScore >= 0.45 && bpm >= 110;

	return {
		file: path.resolve(filePath),
		duration_seconds: Number(durationSeconds.toFixed(2)),
		bpm,
		four_on_the_floor_score: fourOnTheFloorScore,
		is_four_on_the_floor: isFourOnTheFloor,
		rms_db: rmsDb,
	};
}

if (import.meta.main) {
	const target = process.argv[2];
	if (!target || !fs.existsSync(target)) {
		console.error(
			"Usage: bun src/scripts/measure_bpm.ts <audio-or-video-file>",
		);
		process.exit(2);
	}
	const result = measureAudioBpm(target);
	console.log(JSON.stringify(result, null, 2));
}
