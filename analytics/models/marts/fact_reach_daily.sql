select
    r.reach_daily_key,
    r.channel_id,
    c.profile,
    c.bucket,
    r.report_date,
    r.video_id,
    r.episode_id,
    r.thumbnail_impressions,
    r.thumbnail_impressions_ctr,
    cast(r.thumbnail_impressions as double) * r.thumbnail_impressions_ctr as estimated_clicks,
    r.report_id,
    r.report_created_at,
    r.downloaded_at
from {{ ref('stg_youtube_reach_daily') }} as r
left join {{ ref('dim_channel') }} as c
    on r.channel_id = c.channel_id
