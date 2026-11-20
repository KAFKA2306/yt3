select
    cast(video_id as varchar) as video_id,
    cast(age_window as varchar) as age_window,
    cast(traffic_source_type as varchar) as traffic_source_type,
    cast(video_id as varchar) || '::' || cast(age_window as varchar) || '::' || cast(traffic_source_type as varchar) as traffic_source_key,
    cast(episode_id as varchar) as episode_id,
    cast(channel_id as varchar) as channel_id,
    cast(views as bigint) as views,
    cast(engaged_views as bigint) as engaged_views,
    cast(watch_time_minutes as double) as watch_time_minutes,
    cast(recorded_at as varchar) as recorded_at
from {{ source('yt3_raw', 'youtube_analytics_traffic_sources') }}
