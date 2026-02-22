import ffmpeg from "fluent-ffmpeg";

// ENFORCE GLOBAL CONSTRAINTS
// This file is imported by test files to ensure environment is set correctly
process.env.SKIP_LLM = "true";
process.env.DRY_RUN = "true";
process.env.NODE_ENV = "test";

// Ensure ffmpeg/ffprobe are found in this environment
ffmpeg.setFfmpegPath("/usr/bin/ffmpeg");
ffmpeg.setFfprobePath("/usr/bin/ffprobe");

console.log("[TEST SETUP] Enforcing SKIP_LLM=true and DRY_RUN=true, and setting FFmpeg paths");
