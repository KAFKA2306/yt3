export type ByosanVisualIdentity = {
	background: string;
	backgroundAlt: string;
	surface: string;
	surfaceStrong: string;
	lightSurface: string;
	textPrimary: string;
	textSecondary: string;
	textMuted: string;
	darkText: string;
	primaryAccent: string;
	secondaryAccent: string;
	warning: string;
	grid: string;
	shadow: string;
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

function parseHex(value: string): [number, number, number] {
	if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
		throw new Error(`BYOSAN_VISUAL_IDENTITY_INVALID_HEX: ${value}`);
	}
	return [
		Number.parseInt(value.slice(1, 3), 16),
		Number.parseInt(value.slice(3, 5), 16),
		Number.parseInt(value.slice(5, 7), 16),
	];
}

function toHex(value: number): string {
	return Math.round(Math.max(0, Math.min(255, value)))
		.toString(16)
		.padStart(2, "0")
		.toUpperCase();
}

export function mixHex(
	left: string,
	right: string,
	rightWeight: number,
): string {
	if (rightWeight < 0 || rightWeight > 1) {
		throw new Error(`BYOSAN_VISUAL_IDENTITY_INVALID_WEIGHT: ${rightWeight}`);
	}
	const a = parseHex(left);
	const b = parseHex(right);
	const leftWeight = 1 - rightWeight;
	const mixed = [
		a[0] * leftWeight + b[0] * rightWeight,
		a[1] * leftWeight + b[1] * rightWeight,
		a[2] * leftWeight + b[2] * rightWeight,
	];
	return `#${mixed.map(toHex).join("")}`;
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
	const colors = getKafkaVisualSystem().colors;
	return {
		background: colors.background,
		backgroundAlt: colors.background_alt,
		surface: colors.surface,
		surfaceStrong: colors.surface_strong,
		lightSurface: colors.human_cream,
		textPrimary: colors.text_primary,
		textSecondary: colors.text_secondary,
		textMuted: colors.text_muted,
		darkText: colors.text_dark,
		primaryAccent: colors.accent_primary,
		secondaryAccent: colors.accent_secondary,
		warning: colors.warning,
		grid: colors.grid,
		shadow: colors.shadow,
	};
}
import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
