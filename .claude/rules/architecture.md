---
paths:
  - "src/**/*"
---
# Clean Architecture Rules

## 1. Domain Layer (`src/domain/`)
- **Purpose**: Enterprise business rules and entities.
- **Allowed Imports**: Standard library, `pydantic`.
- **Forbidden Imports**: `langgraph`, `haystack`, `google`, `ffmpeg`, or any infrastructure code.
- **Content**: Pydantic models, custom Exceptions, pure logic functions.

## 2. Application Layer (`src/app/`)
- **Purpose**: Application business rules, use cases, and workflow orchestration.
- **Allowed Imports**: `src/domain`, `src/infra` (interfaces/wrappers).
- **Core Component**: `langgraph` state and nodes.
- **Content**:
    - `state.py`: The global state definition.
    - `graph.py`: The graph topography.
    - `nodes/*.py`: Individual steps (News, Script, etc.).

## 3. Infrastructure Layer (`src/infra/`)
- **Purpose**: Interface adapters, external tools, frameworks, and drivers.
- **Content**:
    - `haystack/`: RAG pipelines.
    - `gemini/`: LLM client wrappers.
    - `voicevox/`: Audio generation logic.
    - `ffmpeg/`: Video rendering logic.
- **Note**: This is the only place where external Side Effects (Network/Disk) should occur.

## 4. Composition Root (`src/main.py`)
- **Purpose**: Entry point.
- **Responsibility**: Initialize `infra` credentials, setup `app` graph, and run.
