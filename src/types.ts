import { z } from "zod";

export enum RunStage {
  RESEARCH = "research",
  CONTENT = "content",
  MEDIA = "media",
  PUBLISH = "publish",
  WATCHER = "watcher",
  MEMORY = "memory",
}
export * from "./config_types.js";

export const NewsItemSchema = z.object({
  title: z.string(),
  summary: z.string(),
  url: z.string(),
  published_at: z.string().optional(),
  snippet: z.string().optional(),
  original_english_text: z.string().optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const ScriptLineSchema = z.object({
  speaker: z.string(),
  text: z.string(),
  duration: z.number().default(0.0),
});
export type ScriptLine = z.infer<typeof ScriptLineSchema>;

export const ScriptSchema = z.object({
  title: z.string(),
  description: z.string(),
  lines: z.array(ScriptLineSchema),
  total_duration: z.number().default(0.0),
});
export type Script = z.infer<typeof ScriptSchema>;

export const MetadataSchema = z.object({
  title: z.string(),
  thumbnail_title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
});
export type Metadata = z.infer<typeof MetadataSchema>;

export const ContentResultSchema = z.object({
  script: ScriptSchema,
  metadata: MetadataSchema,
});
export type ContentResult = z.infer<typeof ContentResultSchema>;

export const ContentLlmResponseSchema = z.object({
  script: z.object({
    title: z.string(),
    lines: z.array(z.object({ speaker: z.string(), text: z.string() })),
  }),
  metadata: MetadataSchema,
});
export type ContentLlmResponse = z.infer<typeof ContentLlmResponseSchema>;

export const DirectorDataSchema = z.object({
  angle: z.string(),
  title_hook: z.string(),
  search_query: z.string(),
  key_questions: z.array(z.string()),
});
export type DirectorData = z.infer<typeof DirectorDataSchema>;

// MetadataSchema moved up

export const PublishResultsSchema = z.object({
  youtube: z.object({ status: z.string(), video_id: z.string().optional() }).optional(),
  twitter: z.object({ status: z.string(), tweet_id: z.string().optional() }).optional(),
});
export type PublishResults = z.infer<typeof PublishResultsSchema>;

export const EvaluationReportSchema = z.object({
  score: z.number(),
  critique: z.string(),
  essence: z
    .object({
      topic: z.string(),
      key_insights: z.array(z.string()),
    })
    .optional(),
});
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;

export const ResearchLlmResponseSchema = z.object({
  director_data: z.object({
    angle: z.string(),
    title_hook: z.string(),
    key_questions: z.array(z.string()),
  }),
  news: z.array(NewsItemSchema),
});
export type ResearchLlmResponse = z.infer<typeof ResearchLlmResponseSchema>;

export const EditorSelectionSchema = z.object({
  selected_topic: z.string(),
  reason: z.string(),
  search_query: z.string(),
  angle: z.string(),
  trends: z.array(z.object({ region: z.string(), headline: z.string(), summary: z.string() })),
});
export type EditorSelection = z.infer<typeof EditorSelectionSchema>;

export const ResearchDeepDiveSchema = z.object({
  results: z.array(
    z.object({
      angle: z.string(),
      title_hook: z.string(),
      key_questions: z.array(z.string()),
      news: z.array(NewsItemSchema),
    }),
  ),
});
export type ResearchDeepDive = z.infer<typeof ResearchDeepDiveSchema>;

export const ContentOutlineSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      key_points: z.array(z.string()),
      estimated_duration: z.number(),
    }),
  ),
});
export type ContentOutline = z.infer<typeof ContentOutlineSchema>;

export const ContentSegmentSchema = z.object({
  lines: z.array(
    z.object({
      speaker: z.string(),
      text: z.string(),
    }),
  ),
});
export type ContentSegment = z.infer<typeof ContentSegmentSchema>;

export const AgentStateSchema = z.object({
  run_id: z.string(),
  bucket: z.string(),
  limit: z.number().optional(),
  news: z.array(NewsItemSchema).optional(),
  script: ScriptSchema.optional(),
  audio_paths: z.array(z.string()).optional(),
  video_path: z.string().optional(),
  thumbnail_path: z.string().optional(),
  status: z.string().optional(),
  director_data: DirectorDataSchema.optional(),
  metadata: MetadataSchema.optional(),
  publish_results: PublishResultsSchema.optional(),
  memory_context: z.string().optional(),
  evaluation: EvaluationReportSchema.optional(),
  retries: z.number().optional(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
