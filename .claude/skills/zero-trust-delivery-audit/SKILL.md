---
name: zero-trust-delivery-audit
description: Validates generated outputs, ensures implementations are not fake/mocked/incomplete, checks CI artifacts, and verifies actual runtime/filesystem reality.
type: skill
---

# Zero-Trust Delivery Audit

## Objective

Validate all generated outputs and build/run artifacts without assuming success. Ensure no fake paths, no hallucinated completion, and zero trust validation.

## Workflow

1. **Collect Outputs**: Identify all files, binaries, or artifacts claimed to be generated.
2. **Verify Filesystem Existence**: Check if the paths exist in the filesystem. Do not assume.
3. **Verify Executable/Runtime Reality**: Verify that outputs are executable, valid JSON, correct media dimensions, or proper syntax where applicable.
4. **Compare Claimed vs Actual Artifacts**: Ensure what was claimed in the run log matches the actual files on disk.
5. **Emit Verdict**: Output one of: PASS, FAIL, or UNVERIFIED.
6. **Attach Evidence**: Document exact paths and sizes of verified artifacts.
