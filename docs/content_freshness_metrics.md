# Content Freshness Metrics

This repository now treats "daily interestingness" as a deterministic gate plus a bounded semantic check.

## Research Basis

- Novelty, diversity, serendipity, and coverage are standard beyond-accuracy metrics in recommender-system evaluation.
- Serendipity is most useful when it combines unexpectedness with relevance, timeliness, and curiosity.
- NLG diversity work shows that diversity metrics are not interchangeable and should be evaluated as a suite, not a single score.
- Creator advice from Reddit consistently emphasizes a strong hook and removing boring material to protect retention.
- A practical novelty blog reinforces that novelty should be measured explicitly rather than assumed.

## Repository Metrics

- `novelty_score`: How far the current title, intro, and topic are from recent runs.
- `diversity_score`: How varied the recent hook patterns, cadence profiles, and topic categories are.
- `serendipity_score`: A blend of novelty, usefulness proxies, and concreteness.
- `coverage_score`: How broad the recent topic footprint is across buckets and categories.
- `concreteness_score`: How much the opening relies on concrete, anchored signals instead of abstract filler.
- `freshness_score`: Composite gate derived from the metrics above.

## Passing Thresholds

- `freshness_score >= 68`
- `novelty_score >= 60`
- `diversity_score >= 45`
- `serendipity_score >= 55`
- `coverage_score >= 45`

If the gate fails, the run is marked `QUALITY_FAIL` and publish is blocked.

## Evidence

- `runs/<bucket>/<date>/audit/creative_freshness_report.json`
- `runs/<bucket>/<date>/run_evidence.json`
- `logs/stability_summary.json`
