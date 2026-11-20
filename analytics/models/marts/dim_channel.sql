select
    cast(profile as varchar) as profile,
    cast(bucket as varchar) as bucket,
    cast(channel_id as varchar) as channel_id,
    cast(channel_title as varchar) as channel_title,
    cast(channel_handle as varchar) as channel_handle,
    cast(target_weekly_uploads as integer) as target_weekly_uploads,
    cast(ypp_target_subscribers as integer) as ypp_target_subscribers,
    cast(ypp_target_watch_hours as integer) as ypp_target_watch_hours
from {{ ref('channel_profiles') }}
