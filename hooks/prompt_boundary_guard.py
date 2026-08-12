#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def repo_root() -> Path:
	return Path(__file__).resolve().parents[1]


def load_policy() -> dict[str, Any]:
	policy_file = repo_root() / "config" / "policies" / "prompt_boundary_policy.json"
	with policy_file.open("r", encoding="utf-8") as fh:
		return json.load(fh)


def load_hook_input() -> dict[str, Any]:
	try:
		return json.load(sys.stdin)
	except json.JSONDecodeError as exc:
		raise SystemExit(f"prompt-boundary-guard: invalid hook input: {exc}") from exc


def normalize_path(raw: str) -> str:
	path = Path(raw)
	if not path.is_absolute():
		path = repo_root() / path
	else:
		path = path
	resolved = path.resolve(strict=False)
	try:
		return resolved.relative_to(repo_root()).as_posix()
	except ValueError:
		fail(f"prompt-boundary-guard: {raw} resolves outside repository boundary")


def matches_any(path: str, patterns: list[str]) -> bool:
	return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def classify_path(path: str, policy: dict[str, Any]) -> str:
	if matches_any(path, policy["readonly_paths"]):
		return "readonly"
	if matches_any(path, policy["editable_paths"]):
		return "editable"
	return "other"


def pattern_root(pattern: str) -> str:
	specials = [idx for idx in (pattern.find("*"), pattern.find("?"), pattern.find("[")) if idx != -1]
	cut = min(specials) if specials else len(pattern)
	prefix = pattern[:cut]
	prefix = prefix.rstrip("/")
	if prefix.endswith("/**"):
		prefix = prefix[:-3]
	return prefix.rstrip("/")


def monitored_roots(policy: dict[str, Any]) -> list[str]:
	roots = set()
	for pattern in (
		*policy.get("editable_paths", []),
		*policy.get("readonly_paths", []),
		*(pattern for hook in policy.get("hooks", []) for pattern in hook.get("deny_scope", [])),
		*(pattern for hook in policy.get("hooks", []) for pattern in hook.get("input_scope", {}).get("include", [])),
	):
		root = pattern_root(pattern)
		if root:
			roots.add(root)
	return sorted(roots)


def file_sha256(path: Path) -> str:
	hasher = hashlib.sha256()
	with path.open("rb") as fh:
		for chunk in iter(lambda: fh.read(1024 * 1024), b""):
			hasher.update(chunk)
	return hasher.hexdigest()


def relative_repo_path(path: Path) -> str:
	return path.relative_to(repo_root()).as_posix()


def snapshot_entry(path: Path, policy: dict[str, Any]) -> dict[str, Any]:
	stat = path.lstat()
	entry: dict[str, Any] = {
		"exists": True,
		"kind": "symlink" if path.is_symlink() else "file",
		"size": stat.st_size,
		"mode": stat.st_mode,
		"inode": stat.st_ino,
		"device": stat.st_dev,
		"mtime_ns": stat.st_mtime_ns,
	}

	if path.is_symlink():
		target = os.readlink(path)
		resolved = path.resolve(strict=False)
		entry["symlink_target"] = target
		entry["resolved_path"] = resolved.as_posix()
		try:
			entry["resolved_repo_relative"] = resolved.relative_to(repo_root()).as_posix()
		except ValueError:
			if policy.get("deny_symlink_outside_repo", True):
				fail(
					f"🛑 boundary violation: symlink escapes repository boundary: {path.as_posix()} -> {resolved.as_posix()}"
				)
			entry["resolved_repo_relative"] = None
	else:
		entry["sha256"] = file_sha256(path)

	return entry


def collect_snapshot(policy: dict[str, Any]) -> dict[str, dict[str, Any]]:
	snapshot: dict[str, dict[str, Any]] = {}
	for root in monitored_roots(policy):
		root_path = repo_root() / root
		if not root_path.exists() and not root_path.is_symlink():
			continue
		if root_path.is_file() or root_path.is_symlink():
			if root_path.exists() or root_path.is_symlink():
				rel = relative_repo_path(root_path)
				snapshot[rel] = snapshot_entry(root_path, policy)
			continue
		for candidate in sorted(root_path.rglob("*")):
			if candidate.is_dir():
				continue
			rel = relative_repo_path(candidate)
			snapshot[rel] = snapshot_entry(candidate, policy)
	return snapshot


def git_lines(args: list[str], paths: list[str]) -> list[str]:
	if not paths:
		return []
	result = subprocess.run(
		["git", *args, "--", *paths],
		cwd=repo_root(),
		check=True,
		text=True,
		capture_output=True,
	)
	return [line for line in result.stdout.splitlines() if line]


def git_evidence(paths: list[str]) -> dict[str, list[str]]:
	return {
		"status": git_lines(["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"], paths),
		"diff_cached": git_lines(["diff", "--name-only", "--cached"], paths),
		"diff_worktree": git_lines(["diff", "--name-only"], paths),
		"ignored": git_lines(["ls-files", "--others", "--ignored", "--exclude-standard"], paths),
	}


def state_path_for(target: str) -> Path:
	state_dir = Path(tempfile.gettempdir()) / "yt3_prompt_boundary"
	state_dir.mkdir(parents=True, exist_ok=True)
	digest = hashlib.sha1(target.encode("utf-8")).hexdigest()[:12]
	return state_dir / f"{digest}.json"


