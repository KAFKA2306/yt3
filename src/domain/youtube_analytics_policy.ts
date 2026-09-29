export const MAX_AUTHORIZATION_AGE_DAYS = 30;
const DAY_MS = 86_400_000;

export function analyticsAuthorizationCutoff(
	now: Date,
	maxAgeDays = MAX_AUTHORIZATION_AGE_DAYS,
): Date {
	if (!Number.isFinite(now.getTime())) {
		throw new Error(
			"Analytics authorization cutoff requires a valid current time",
		);
	}
	if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) {
		throw new Error(
			"Analytics authorization age must be a positive whole number of days",
		);
	}
	return new Date(now.getTime() - maxAgeDays * DAY_MS);
}
