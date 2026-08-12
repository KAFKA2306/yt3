# JSON Schema Versioning System

## Overview

This directory contains JSON Schema definitions for LLM responses and data structures used throughout the YT3 system. Schemas are the single source of truth for data validation and LLM output structure.

## Available Schemas

### v2 (Current)

- **content_schema_v2.json** - Content generation output (script, metadata, timing)
- **research_schema_v2.json** - Research agent output (director data, news items)
- **outline_schema_v2.json** - Content outline structure (hook, sections, CTA)

### v3

- **zero_trust_audit_checklist_v1.json** - Project-specific audit checklist specification
- **zero_trust_audit_report_v1.json** - Structured audit result report
- **prompt_boundary_policy_v1.json** - Boundary policy for prompt-system edits and generated artifacts
- **prompt_manifest_v1.json** - Manifest for system prompt artifacts
- **generated_artifact_manifest_v1.json** - Manifest for generated artifacts

## Schema Management

### Loading Schemas

Use `SchemaManager.loadSchema(name)` to load any schema:

```typescript
import { SchemaManager } from "../../io/utils/schema_manager.js";

const schema = SchemaManager.loadSchema("content_schema_v2");
```

### Registering New Schemas

```typescript
SchemaManager.registerSchema("my_schema", {
  type: "object",
  properties: { ... },
  required: ["field1", "field2"]
});
```

### Validation

```typescript
const result = SchemaManager.validateAgainstSchema(data, "content_schema_v2");
if (!result.valid) {
  console.error(result.errors);
}
```

## Version Control

- **v2**: Initial schema system (2026-03-27)
  - Content schema with script and metadata
  - Research schema with director data and news
  - Outline schema with sections and CTA

Future versions will be added as `v3.json`, `v4.json`, etc.
Audit-specific schemas use explicit names because they are policy artifacts, not generic generation payloads.

## Integration Points

1. **Prompts**: Reference schemas in prompts to enforce structure:
   ```yaml
   system_prompt: |
     Output valid JSON according to content_schema_v2
   ```

2. **LLM Response Parsing**: Schemas are used in `parseLlmJson()`:
   ```typescript
   const result = parseLlmJson(response, ContentSchema);
   ```

3. **Validation Pipeline**: Schemas validate output before saving:
   ```typescript
   const validation = SchemaManager.validateAgainstSchema(data, "content_schema_v2");
   ```

## Notes

- All schemas conform to JSON Schema Draft 7
- Schemas are cached in memory for performance
- Changes to schemas should be backward-compatible when possible
- Update `agr.toml` CHANGELOG when adding new versions
