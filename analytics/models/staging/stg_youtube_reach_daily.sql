select
    cast(channel_id as varchar) as channel_id,
    cast(report_date as varchar) as report_date,
    cast(video_id as varchar) as video_id,
    cast(channel_id as varchar) || '::' || cast(report_date as varchar) || '::' || cast(video_id as varchar) as reach_daily_key,
    cast(episode_id as varchar) as episode_id,
    cast(thumbnail_impressions as bigint) as thumbnail_impressions,
    cast(thumbnail_impressions_ctr as double) as thumbnail_impressions_ctr,
    cast(report_id as varchar) as report_id,
    cast(report_created_at as varchar) as report_created_at,
    cast(downloaded_at as varchar) as downloaded_at
from {{ source('yt3_raw', 'youtube_analytics_reach_daily') }}
