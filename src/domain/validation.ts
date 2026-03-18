import { z } from "zod";

export const queryValidationSchema = z
	.string()
	.min(1, "Query cannot be empty")
	.max(200, "Query must be at most 200 characters")
	.regex(
		/^[a-zA-Z0-9\s&\-:'".,!?()]+$/,
		"Query contains invalid characters. Only alphanumeric, spaces, and basic punctuation (&, -, :, ', \", ., !, ?, (, )) are allowed",
	)
	.refine((val) => {
		const dangerousPatterns = [
			/[;&|`$()[\]{}<>\\]/,
			/&&/,
			/\|\|/,
			/>/,
			/</,
			/`/,
			/\$/,
			/\\/,
		];
		return !dangerousPatterns.some((pattern) => pattern.test(val));
	}, "Query contains dangerous shell characters");

export type ValidatedQuery = z.infer<typeof queryValidationSchema>;

export function validateQuery(input: string): ValidatedQuery {
	return queryValidationSchema.parse(input);
}

export function validateQuerySafe(input: string): {
	success: boolean;
	data?: ValidatedQuery;
	error?: string;
} {
	const result = queryValidationSchema.safeParse(input);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return {
		success: false,
		error: result.error.issues[0]?.message || "Invalid query",
	};
}

export const credentialSchema = z.object({
	youtube: z
		.object({
			clientId: z.string().min(1, "YOUTUBE_CLIENT_ID is required"),
			clientSecret: z.string().min(1, "YOUTUBE_CLIENT_SECRET is required"),
			refreshToken: z.string().optional(),
		})
		.optional(),
	twitter: z
		.object({
			apiKey: z.string().min(1, "X_API_KEY or TWITTER_API_KEY is required"),
			apiSecret: z
				.string()
				.min(1, "X_API_SECRET or TWITTER_API_SECRET is required"),
			accessToken: z
				.string()
				.min(1, "X_ACCESS_TOKEN or TWITTER_ACCESS_TOKEN is required"),
			accessSecret: z
				.string()
				.min(1, "X_ACCESS_SECRET or TWITTER_ACCESS_TOKEN_SECRET is required"),
		})
		.optional(),
});

export function validateCredentials(enabledProviders: {
	youtube?: boolean;
	twitter?: boolean;
}) {
	const credentials: Record<
		string,
		Record<string, string | undefined> | undefined
	> = {};

	if (enabledProviders.youtube) {
		credentials.youtube = {
			clientId: process.env.YOUTUBE_CLIENT_ID,
			clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
			refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
		};
	}

	if (enabledProviders.twitter) {
		credentials.twitter = {
			apiKey: process.env.X_API_KEY || process.env.TWITTER_API_KEY,
			apiSecret: process.env.X_API_SECRET || process.env.TWITTER_API_SECRET,
			accessToken:
				process.env.X_ACCESS_TOKEN || process.env.TWITTER_ACCESS_TOKEN,
			accessSecret:
				process.env.X_ACCESS_SECRET || process.env.TWITTER_ACCESS_TOKEN_SECRET,
		};
	}

	const result = credentialSchema.safeParse(credentials);
	if (!result.success) {
		const errors = result.error.issues
			.map((e) => `${e.path.join(".")}: ${e.message}`)
			.join(", ");
		console.error(`[Security] Credential validation failed: ${errors}`);
		throw new Error(
			"Configuration error: required credentials are not properly set",
		);
	}

	return result.data;
}
