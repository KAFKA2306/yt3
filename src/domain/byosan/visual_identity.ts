import { getByosanVisualSystem } from "../design/kafka_visual_system.js";

export type ByosanVisualIdentity = {
	background: string;
	textPrimary: string;
	textMuted: string;
	brandAccent: string;
	primaryAccent: string;
	secondaryAccent: string;
	warning: string;
};

type RequiredDesignTokens = {
	primary_brand_color: string;
	contrast_text_color: string;
	humanity_base_white: string;
	humanity_soft_sky: string;
	humanity_human_cream: string;
	humanity_evening_orange: string;
	humanity_gentle_blue: string;
	humanity_soft_gray: string;
	humanity_text_charcoal: string;
	humanity_accent_pink: string;
};

const REQUIRED_KEYS = [
	"primary_brand_color",
	"contrast_text_color",
	"humanity_base_white",
	"humanity_soft_sky",
	"humanity_human_cream",
	"humanity_evening_orange",
	"humanity_gentle_blue",
	"humanity_soft_gray",
	"humanity_text_charcoal",
	"humanity_accent_pink",
] as const;

function parseHex(value: string): void {
	if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
		throw new Error(`BYOSAN_VISUAL_IDENTITY_INVALID_HEX: ${value}`);
	}
}

function designTokens(input: unknown): RequiredDesignTokens {
	const root = input as Record<string, unknown> | null;
	const candidate =
		root && typeof root === "object" && root.design_tokens
			? root.design_tokens
			: input;
	if (!candidate || typeof candidate !== "object") {
		throw new Error("BYOSAN_VISUAL_IDENTITY_MISSING_DESIGN_TOKENS");
	}
	const tokens = candidate as Record<string, unknown>;
	for (const key of REQUIRED_KEYS) {
		if (typeof tokens[key] !== "string") {
			throw new Error(`BYOSAN_VISUAL_IDENTITY_MISSING_TOKEN: ${key}`);
		}
		parseHex(tokens[key] as string);
	}
	return tokens as RequiredDesignTokens;
}

export function resolveByosanVisualIdentity(
	input: unknown,
): ByosanVisualIdentity {
	designTokens(input);
	const colors = getByosanVisualSystem().colors;
	return {
		background: colors.background,
		textPrimary: colors.text_primary,
		textMuted: colors.text_muted,
		brandAccent: colors.brand_accent,
		primaryAccent: colors.accent_primary,
		secondaryAccent: colors.accent_secondary,
		warning: colors.warning,
	};
}
