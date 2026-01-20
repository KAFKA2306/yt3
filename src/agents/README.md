# Agent Responsibilities

| Agent | Input | Core Responsibility | Output |
| :--- | :--- | :--- | :--- |
| **Research** | `bucket`, `limit` | **Discovery & Strategy**: Memory search for novelty, angle selection, and targeted web search. | `director_data`, `news`, `memory_context` |
| **Content** | `news`, `director_data`, `memory_context` | **Creation**: Scriptwriting (dialogue) and SEO metadata generation based on research context. | `script`, `metadata` |
| **Media** | `script`, `metadata` | **Production**: TTS audio synthesis and media assembly (Layouts via LayoutEngine). | `audio`, `thumbnail`, `video` |
| **Publish** | `state` | **Distribution**: Automated uploading to YouTube and posting to Twitter/X. | `publish_results` |
