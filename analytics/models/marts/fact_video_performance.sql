select
    a.video_window_key,
    a.video_id,
    a.age_window,
    a.episode_id,
    a.channel_id,
    c.profile,
    c.bucket,
    a.views,
    a.engaged_views,
    a.watch_time_minutes,
    case
        when a.watch_time_minutes is null then null
        else a.watch_time_minutes / 60.0
    end as watch_time_hours,
    a.average_view_duration_seconds,
    a.average_view_percentage,
    a.likes,
    case
        when a.likes is null or a.views is null or a.views = 0 then null
        else cast(a.likes as double) / cast(a.views as double)
    end as like_rate,
    a.comments,
    a.shares,
    a.subscribers_gained,
    a.subscribers_lost,
    case
        when a.subscribers_gained is null and a.subscribers_lost is null then null
        else coalesce(a.subscribers_gained, 0) - coalesce(a.subscribers_lost, 0)
    end as net_subscribers,
    a.first_3s_audience_watch_ratio,
    a.card_impressions,
    a.card_clicks,
    a.card_click_rate,
    a.recorded_at
from {{ ref('stg_youtube_analytics') }} as a
left join {{ ref('dim_channel') }} as c
    on a.channel_id = c.channel_id
