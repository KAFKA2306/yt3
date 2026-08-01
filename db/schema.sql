-- YT3 Evolution Database Schema v2 (Audit-Driven)
-- Optimized for Zero-Fat / Crash-Driven Dynamic Generation Mechanics Logging

PRAGMA foreign_keys = ON;

-- 1. Runs (The root of all production logs)
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT,
    ended_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'PUBLISH_BLOCKED', 'FAILED', 'PENDING', 'RUNNING', 'REPAIRED')),
    workflow_version TEXT NOT NULL,
    commit_hash TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    output_hash TEXT NOT NULL,
    published_video_id TEXT,
    failure_code TEXT CHECK(failure_code IN (NULL, 'LOUDNESS_FAIL', 'VISUAL_DEFECTS', 'ASR_HALLUCINATION', 'CLICKBAIT_FAIL', 'VOICE_COLLAPSE_FAIL', 'NOVELTY_FAIL', 'SLOP_FAIL', 'ABSTRACT_SLUDGE_FAIL', 'CADENCE_FAIL', 'CONTINUITY_FAIL', 'NUMERIC_DENSITY_FAIL', 'INFRA_CRASH')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- 2. Raw Artifacts (Sovereign raw log conservation)
CREATE TABLE IF NOT EXISTS raw_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL CHECK(artifact_type IN ('evidence_raw', 'result', 'report', 'research', 'metadata', 'state')),
    raw_path TEXT NOT NULL,
    raw_hash TEXT NOT NULL,
    parser_version TEXT NOT NULL,
    normalized_at TEXT,
    normalization_status TEXT NOT NULL CHECK(normalization_status IN ('COMPLETED', 'FAILED', 'PENDING')),
    normalization_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id, artifact_type)
);

-- 3. Strategy Genomes (Strategic genome properties - The crucial evolution mapping)
CREATE TABLE IF NOT EXISTS strategy_genomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    audience_state TEXT,
    target_state TEXT,
    intro_type TEXT NOT NULL,
    hook_pattern TEXT NOT NULL,
    narrative_weapon TEXT NOT NULL,
    emotion_curve_json TEXT NOT NULL, -- e.g. ["fear", "surprise", "clarity"]
    cadence_profile TEXT NOT NULL,
    memory_anchor TEXT,
    memory_anchor_type TEXT,
    retention_hypothesis TEXT,
    mutation_source_run_id TEXT,
    genome_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id)
);

-- 4. Collapse Signals (Entropy and monotony warnings)
CREATE TABLE IF NOT EXISTS collapse_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    window_size INTEGER NOT NULL,
    emotional_path_entropy REAL NOT NULL,
    hook_pattern_diversity REAL NOT NULL,
    cadence_diversity REAL NOT NULL,
    narrative_weapon_diversity REAL NOT NULL,
    intro_similarity_max REAL NOT NULL,
    strategy_convergence_score REAL NOT NULL,
    collapse_status TEXT NOT NULL CHECK(collapse_status IN ('NORMAL', 'WARNING', 'CRITICAL', 'STABLE')),
    evidence_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id, window_size)
);

-- 5. Mutation Plans (Safe self-modification governance)
CREATE TABLE IF NOT EXISTS mutation_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    trigger_signal_id INTEGER REFERENCES collapse_signals(id) ON DELETE SET NULL,
    mutation_scope TEXT NOT NULL,
    allowed_fields_json TEXT NOT NULL,
    frozen_fields_json TEXT NOT NULL,
    proposed_changes_json TEXT NOT NULL,
    expected_effect TEXT,
    risk_level TEXT NOT NULL CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
    approval_status TEXT NOT NULL CHECK(approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 6. Evolution Events (Sovereign trace of strategy mutation)
CREATE TABLE IF NOT EXISTS evolution_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_genome_id INTEGER REFERENCES strategy_genomes(id) ON DELETE CASCADE,
    to_genome_id INTEGER REFERENCES strategy_genomes(id) ON DELETE CASCADE,
    mutation_plan_id INTEGER REFERENCES mutation_plans(id) ON DELETE SET NULL,
    changed_fields_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 7. Audit Checks (Quality assurance auditing database)
CREATE TABLE IF NOT EXISTS audit_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    audit_name TEXT NOT NULL,
    check_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASS', 'QUALITY_FAIL', 'INFRA_FAIL', 'UNVERIFIED', 'ASK_USER')),
    score REAL,
    threshold REAL,
    failure_code TEXT,
    evidence_json TEXT,
    critical INTEGER NOT NULL CHECK(critical IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id, check_id)
);

-- 8. Script Segments (Segmented script analysis)
CREATE TABLE IF NOT EXISTS script_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    start_sec REAL,
    end_sec REAL,
    text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    entities_json TEXT,
    numbers_json TEXT,
    tension_score REAL,
    abstract_ratio REAL,
    memory_anchor_flag INTEGER NOT NULL CHECK(memory_anchor_flag IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id, segment_index)
);

-- 9. Process Metrics
CREATE TABLE IF NOT EXISTS process_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    abstract_ratio REAL NOT NULL,
    entity_density REAL NOT NULL,
    novelty_gap REAL NOT NULL,
    cadence_variance REAL NOT NULL,
    similarity_score REAL NOT NULL,
    entropy_score REAL NOT NULL,
    retention_risk_score REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id)
);

-- 10. Media Audits
CREATE TABLE IF NOT EXISTS media_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK(media_type IN ('audio', 'video', 'subtitle', 'thumbnail')),
    lufs REAL,
    true_peak REAL,
    freeze_count INTEGER,
    black_count INTEGER,
    subtitle_errors INTEGER,
    thumbnail_ocr_score REAL,
    failure_code TEXT,
    evidence_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE(run_id, media_type)
);

-- 11. YouTube Analytics (Quality feedback loop data)
CREATE TABLE IF NOT EXISTS youtube_analytics (
    video_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    age_window TEXT NOT NULL, -- '24h', '7d'
    views INTEGER NOT NULL,
    watch_time_minutes REAL,
    average_view_duration_seconds REAL,
    average_view_percentage REAL,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    subscribers_net INTEGER,
    satisfaction_score REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (video_id, age_window)
);