def fail(message: str) -> None:
	print(message, file=sys.stderr)
	raise SystemExit(2)


def run_pre(target: str, policy: dict[str, Any]) -> int:
	if classify_path(target, policy) == "readonly":
		fail(f"🛑 boundary violation: {target} is read-only.")

	state_file = state_path_for(target)
	with state_file.open("w", encoding="utf-8") as fh:
		json.dump(
			{
				"target": target,
				"baseline_snapshot": collect_snapshot(policy),
				"git_evidence": git_evidence(monitored_roots(policy)),
			},
			fh,
			ensure_ascii=False,
			indent=2,
		)

	if classify_path(target, policy) == "editable":
		print(f"✅ boundary ok: {target} is within editable prompt scope.")

	return 0


def run_post(target: str, policy: dict[str, Any]) -> int:
	state_file = state_path_for(target)
	if not state_file.exists():
		fail(f"prompt-boundary-guard: missing pre-hook state for {target}")

	with state_file.open("r", encoding="utf-8") as fh:
		state = json.load(fh)

	baseline_snapshot = state.get("baseline_snapshot", {})
	current_snapshot = collect_snapshot(policy)
	baseline_paths = set(baseline_snapshot.keys())
	current_paths = set(current_snapshot.keys())
	added_paths = sorted(current_paths - baseline_paths)
	deleted_paths = sorted(baseline_paths - current_paths)
	modified_paths = sorted(
		path
		for path in sorted(current_paths & baseline_paths)
		if current_snapshot[path] != baseline_snapshot[path]
	)
	hook_deny_scope = [
		pattern
		for hook in policy.get("hooks", [])
		for pattern in hook.get("deny_scope", [])
	]
	target_is_editable = classify_path(target, policy) == "editable"

	changed_paths = sorted(set(added_paths + deleted_paths + modified_paths))
	if not changed_paths:
		state_file.unlink(missing_ok=True)
		print(f"✅ boundary audit ok: no file-system mutations for {target}.")
		return 0

	readonly_violations = [
		path
		for path in changed_paths
		if matches_any(path, policy["readonly_paths"])
	]
	if readonly_violations:
		fail(
			"🛑 boundary violation: read-only files changed: "
			+ ", ".join(readonly_violations)
		)

	deny_scope_violations = [
		path for path in changed_paths if matches_any(path, hook_deny_scope)
	]
	if deny_scope_violations:
		fail(
			"🛑 boundary violation: deny-scope files changed: "
			+ ", ".join(deny_scope_violations)
		)

	if target_is_editable:
		extra_paths = [
			path
			for path in changed_paths
			if not matches_any(path, policy["editable_paths"])
			and not matches_any(path, policy["readonly_paths"])
		]
		if extra_paths:
			fail(
				"🛑 boundary violation: changes escaped editable scope: "
				+ ", ".join(extra_paths)
			)
	else:
		editable_violations = [
			path for path in changed_paths if matches_any(path, policy["editable_paths"])
		]
		if editable_violations:
			fail(
				"🛑 boundary violation: prompt-system files changed outside system scope: "
				+ ", ".join(editable_violations)
			)

	rename_pairs: list[str] = []
	if deleted_paths and added_paths:
		deleted_by_hash: dict[str, list[str]] = {}
		for path in deleted_paths:
			entry = baseline_snapshot[path]
			key = json.dumps(
				{
					"kind": entry.get("kind"),
					"sha256": entry.get("sha256"),
					"symlink_target": entry.get("symlink_target"),
				},
				sort_keys=True,
			)
			deleted_by_hash.setdefault(key, []).append(path)
		for path in added_paths:
			entry = current_snapshot[path]
			key = json.dumps(
				{
					"kind": entry.get("kind"),
					"sha256": entry.get("sha256"),
					"symlink_target": entry.get("symlink_target"),
				},
				sort_keys=True,
			)
			if deleted_by_hash.get(key):
				old_path = deleted_by_hash[key].pop(0)
				rename_pairs.append(f"{old_path} -> {path}")

	state_file.unlink(missing_ok=True)
	summary_parts = []
	if added_paths:
		summary_parts.append("added=" + ", ".join(added_paths))
	if deleted_paths:
		summary_parts.append("deleted=" + ", ".join(deleted_paths))
	if modified_paths:
		summary_parts.append("modified=" + ", ".join(modified_paths))
	if rename_pairs:
		summary_parts.append("renamed=" + ", ".join(rename_pairs))
	print("✅ boundary audit ok: " + "; ".join(summary_parts))
	return 0


def main() -> int:
	parser = argparse.ArgumentParser()
	parser.add_argument("--phase", choices=["pre", "post"], required=True)
	args = parser.parse_args()

	payload = load_hook_input()
	tool_input = payload.get("tool_input", {})
	raw_target = tool_input.get("file_path") or tool_input.get("path")
	if not raw_target:
		fail("prompt-boundary-guard: missing tool_input.file_path/path")

	target = normalize_path(str(raw_target))
	policy = load_policy()

	if args.phase == "pre":
		return run_pre(target, policy)
	return run_post(target, policy)


if __name__ == "__main__":
	raise SystemExit(main())
