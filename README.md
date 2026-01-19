# YouTube AI Video Generator v2

YouTube AI Video Generator v2 assembles narrated Japanese finance videos from daily news by chaining modular workflow steps. The command-line entry point wires together news collection, Gemini-based script generation, Voicevox audio synthesis, subtitle formatting, and FFmpeg rendering, with optional metadata and publishing steps enabled through configuration.

## 🚀 Quick Start

### Prerequisites
Install [Task](https://taskfile.dev) runner for streamlined commands:
```bash
# Using snap (recommended)
snap install task

# Or using apt
apt install taskwarrior
```

### First-Time Setup
```bash
# Complete bootstrap: dependencies + services + automation
task bootstrap
```

This will:
- Install Python dependencies via `uv sync`
- Start background services (Aim, Voicevox, Discord bot)
- Configure automation and install cron schedule

### Manual Setup (if Task is not available)
```bash
# 1. Install dependencies
uv sync

# 2. Configure environment
cp config/.env.example config/.env
# Edit config/.env with your API keys

# 3. Start background services
nohup bash scripts/start_aim.sh >/dev/null 2>&1 &
nohup bash scripts/voicevox_manager.sh start >/dev/null 2>&1 &
nohup uv run python scripts/discord_news_bot.py >/dev/null 2>&1 &

# 4. Setup automation
python scripts/automation.py --skip-cron
python scripts/automation.py --install-cron
```

### Running Workflows
```bash
# Run main workflow
task run

# Run with custom news query
task run -- --news-query "FOMC 金利"

# Check service status
task services:status
```

## 📚 Command Reference

### Workflow Execution
| Command | Description |
|---------|-------------|
| `task run` | Run main workflow with optional args |
| `task youtube:run` | Run YouTube video generation |
| `task youtube:dev` | Run with debug logging |
| `task thumbnail-test -- <run_id>` | Test AI thumbnail generation |

**Scene Generation Test:**
```bash
# Test scene generation with existing run
uv run python scripts/test_scene_gen.py <run_id>
```

### Service Management
| Command | Description |
|---------|-------------|
| `task services:start` | Start all services (Aim, Voicevox, Discord) |
| `task services:status` | Check service statuses |
| `task voicevox:start` | Start Voicevox TTS engine |
| `task voicevox:stop` | Stop Voicevox TTS engine |
| `task discord:start` | Start Discord news bot |
| `task aim:dashboard` | Start Aim dashboard UI |

### Automation
| Command | Description |
|---------|-------------|
| `task automation:setup` | Full automation setup (git pull + services + cron) |
| `task automation:init` | Initialize automation (no cron) |
| `task automation:cron` | Install cron schedule only |

### Development
| Command | Description |
|---------|-------------|
| `task lint` | Run linting checks |
| `task lint:fix` | Auto-fix linting and format |
| `task format` | Format code |
| `task test` | Run fast tests (alias for test:fast) |
| `task test:fast` | Run fast tests (skips video rendering) |
| `task test:all` | Run ALL tests (complete validation) |
| `task clean` | Clean cache files |

### Git
| Command | Description |
|---------|-------------|
| `task git:sync -- "message"` | Add, commit, push in one command |
| `task git:status` | Show git status |

## Workflow Summary

| Step | Module | Output | Notes |
| --- | --- | --- | --- |
| News collection | `src/steps/news.py` | `news.json` | Executes Perplexity and Gemini providers with fallback chaining |
| Script generation | `src/steps/script.py` | `script.json` | Prompts Gemini with speaker profiles and previous run context |
| Scene generation | `src/steps/scene_generator.py` | `scene_manifest.json` | Generates atmospheric scene images using Z-Image-Turbo diffusion model |
| Audio synthesis | `src/steps/audio.py` | `audio.wav` | Calls Voicevox HTTP API per segment and concatenates audio |
| Subtitle formatting | `src/steps/subtitle.py` | `subtitles.srt` | Allocates time slices and wraps Japanese lines |
| Video rendering | `src/steps/video.py` | `video.mp4` | Ken Burns effects, overlays, subtitle burn-in via FFmpeg |

Optional steps add metadata analysis, thumbnail generation, platform uploads, and social distribution when enabled in `config/default.yaml`.

## Configuration

- **`config/default.yaml`** — workflow toggles, provider credentials, rendering parameters
- **`config/prompts.yaml`** — prompt templates for news, script, and metadata providers
- **`config/scene_prompts.yaml`** — scene generation prompts (literal, abstract, atmospheric)
- **`config/.env`** — API keys (copy from `.env.example` and fill in)
- **`assets/`** — fonts and character art for thumbnails and video overlays

### Scene Generation (Z-Image-Turbo)

The system uses a **clean architecture service layer** for image generation:

```yaml
# config/default.yaml
steps:
  scene:
    enabled: true
    images_per_video: 4
    variants_per_type: 2
    batch_size: 2          # NEW: Process 2 images at once (faster)
    compile_model: false   # NEW: Enable torch.compile for speedup
    width: 1280
    height: 720
    num_steps: 9
```

**Performance Tuning:**
- `batch_size=1`: Safe default (baseline speed)
- `batch_size=2`: ~1.5-1.8x faster (moderate VRAM)
- `batch_size=4`: ~2-2.5x faster (high VRAM, requires 16GB+ GPU)
- `compile_model=true`: Adds 30-60s startup, but 10-20% faster inference

**Architecture:**
- Service layer: `src/services/image_generation.py`
- Protocol-based abstraction for easy testing and backend swapping
- Dependency injection in `SceneGenerator`

## Repository Structure

```
├── apps/              # Application entry points (YouTube CLI)
├── config/            # YAML configuration, prompt templates, env example
├── docs/              # System overview and operations guides
├── scripts/           # Automation, service management, utilities
├── src/               # Core workflow, providers, and step implementations
├── tests/             # Unit, integration, and e2e test suites
└── runs/              # Generated artifacts per run (created on demand)
```

Workflow classes live under `src/core/`, typed configuration models in `src/utils/config.py`, and step implementations in `src/steps/`.

## Testing Strategy

This project uses **real E2E tests** with actual APIs and system components—no mocks, no stubs:

**Test Categories:**
- **Fast Tests** (default): News → Script → Audio → Subtitle pipeline using real Gemini API and Voicevox. Skips video rendering for speed (~2-5 min).
- **Slow Tests**: Complete workflow including FFmpeg video rendering and intro/outro concatenation (~10-20 min).

**What Gets Tested:**
- ✓ Real Gemini API calls for news collection and script generation
- ✓ Real Voicevox TTS audio synthesis
- ✓ Real FFmpeg video rendering (slow tests only)
- ✓ Checkpoint/resume functionality
- ✓ Custom query variations
- ✓ Duration constraints
- ✓ Metadata and thumbnail generation
- ✗ YouTube uploads (excluded due to rate limits)

**Running Tests:**
```bash
# Fast tests (default) - validates core pipeline
task test:fast

# Complete validation (includes video rendering)
task test:all
```

Tests use real data and validate actual functionality—if tests pass, the system works in production.

## Automation

The system runs automated workflows every 4 hours via cron:
```cron
0 */4 * * * cd /home/kafka/2511youtuber && bash scripts/run_workflow_cron.sh
```

Logs are written to `logs/automation/workflow_4hourly.log`.

## Additional Documentation

- [docs/system_overview.md](docs/system_overview.md) — Architecture, dependencies, run lifecycle
- [docs/operations.md](docs/operations.md) — Setup, execution, testing, maintenance
- [docs/automation_playbook.md](docs/automation_playbook.md) — Automation setup and troubleshooting
- [AGENTS.md](AGENTS.md) — Repository guidelines and development workflow

