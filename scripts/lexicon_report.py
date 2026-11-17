# /// script
# requires-python = ">=3.10"
# dependencies = ["sudachipy", "sudachidict_core", "lexicalrichness"]
# ///
import glob
import itertools
import json
import re
import statistics
import sys
from collections import Counter

from lexicalrichness import LexicalRichness
from sudachipy import dictionary, tokenizer

SOURCES = {
    "humanity": (
        "runs/humanity_music/*/request.json",
        lambda d: re.sub(r"\[[^\]]*\]", "", d["lyrics"]),
    ),
    "yawa": (
        "runs/yawa_archive/*/script.json",
        lambda d: "\n".join(s if isinstance(s, str) else s["text"] for c in d.get("chapters", []) for s in c.get("segments", [])) if "chapters" in d else "\n".join(s if isinstance(s, str) else s["text"] for s in d.get("segments", [])),
    ),
    "byosan": (
        "runs/byosan_money/*/source/feature_spec.json",
        lambda d: "\n".join(s["text"] for s in d["segments"]),
    ),
}
CONTENT = {"名詞", "動詞", "形容詞", "形状詞", "副詞"}
STOP = {"する", "いる", "ある", "なる", "いく", "くる", "こと", "もの", "ない", "よう", "の", "それ", "これ"}
WINDOW = 50

name = sys.argv[1]
pattern, extract = SOURCES[name]
analyzer = dictionary.Dictionary().create()
mode = tokenizer.Tokenizer.SplitMode.C


def words(text):
    return [
        m.dictionary_form()
        for m in analyzer.tokenize(text, mode)
        if m.part_of_speech()[0] in CONTENT
        and m.dictionary_form() not in STOP
        and not re.fullmatch(r"[\W\d_]+", m.dictionary_form())
    ]


loaded = [json.load(open(f)) for f in sorted(glob.glob(pattern))]
docs = [extract(d) for d in loaded if name == "humanity" or "segments" in d or "chapters" in d]
tokens = [words(d) for d in docs]
sets = [set(t) for t in tokens]
mattr = [
    LexicalRichness(" ".join(t)).mattr(window_size=WINDOW)
    for t in tokens
    if len(t) >= WINDOW
]
jaccard = [len(a & b) / len(a | b) for a, b in itertools.combinations(sets, 2) if a | b]
frequency = Counter(w for s in sets for w in s)
print(f"{name}: documents={len(docs)} content_words={sum(map(len, tokens))}")
print(f"MATTR(window={WINDOW}) mean={statistics.mean(mattr):.3f} documents={len(mattr)}" if mattr else f"MATTR(window={WINDOW}) unavailable: no eligible documents")
print(f"pairwise Jaccard mean={statistics.mean(jaccard):.3f} max={max(jaccard):.3f}" if jaccard else "pairwise Jaccard unavailable: fewer than two comparable documents")
print("document frequency top 15:")
for word, count in frequency.most_common(15):
    print(f"  {word}\t{count / len(docs):.0%}")
