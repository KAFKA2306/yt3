# Yawa voice and situation design research — 2026-11-12

## Findings

The previous design had many theoretical combinations but little perceptual range. It crossed six short YAML lists (place, prop, time, narrator role, sound world, mood) with four story shapes. The raw cross product was 33,600 axis combinations, but nearly every option stayed inside a quiet, night-time care scene. The 21-entry inspiration pool was mostly free scripts and was not a count of commercial-market keywords.

Voice profiles varied one named trait at a time while repeating the same speaker brief: adult older woman, close, gentle, soft endings, and restrained breath. The one-month rotation therefore changed small adjectives while keeping the strongest conditioning words fixed. The reference script also described bedtime comfort, so it gave each profile the same acting situation.

The 2026-11-11 reference recordings were re-measured with the current `voice_physics.py` through the locked `uv` environment. They were generated with the same checkpoint and the same reference text. The first two use the same `high_bright` caption but different run-derived seeds.

| Run | Caption family | F0 median | Spectral centroid | Rolloff 85% | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `yawa-2026-11-11` | high_bright | 258.5 Hz | 889 Hz | 1,075 Hz | below its 270–280 Hz prompt target |
| `yawa-2026-11-11-highbright` | high_bright | 315.4 Hz | 973 Hz | 1,225 Hz | same caption; different seed, above the target |
| `yawa-2026-11-11-nasalclear` | nasal_clear | 262.4 Hz | 1,020 Hz | 1,400 Hz | nasal quality itself was not measured |
| `yawa-2026-11-11-sweetround` | sweet_round | 235.9 Hz | 1,061 Hz | 1,500 Hz | sweetness itself was not measured |

The F0 and spectrum measurements show that the numeric F0 prompt was not reliably reproduced. They do not prove how similar the voices sound: four global measurements do not model perceived identity or preference. The F1–F3 values available without vowel alignment are exploratory only. No blinded listening scores exist yet.

The previous evaluator also had no calibrated measurement for sweetness, age impression, or nasal resonance. Those are perceptual qualities. A1–P0 needs controlled vowel intervals and becomes unreliable in this high-F0 range; unsegmented Burg formants cross vowels and consonant transitions. The available whole-clip measurements are useful observations, not a voice-quality verdict.

## First-principles model

Treat voice as several interacting layers rather than a single “high and sweet” number:

1. **Source and phonation:** F0 range and contour, vocal weight, breathiness, roughness, and pressed or relaxed onset.
2. **Resonance and articulation:** forward versus dark/round resonance, nasal coupling, vowel shape, consonant sharpness, and spectral tilt. Formants describe vocal-tract resonances; F0 does not stand in for them.
3. **Delivery:** speaking rate, pauses, phrase-final contours, loudness range, whisper versus voiced speech, and emotional intensity.
4. **Perception:** labels such as “sweet,” “mature,” or “anime-like” need blind human ratings. Acoustic measurements can explain variation but cannot define those labels alone.

PromptTTS++ separates speaker identity descriptions from utterance-level style prompts; its results report that style-only prompts did not adequately distinguish speaker individuality. A study on perceptual voice-quality control treats roughness, breathiness, resonance, and weight as separate dimensions and learns them from examples instead of assuming a single acoustic proxy. Irodori v4 accepts both a reference waveform and caption conditioning, so they should be tested separately and together: hold text/seed fixed while changing one condition, then repeat across seeds. The current reference-first workflow changes the caption and seed together, which cannot tell whether a difference came from the design or sampling noise.

The expanded seven-profile YAML now uses broader combinations of pitch, resonance, phonation, articulation, and prosody. It removes the repeated “older, gentle, close, soft-ending” anchor. The diagnostic reference text is now neutral conversation with varied vowels, sibilants, statements, and questions. F0, spectrum, and formants remain advisory measurements; they do not block preparation or publication.

## Commercial-market keyword sample

