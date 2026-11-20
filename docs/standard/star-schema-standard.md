---
type: "reference"
title: "Star Schema & dbt Standard"
description: "db/evolution.db から analytics/ dbt プロジェクトへ至る Raw・Staging・Marts の粒度、キー、KPI 定義、データテスト基準。"
tags:
  - yt3/standard
  - yt3/data
  - yt3/dbt
aliases:
  - "スタースキーマ標準"
  - "dbt分析設計"
  - "star-schema-standard"
generated:
  by: "antigravity/gemini-4-neon-high"
  at: "2026-11-20T00:25:00Z"
---

# Star Schema & dbt Standard

## Status

- **Implemented (P1 Analytics Marts via dbt)**: `analytics/` is a runnable dbt project (`dbt-core` + `dbt-duckdb`) that attaches `db/evolution.db` read-only via DuckDB SQLite extension, declares `sources`, normalizes `staging` models, builds `marts` (`dim_channel`, `fact_video_performance`, `fact_reach_daily`, `mart_channel_growth_kpi`), and runs automated data tests via `task analytics:build`.
- **Planned (P2–P3 Operational Actions)**: Routing all run/publish mutations through transactional action wrappers (`prepare_run`, `publish`, `schedule`) remains a staged design target. Current product runs still write directly to `runs/<profile>/<run-id>/` as indexed in [Repository Record Index](ledger-standard.md).

## Purpose

Represent YT3's three channels (`byosan`, `yawa`, `humanity`) and their YouTube Analytics / Reporting measurements in one reproducible star schema so that channel growth and YPP monetization decisions rely on consistent grains, explicit units, and API-measured evidence.

## Implemented dbt Architecture (`analytics/`)

Run locally with:

```bash
task analytics:build
```

Output DuckDB catalog: `data/analytics/yt3_analytics.duckdb` (gitignored, deterministically rebuilt from `db/evolution.db` and `analytics/seeds/channel_profiles.csv`).

### 1. Raw layer (`sources` in `analytics/models/staging/_sources.yml`)

Read-only SQLite tables in `db/evolution.db` (`db/schema.sql`), populated by `task analytics:refresh` (`src/scripts/refresh_youtube_analytics.ts`) and `task analytics:reach`:

- `youtube_analytics`: raw video metrics by `(video_id, age_window)`
- `youtube_analytics_traffic_sources`: traffic breakdown by `(video_id, age_window, traffic_source_type)`
- `youtube_analytics_reach_daily`: daily thumbnail impressions & CTR by `(channel_id, report_date, video_id)`
- `youtube_analytics_reach_reports`: Reporting API ingestion receipts by `report_id`

### 2. Staging layer (`analytics/models/staging/`)

Each staging model reads one `source()` without changing row grain or introducing business KPIs:

| Model | Grain (Primary Key) | Units & Null Handling | Source |
| --- | --- | --- | --- |
| `stg_youtube_analytics` | 1 row per `(video_id, age_window)` | `watch_time_minutes` (min), `average_view_duration_seconds` (sec), `average_view_percentage` (0–100%), `NULL` preserved when unmeasured | `source('yt3_raw', 'youtube_analytics')` |
| `stg_youtube_reach_daily` | 1 row per `(channel_id, report_date, video_id)` | `thumbnail_impressions` (count), `thumbnail_impressions_ctr` (ratio 0–1) | `source('yt3_raw', 'youtube_analytics_reach_daily')` |
| `stg_youtube_traffic_sources` | 1 row per `(video_id, age_window, traffic_source_type)` | `views` (count), `watch_time_minutes` (min) | `source('yt3_raw', 'youtube_analytics_traffic_sources')` |

### 3. Marts layer (`analytics/models/marts/`)

| Model | Grain (Primary Key) | Measures & Purpose | Links to Channel Missions |
| --- | --- | --- | --- |
| `dim_channel` | 1 row per `profile` (`byosan`, `yawa`, `humanity`) | Canonical `channel_id`, `bucket`, `channel_title`, `channel_handle`, target weekly cadence, YPP subscriber/watch-hour thresholds (from `analytics/seeds/channel_profiles.csv`, aligned with `src/domain/youtube_profiles.ts`) | [秒算マネー](../byosan/MISSION.md), [夜話アーカイブ](../yawa/MISSION.md), [人類観測所](../humanity/MISSION.md) |
| `fact_video_performance` | 1 row per `(video_id, age_window)` (`video_window_key`) | `views`, `watch_time_hours`, `average_view_percentage`, `net_subscribers` (`subscribers_gained - subscribers_lost`), `like_rate`, `first_3s_audience_watch_ratio`, plus joined channel `profile` | Per-episode evaluation across all 3 channels |
| `fact_reach_daily` | 1 row per `(channel_id, report_date, video_id)` (`reach_daily_key`) | `thumbnail_impressions`, `thumbnail_impressions_ctr`, `estimated_clicks` (`impressions * ctr`) for impression-weighted CTR aggregation without ratio averaging errors | Thumbnail & title CTR diagnostics |
| `mart_channel_growth_kpi` | 1 row per `profile` (`byosan`, `yawa`, `humanity`) | Channel-level YPP & leading KPI rollup over `first_7d` window + reach + playlist share: `measured_video_count`, `total_views_first_7d`, `total_watch_time_hours_first_7d`, `avg_view_percentage_first_7d`, `impression_weighted_ctr`, `net_subscribers_first_7d`, `playlist_views_first_7d`, `playlist_views_share_first_7d` | Single canonical KPI definition referenced by all 3 `MISSION.md` and [Benchmark Standard](benchmark-standard.md) |

## KPI Definition & Provenance Rules

- **API-measured only**: Analytics values enter `db/evolution.db` only from official YouTube Analytics / Reporting APIs. Estimates are never mixed into measured columns.
- **Null vs Zero**: When a channel has `0` measured videos in `db/evolution.db`, counts (`measured_video_count`) are `0`, while rates and averages (`avg_view_percentage_first_7d`, `impression_weighted_ctr`) stay `NULL`. Never replace unmeasured rates with `0`.
- **No ratio-of-averages bias**: Channel-level CTR (`impression_weighted_ctr`) is computed as `SUM(thumbnail_impressions * thumbnail_impressions_ctr) / NULLIF(SUM(thumbnail_impressions), 0)` from `fact_reach_daily`, not an unweighted mean of per-day percentages.
- **Retention boundary**: The 30-day authorization retention boundary enforced by `task analytics:refresh` applies upstream in `db/evolution.db`, and rebuilding `task analytics:build` automatically reflects purges.

## Automated Data Tests

Defined in `analytics/models/staging/_staging.yml` and `analytics/models/marts/_marts.yml`, executed by `dbt build`:

- Primary key uniqueness & `not_null` on `dim_channel.profile`, `dim_channel.channel_id`, `fact_video_performance.video_window_key`, `fact_reach_daily.reach_daily_key`, `mart_channel_growth_kpi.profile`.
- `accepted_values` on `dim_channel.profile` (`byosan`, `yawa`, `humanity`).
- Referential integrity (`relationships`) from `fact_video_performance.channel_id` and `fact_reach_daily.channel_id` to `dim_channel.channel_id`.

## Staged Future Work (Planned)

1. Enable YouTube Analytics API on GCP project `659942893881` so `task analytics:refresh` populates `db/evolution.db` live.
2. Add production-run event ingestion (`fact_production_run`, `fact_audit_check`, `fact_publication`) once file-based run records under `runs/` are unified into a canonical SQLite ingestion step.
3. Wrap `prepare` and `publish` transitions as audited actions (P2–P3).
