import type { LayoutEngine, RenderPlan } from "../layout_engine.js";
import { IqaValidator } from "../../io/utils/iqa_validator.js";
import { AgentLogger, runMcpTool } from "../../io/core.js";

interface TrendInfo {
	data?: {
		recommended_palette?: {
			background_color: string;
			title_color: string;
		};
	};
}

export interface ThumbnailPalette {
	background_color: string;
	title_color: string;
}

export interface ThumbnailConfig {
	enabled: boolean;
	palettes?: ThumbnailPalette[];
	right_guard_band_px?: number;
}

export interface ThumbnailGenerationConfig {
	layout: LayoutEngine;
	validator: IqaValidator;
	config: ThumbnailConfig;
	mcpServers?: { context7?: unknown };
	agentName: string;
}

export class ThumbnailGenerator {
	private layout: LayoutEngine;
	private validator: IqaValidator;
	private config: ThumbnailConfig;
	private mcpServers?: { context7?: unknown };
	private agentName: string;

	constructor(cfg: ThumbnailGenerationConfig) {
		this.layout = cfg.layout;
		this.validator = cfg.validator;
		this.config = cfg.config;
		this.mcpServers = cfg.mcpServers;
		this.agentName = cfg.agentName;
	}

	async generate(
		title: string,
		outputPath: string,
	): Promise<string> {
		if (!this.config.enabled) {
			return "";
		}

		const palette = await this.resolvePalette();
		const plan = await this.layout.createThumbnailRenderPlan();

		AgentLogger.info(
			this.agentName,
			"RUN",
			"THUMB_AI",
			"Generating thumbnail",
		);

		await this.layout.renderThumbnail(plan, title, outputPath);

		const validation = await this.validator.validate(
			outputPath,
			palette.title_color || "#FFFFFF",
			palette.background_color || "#000000",
			title,
			this.config.right_guard_band_px ?? 850,
		);

		if (!validation.passed) {
			throw new Error(
				`Asset quality rejection: ${validation.reason}`,
			);
		}

		AgentLogger.info(
			this.agentName,
			"RUN",
			"IQA_PASSED",
			"Thumbnail verified",
		);

		return outputPath;
	}

	private async resolvePalette(): Promise<ThumbnailPalette> {
		const defaultPalette: ThumbnailPalette =
			this.config.palettes?.[0] || {
				background_color: "#000000",
				title_color: "#FFFFFF",
			};

		if (!this.mcpServers?.context7) {
			return defaultPalette;
		}

		const trendInfo = (await runMcpTool(
			"context7",
			this.mcpServers.context7,
			"get_finance_color_trends",
			{ year: 2026 },
		)) as TrendInfo;

		if (!trendInfo?.data?.recommended_palette) {
			return defaultPalette;
		}

		AgentLogger.info(
			this.agentName,
			"RUN",
			"MCP_TREND",
			"Overriding palette with 2026 CTR trends",
		);

		return {
			...defaultPalette,
			background_color:
				trendInfo.data.recommended_palette.background_color ||
				"#103766",
			title_color:
				trendInfo.data.recommended_palette.title_color ||
				"#FFFFFF",
		};
	}
}
