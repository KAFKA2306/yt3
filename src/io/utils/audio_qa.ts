import { execSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";

export interface AudioQAResult {
	status: "PASS" | "QUALITY_FAIL" | "INFRA_FAIL";
	details: string;
	report: {
		integrated_loudness_lufs: number;
		true_peak_db: number;
		max_silence_duration_seconds: number;
		total_silence_duration_seconds: number;
		speech_rate_char_per_min: number;
		speech_rate_status: "optimal" | "too_fast" | "too_slow";
		final_decision: "PASS" | "FAIL";
	};
}

function getSubtitleCharCount(subtitlePath: string): number {
	if (!fs.existsSync(subtitlePath)) return 0;
	try {
		const content = fs.readFileSync(subtitlePath, "utf-8");
		const lines = content.split("\n");
		let totalChars = 0;
		for (const line of lines) {
			if (line.startsWith("Dialogue:")) {
				const parts = line.split(",");
				const text = parts.slice(9).join(",");
				const cleanText = text.replace(/\{[^}]+\}/g, "").trim();
				totalChars += cleanText.length;
			}
		}
		return totalChars;
	} catch {
		return 0;
	}
}

export function runAudioQA(videoPath: string, runDir: string): AudioQAResult {
	try {
		if (!fs.existsSync(videoPath)) {
			return {
				status: "INFRA_FAIL",
				details: `Video file not found at: ${videoPath}`,
				report: {
					integrated_loudness_lufs: 0,
					true_peak_db: 0,
					max_silence_duration_seconds: 0,
					total_silence_duration_seconds: 0,
					speech_rate_char_per_min: 0,
					speech_rate_status: "too_slow",
					final_decision: "FAIL",
				},
			};
		}

		const audioLog = execSync(
			`ffmpeg -nostats -i "${videoPath}" -af ebur128=peak=true -f null /dev/null 2>&1`,
			{ encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 },
		);
		const summaryPart = audioLog.split("Summary:")[1] || audioLog;
		const integratedLUFS = Number.parseFloat(
			summaryPart.match(/I:\s+([\-\d\.]+) LUFS/)?.[1] || "0",
		);
		const truePeak = Number.parseFloat(
			summaryPart.match(/Peak:\s+([\-\d\.]+) (dBTP|dBFS)/)?.[1] || "0",
		);

		const silenceLog = execSync(
			`ffmpeg -nostats -i "${videoPath}" -af silencedetect=n=-40dB:d=2.0 -f null /dev/null 2>&1`,
			{ encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 },
		);
		const silenceMatches = Array.from(
			silenceLog.matchAll(/silence_duration:\s+([\d\.]+)/g),
		);
		let maxSilence = 0;
		let totalSilence = 0;
		for (const match of silenceMatches) {
			const dur = Number.parseFloat(match[1] || "0");
			if (dur > maxSilence) maxSilence = dur;
			totalSilence += dur;
		}

		const durationLog = execSync(
			`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
			{ encoding: "utf-8" },
		);
		const durationSeconds = Number.parseFloat(durationLog.trim() || "0");

		const bucket = path.basename(path.dirname(runDir));
		let minOptimalRate = 220;
		let maxOptimalRate = 320;
		if (bucket === "byosan_money") {
			minOptimalRate = 260;
			maxOptimalRate = 380;
		} else if (bucket === "humanity_observatory") {
			minOptimalRate = 200;
			maxOptimalRate = 300;
		} else if (bucket === "yawa_archive") {
			minOptimalRate = 80;
			maxOptimalRate = 180;
		}

		const subtitlePath = path.join(runDir, "subtitles.ass");
		const charCount = getSubtitleCharCount(subtitlePath);
		const durationMinutes = durationSeconds / 60;
		const speechRateCharPerMin =
			durationMinutes > 0 ? Math.round(charCount / durationMinutes) : 0;

		let speechRateStatus: "optimal" | "too_fast" | "too_slow" = "optimal";
		if (speechRateCharPerMin < minOptimalRate) {
			speechRateStatus = "too_slow";
		} else if (speechRateCharPerMin > maxOptimalRate) {
			speechRateStatus = "too_fast";
		}

		const loudnessPass = integratedLUFS > -19 && integratedLUFS < -10;
		const peakPass = truePeak <= -0.5;
		const silencePass = bucket === "yawa_archive" || maxSilence <= 3.0;
		const ratePass =
			speechRateCharPerMin === 0 ||
			(speechRateCharPerMin >= 60 && speechRateCharPerMin <= 500);

		const finalPass = loudnessPass && peakPass && silencePass && ratePass;

		const result: AudioQAResult = {
			status: finalPass ? "PASS" : "QUALITY_FAIL",
			details: `LUFS: ${integratedLUFS} (${loudnessPass ? "OK" : "OUT OF RANGE"}), Peak: ${truePeak} dB (${peakPass ? "OK" : "CLIPPING RISK"}), Max Silence: ${maxSilence.toFixed(1)}s, Speech Rate: ${speechRateCharPerMin} CPM (${speechRateStatus})`,
			report: {
				integrated_loudness_lufs: integratedLUFS,
				true_peak_db: truePeak,
				max_silence_duration_seconds: maxSilence,
				total_silence_duration_seconds: totalSilence,
				speech_rate_char_per_min: speechRateCharPerMin,
				speech_rate_status: speechRateStatus,
				final_decision: finalPass ? "PASS" : "FAIL",
			},
		};

		const reportPath = path.join(runDir, "audit", "audio_quality_report.json");
		fs.ensureDirSync(path.dirname(reportPath));
		fs.writeJsonSync(reportPath, result.report, { spaces: 2 });

		return result;
	} catch (e) {
		return {
			status: "INFRA_FAIL",
			details: `Audio QA check infra crash: ${String(e)}`,
			report: {
				integrated_loudness_lufs: 0,
				true_peak_db: 0,
				max_silence_duration_seconds: 0,
				total_silence_duration_seconds: 0,
				speech_rate_char_per_min: 0,
				speech_rate_status: "too_slow",
				final_decision: "FAIL",
			},
		};
	}
}