ASMR Den’s public tag catalogue reports work counts, not sales counts. Its sleep-aid subset contains 168 indexed works and exposes related-tag counts. The tags overlap, so percentages below are the count divided by 168 and are not mutually exclusive market shares.

| Keyword on the sleep-aid page | Works | Share of the 168-item subset |
| --- | ---: | ---: |
| ささやき | 145 | 86.3% |
| 耳かき | 124 | 73.8% |
| リラックス | 91 | 54.2% |
| 癒し | 82 | 48.8% |
| バイノーラル | 68 | 40.5% |
| 添い寝 | 33 | 19.6% |
| 優しい声 | 32 | 19.0% |
| 彼女ロールプレイ | 32 | 19.0% |
| 膝枕 | 27 | 16.1% |
| 甘い | 26 | 15.5% |

Across the full catalogue, the largest visible counts include whispering (673), ear cleaning (558), healing (411), consolation (331), binaural (316), relaxation (293), sleep induction (163), co-sleeping (152), girlfriend roleplay (149), lap pillow (146), gentle voice (139), affection (114), intimacy (101), massage (101), ear massage (100), romance (94), daily life (84), and ear blowing (81). These are third-party catalogue counts; translated or duplicate labels can overlap.

DLsite’s own 2020 award release highlights gentle whispering, massage, and ear cleaning in its winning work. Its ear-cleaning award notes variation in tools/materials, pressure, which ear area is cared for, and whether speech is present. Its healing award uses a dream-train setting with hair washing and head/face massage. The 2021 award highlights ear cleaning, massage, cotton swabs, and whispering. This supports varying both the scene premise and the concrete trigger/action, instead of rotating only a room and prop.

The YAML pattern pool uses these public genre keywords as discovery inputs, not as copied titles or plots. It includes adult-only care, companionship, travel, sound walks, radio letters, and light comedy. The source catalogue also contains age-coded and sexualized tags; those were excluded. “Binaural” was not added as an output tag because the current Yawa audio pipeline renders mono.

Sampling weights are frequency tiers (5/4/3/2/1), not estimated sales shares. Selection is history-aware: patterns with lower observed usage relative to their YAML weight are favored, with a deterministic run-name tie break. Every selected pattern and its keyword list are snapshotted into `selection.json`. Compatible story shapes prevent a treatment scene from being forced into a mystery arc. No new release gate was added.

## Limits and next learning step

- The ASMR Den counts describe that aggregator’s catalog; they do not establish what sells or what the Yawa audience prefers.
- The current voice metrics are not a voice-identity embedding and do not measure nasal resonance or perceived sweetness reliably.
- The daily profile caption is still an instruction, not a guaranteed control. Record the caption, seed, reference hash, F0, spectrum, formants, and ASR score; keep all measurements advisory.
- After about one month, collect the owner’s blind preference ratings by run ID. Keep “liked voice,” “liked scene,” and overall preference separate so voice changes are not confused with story changes.

## Sources

- [ASMR Den — sleep-aid tag and related work counts](https://asmrden.com/tags/sleep-aid)
- [ASMR Den — public tag catalogue](https://asmrden.com/tags)
- [Eisys/DLsite — 2020 DLsite ASMR Award release](https://media.eisys.co.jp/public/uploads/20210128_asmrawrds_press.pdf)
- [Eisys/DLsite — 2021 DLsite Award release](https://media.eisys.co.jp/public/uploads/20220210_DLsite_press.pdf)
- [PromptTTS++: Controlling Speaker Identity in Prompt-Based Text-to-Speech Using Natural Language Descriptions](https://arxiv.org/abs/2309.08140)
- [Speech Synthesis along Perceptual Voice Quality Dimensions](https://arxiv.org/abs/2501.08791)
- [Irodori-TTS parameter guide](https://github.com/Aratako/Irodori-TTS/blob/main/docs/parameters.md)
