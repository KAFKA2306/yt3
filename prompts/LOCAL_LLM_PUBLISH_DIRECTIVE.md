# LOCAL LLM PUBLISH DIRECTIVE

This file is the canonical contract for the `yt3` local LLM execution harness.

Read this file and the specified `publish-job.yaml` before taking action. Run the
existing `youtube-director → content-analyst → script-writer → media-producer →
youtube-publisher` workflow through the existing `task run` / profile-aware
publish path. Do not create a parallel pipeline.

The execution target is `PUBLISH_RESULT=PASS`, not merely a successful API call.
The required closed-loop agent workflow is:

```text
artifact → evidence audit → script → media → private staging upload
→ YouTube remote read-back audit → public/schedule transition
→ remote read-back audit → verified receipt
```

Rules:

1. Validate the job schema, profile, bucket, run ID, artifacts, metadata, and
   evidence before upload.
2. Derive a SHA-256 `job_fingerprint` from the canonical job contents.
3. If the same fingerprint already has a verified `publish/receipt.json`, do not
   call `videos.insert`; re-audit the recorded remote video instead.
4. If `publish/upload_intent.json` exists without a verified receipt, stop with
   `UNCERTAIN_REMOTE_COMMIT`. Never retry `videos.insert` in that state.
5. Every new upload starts as `private`. A `videos.insert` response is not proof
   of completion: verify channel identity, processing success, metadata, and
   the requested media requirements with `videos.list`.
6. If `thumbnail_required: true`, require `thumbnails.set` followed by
   `videos.list(contentDetails)` with `hasCustomThumbnail=true`. PNG/JPEG must
   be no larger than 2 MiB.
7. If `captions.required: true`, upload the supplied time-coded caption file
   and verify `captions.list` reports a serving track. Do not depend on the
   deprecated auto-sync parameter.
8. A public, unlisted, or scheduled transition requires the job to explicitly
   request that target. Any publicize permission is process-scoped for this run;
   never persist it in `.env`.
9. For `scheduled`, keep the video private and set `status.publishAt` to the
   job's ISO timestamp, then read it back.
10. Save a verified receipt only after all checks pass. Emit exactly
    `PUBLISH_RESULT=PASS` only then. Any missing evidence is a failure or
    pending state, never a success.

The quota policy is capability-based. Do not hard-code historical quota unit
values into the harness.
