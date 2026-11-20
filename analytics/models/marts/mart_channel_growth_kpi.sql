with perf_7d as (
    select
        channel_id,
        count(*) as measured_video_count,
        sum(views) as total_views_first_7d,
        sum(watch_time_hours) as total_watch_time_hours_first_7d,
        avg(average_view_percentage) as avg_view_percentage_first_7d,
        avg(first_3s_audience_watch_ratio) as avg_first_3s_watch_ratio_first_7d,
        sum(net_subscribers) as net_subscribers_first_7d,
        avg(like_rate) as avg_like_rate_first_7d
    from {{ ref('fact_video_performance') }}
    where age_window = 'first_7d'
    group by channel_id
),
reach as (
    select
        channel_id,
        sum(thumbnail_impressions) as total_thumbnail_impressions,
        case
            when sum(thumbnail_impressions) > 0
            then sum(estimated_clicks) / sum(thumbnail_impressions)
            else null
        end as impression_weighted_ctr
    from {{ ref('fact_reach_daily') }}
    group by channel_id
)
select
    c.profile,
    c.bucket,
    c.channel_id,
    c.channel_title,
    c.target_weekly_uploads,
    c.ypp_target_subscribers,
    c.ypp_target_watch_hours,
    coalesce(p.measured_video_count, 0) as measured_video_count,
    coalesce(p.total_views_first_7d, 0) as total_views_first_7d,
    coalesce(p.total_watch_time_hours_first_7d, 0.0) as total_watch_time_hours_first_7d,
    p.avg_view_percentage_first_7d,
    p.avg_first_3s_watch_ratio_first_7d,
    p.avg_like_rate_first_7d,
    p.net_subscribers_first_7d,
    coalesce(r.total_thumbnail_impressions, 0) as total_thumbnail_impressions,
    r.impression_weighted_ctr
from {{ ref('dim_channel') }} as c
left join perf_7d as p
    on c.channel_id = p.channel_id
left join reach as r
    on c.channel_id = r.channel_id
order by c.profile
