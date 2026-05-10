#!/usr/bin/env python3
import argparse
import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

ABSTRACT_WORDS = {"永遠", "境界線", "愛情", "記憶", "存在", "外界", "自由", "監視", "管理"}
ONOMATOPOEIA = {"カリッ", "ぞわっ", "とろっ", "ちゅっ", "れろ", "ふわふわ", "ドクン", "どくん"}
INVERSION_PAIRS = {("上書き", "浮気"), ("外界", "海外"), ("永遠", "搭載")}


@dataclass
class Finding:
    severity: str
    start: float
    end: float
    expected: str
    actual: str
    reason: str


def normalize(text: str) -> str:
    text = re.sub(r"（.*?）", " ", text)
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r'[「」『』"✨🖤💕😊😴👂♡]', "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def split_script_sentences(md: str) -> list[str]:
    text = normalize(md)
    parts = re.split(r"[。！？!?]\s*", text)
    return [part.strip() for part in parts if len(part.strip()) >= 6]


def read_asr_jsonl(path: Path) -> list[dict]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        out.append(json.loads(line))
    return out


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def classify(expected: str, actual: str) -> tuple[str, str]:
    for a, b in INVERSION_PAIRS:
        if a in expected and b in actual:
            return "CRITICAL", "semantic inversion"

    for word in ABSTRACT_WORDS:
        if word in expected and word not in actual:
            return "HIGH", "abstract-word corruption"

    for word in ONOMATOPOEIA:
        if word in expected and word not in actual:
            return "MEDIUM", "onomatopoeia failure"

    score = similarity(expected, actual)
    if score < 0.34:
        return "HIGH", "phrase collapse/missing"
    if score < 0.55:
        return "MEDIUM", "partial corruption"
    return "MINOR", "small variation"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--script-md", required=True)
    ap.add_argument("--asr-jsonl", required=True)
    ap.add_argument("--output-md", required=True)
    args = ap.parse_args()

    script_text = Path(args.script_md).read_text(encoding="utf-8")
    asr = read_asr_jsonl(Path(args.asr_jsonl))

    exp_sentences = split_script_sentences(script_text)
    asr_texts = [normalize(item["text"]) for item in asr]

    findings = []
    for expected in exp_sentences:
        best_j = -1
        best_score = -1.0
        for j, actual in enumerate(asr_texts):
            score = similarity(expected, actual)
            if score > best_score:
                best_score = score
                best_j = j
        if best_j < 0:
            continue

        severity, reason = classify(expected, asr_texts[best_j])
        if severity in ("CRITICAL", "HIGH", "MEDIUM"):
            seg = asr[best_j]
            findings.append(
                Finding(
                    severity=severity,
                    start=seg["start"],
                    end=seg["end"],
                    expected=expected,
                    actual=asr_texts[best_j],
                    reason=reason,
                )
            )

    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}
    findings.sort(key=lambda item: (order[item.severity], item.start))

    lines = ["# ASR Quality Report", ""]
    if not findings:
        lines.append("No CRITICAL/HIGH/MEDIUM findings.")
    else:
        for finding in findings[:80]:
            lines.append(f"[{finding.severity}]")
            lines.append(f"{finding.start:05.2f}-{finding.end:05.2f}")
            lines.append(f"expected: {finding.expected}")
            lines.append(f"actual: {finding.actual}")
            lines.append(f"reason: {finding.reason}")
            lines.append("")

    Path(args.output_md).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(args.output_md)


if __name__ == "__main__":
    main()
