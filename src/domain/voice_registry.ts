export type VoiceBucket =
	| "byosan_money"
	| "yawa_archive"
	| "humanity_observatory";

export const CANONICAL_VOICE_MAPS: Record<
	VoiceBucket,
	Record<string, number>
> = {
	byosan_money: {
		春日部つむぎ: 8,
		ずんだもん: 1,
		玄野: 11,
		玄野武宏: 11,
	},
	yawa_archive: {
		春日部つむぎ: 8,
		ずんだもん: 1,
		玄野: 11,
		玄野武宏: 11,
	},
	humanity_observatory: {
		雨晴はう: 10,
		もち子さん: 20,
	},
} as const;

export function getCanonicalVoiceMap(
	bucket?: string,
): Record<string, number> | null {
	if (!bucket) return null;
	return CANONICAL_VOICE_MAPS[bucket as VoiceBucket] || null;
}

export function compareVoiceMaps(
	expected: Record<string, number>,
	actual: Record<string, number>,
): {
	missing: string[];
	extra: string[];
	mismatches: string[];
} {
	const missing: string[] = [];
	const extra: string[] = [];
	const mismatches: string[] = [];

	for (const [speaker, expectedId] of Object.entries(expected)) {
		if (!(speaker in actual)) {
			missing.push(`${speaker}:${expectedId}`);
			continue;
		}
		if (actual[speaker] !== expectedId) {
			mismatches.push(
				`${speaker}: expected ${expectedId}, got ${actual[speaker]}`,
			);
		}
	}
	for (const [speaker, actualId] of Object.entries(actual)) {
		if (!(speaker in expected)) extra.push(`${speaker}:${actualId}`);
	}
	return { missing, extra, mismatches };
}
