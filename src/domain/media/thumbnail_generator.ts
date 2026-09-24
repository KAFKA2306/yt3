import path from "node:path";
import fs from "fs-extra";
import { AgentLogger } from "../../io/core.js";
import type { IqaValidator } from "../../io/utils/iqa_validator.js";
import { getKafkaVisualSystem } from "../design/kafka_visual_system.js";
import type { LayoutEngine } from "../layout/engine.js";
import type { RenderPlan } from "../types.js";

interface TrendInfo {
	data?: {
		recommended_palette?: {
			background_color: string;
			title_color: string;
		};
	};
}

export interface ThumbnailPalette {
	background_color?: string;
	background_image?: string;
	title_color: string;
}

export interface ThumbnailConfig {
	enabled: boolean;
	palettes?: ThumbnailPalette[];
}

export interface ThumbnailGenerationConfig {
	layout: LayoutEngine;
	validator: IqaValidator;
	config: ThumbnailConfig;
	mcpServers?: { context7?: unknown };
	agentName: string;
}

export class ThumbnailGenerator {
	private design = getKafkaVisualSystem();
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

	async generate(title: string, outputPath: string): Promise<string> {
		if (!this.config.enabled) {
			return "";
		}

		const palette = await this.resolvePalette();
		const plan = await this.layout.createThumbnailRenderPlan();

		AgentLogger.info(this.agentName, "RUN", "THUMB_AI", "Generating thumbnail");

		await this.layout.renderThumbnail(plan, title, outputPath);

		const validation = await this.validator.validate(
			outputPath,
			this.design.colors.text_primary,
			this.design.colors.background,
			title,
			this.design.thumbnail.title_zone.x +
				this.design.thumbnail.title_zone.width,
		);

		try {
			const runDir = path.dirname(outputPath);
			const auditDir = path.join(runDir, "audit");
			fs.ensureDirSync(auditDir);
			fs.writeJsonSync(path.join(auditDir, "iqa_report.json"), validation, {
				spaces: 2,
			});
		} catch {
			// Best-effort write
		}

		if (!validation.passed) {
			throw new Error(`Asset quality rejection: ${validation.reason}`);
		}

		AgentLogger.info(this.agentName, "RUN", "IQA_PASSED", "Thumbnail verified");

		return outputPath;
	}

	private async resolvePalette(): Promise<ThumbnailPalette> {
		const defaultPalette: ThumbnailPalette = {
			background_color: this.design.colors.background,
			title_color: this.design.colors.text_primary,
		};
		return defaultPalette;
	}
}
