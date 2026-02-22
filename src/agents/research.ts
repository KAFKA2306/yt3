import {
  type AssetStore,
  BaseAgent,
  RunStage,
  getCurrentDateString,
  loadConfig,
  loadMemoryContext,
  parseLlmJson,
} from "../core.js";
import {
  type EditorSelection,
  EditorSelectionSchema,
  type NewsItem,
  type ResearchDeepDive,
  ResearchDeepDiveSchema,
} from "../types.js";

export interface ResearchResult {
  director_data: {
    angle: string;
    title_hook: string;
    search_query: string;
    key_questions: string[];
  };
  news: NewsItem[];
  memory_context: string;
}

export class TrendScout extends BaseAgent {
  constructor(store: AssetStore) {
    const cfg = loadConfig();
    super(store, RunStage.RESEARCH, { temperature: cfg.steps.research?.temperature || 0.5 });
  }

  async run(bucket: string, limit?: number): Promise<ResearchResult> {
    const cached = this.store.load<ResearchResult>(this.name, "output");
    if (cached) return cached;

    const researchCfg = this.config.steps.research;
    if (!researchCfg) throw new Error("Research config missing");

    this.logInput({ bucket, limit: limit || researchCfg.default_limit || 3 });
    const essences = loadMemoryContext(this.store);
    const recent = ""; // Simplified for now

    const promptCfg = this.loadPrompt<{
      consolidated_trend_scout: { system: string; user_template: string };
      consolidated_deep_dive: { system: string; user_template: string };
    }>(this.name);

    const currentDate = getCurrentDateString();

    const selection = await this.runLlm<EditorSelection>(
      promptCfg.consolidated_trend_scout.system
        .replace("{regions}", researchCfg.regions.map((r: { lang: string }) => r.lang).join(", "))
        .replace("{current_date}", currentDate),
      promptCfg.consolidated_trend_scout.user_template
        .replace("{regions}", researchCfg.regions.map((r: { lang: string }) => r.lang).join(", "))
        .replace("{recent_topics}", recent)
        .replace("{current_date}", currentDate),
      (t) => parseLlmJson(t, EditorSelectionSchema),
      { extra: { tools: [{ googleSearchRetrieval: {} }] } },
    );

    const deepDive = await this.runLlm<ResearchDeepDive>(
      promptCfg.consolidated_deep_dive.system
        .replace("{angles}", researchCfg.angles.map((a: { name: string }) => a.name).join(", "))
        .replace("{current_date}", currentDate),
      promptCfg.consolidated_deep_dive.user_template
        .replace("{topic}", selection.selected_topic)
        .replace("{reason}", selection.reason)
        .replace("{angles}", researchCfg.angles.map((a: { name: string }) => a.name).join(", "))
        .replace("{current_date}", currentDate),
      (t) => parseLlmJson(t, ResearchDeepDiveSchema),
      { extra: { tools: [{ googleSearchRetrieval: {} }] } },
    );

    const result: ResearchResult = {
      director_data: {
        angle: selection.angle,
        title_hook: deepDive.results[0]?.title_hook || selection.selected_topic,
        search_query: selection.search_query,
        key_questions: deepDive.results
          .flatMap((r: { key_questions: string[] }) => r.key_questions)
          .slice(0, 5),
      },
      news: deepDive.results
        .flatMap((r: { news: NewsItem[] }) => r.news)
        .filter((n: NewsItem) => n?.title),
      memory_context: essences,
    };

    this.logOutput(result);
    return result;
  }
}
