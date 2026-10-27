# BYLINE evaluation report

`2026-10-20T22:01:30` · commit `fd85197` · seeds golden [2026, 11, 12, 13, 14] / ordinary [7341, 21, 22, 23, 24]

**OFFLINE RUN:** scenarios 10 | events total 26063 | event reducer failures 0

| Detector | TP | FP | FN | Precision | Recall |
|---|---|---|---|---|---|
| repeated_channel_attack | 4 | 7 | 1 | 0.364 | 0.8 |
| counterattack | 8 | 24 | 2 | 0.25 | 0.8 |
| overlap | 4 | 1 | 1 | 0.8 | 0.8 |

_Thresholds were tuned only on the dev seeds (golden 2026, ordinary 7341). Seeds 11-14 and 21-24 are held out and were not used for tuning._

| Split | Detector | TP | FP | FN |
|---|---|---|---|---|
| dev | repeated_channel_attack | 1 | 0 | 0 |
| dev | counterattack | 2 | 3 | 0 |
| dev | overlap | 1 | 0 | 0 |
| held_out | repeated_channel_attack | 3 | 7 | 1 |
| held_out | counterattack | 6 | 21 | 2 |
| held_out | overlap | 3 | 1 | 1 |

_Labels are authored motifs only. 'Unlabelled detections' meet the detector definition in generic simulated play but were not authored, so they are counted as false positives._

**Unlabelled detections / misses per run**

- golden_story seed 2026: 6 candidates, labels 4, unlabelled ["counterattack@57'/NBA", "counterattack@71'/NBA"], missed none
- golden_story seed 11: 7 candidates, labels 4, unlabelled ["counterattack@3'/RVC", "counterattack@28'/NBA", "repeated_channel_attack@50'/NBA"], missed none
- golden_story seed 12: 5 candidates, labels 4, unlabelled ["repeated_channel_attack@22'/RVC", "counterattack@28'/NBA"], missed ['counterattack/RVC']
- golden_story seed 13: 6 candidates, labels 4, unlabelled ["counterattack@28'/NBA", "counterattack@32'/RVC"], missed none
- golden_story seed 14: 5 candidates, labels 4, unlabelled ["counterattack@1'/RVC", "counterattack@12'/RVC", "counterattack@23'/RVC", "counterattack@66'/NBA"], missed ['repeated_channel_attack/NBA', 'counterattack/RVC', 'overlap/NBA']
- ordinary_match seed 7341: 1 candidates, labels 0, unlabelled ["counterattack@37'/RVC"], missed none
- ordinary_match seed 21: 2 candidates, labels 0, unlabelled ["counterattack@72'/RVC", "counterattack@90+2'/NBA"], missed none
- ordinary_match seed 22: 6 candidates, labels 0, unlabelled ["counterattack@3'/RVC", "counterattack@10'/RVC", "repeated_channel_attack@25'/NBA", "counterattack@58'/NBA", "counterattack@64'/RVC", "counterattack@70'/RVC"], missed none
- ordinary_match seed 23: 4 candidates, labels 0, unlabelled ["repeated_channel_attack@36'/NBA", "counterattack@36'/NBA", "counterattack@64'/RVC", "repeated_channel_attack@90+3'/RVC"], missed none
- ordinary_match seed 24: 6 candidates, labels 0, unlabelled ["repeated_channel_attack@14'/NBA", "counterattack@24'/RVC", "repeated_channel_attack@35'/RVC", "counterattack@69'/NBA", "overlap@85'/NBA", "counterattack@90'/NBA"], missed none

**REFEREE MATRIX:** 18 passed in 0.72s

**AGENTS:** provider Microsoft Foundry (gpt-4.1-mini) via Microsoft Agent Framework | runs 4 | verified 3 | not verified 1 | schema failures 0 | validator issues caught 2 | case latency p50/p95 18536/23482 ms (measured)

**COST:** 23 real model calls, 43957 tokens across recorded runs (gpt-4.1-mini; token counts as reported by the service).

**TESTS:** full suite 110 passed, 1 deselected in 24.03s; agent orchestration (test mocks) 11 passed in 3.04s

**UI / DEPLOY:** not measured by this script.

**LIMITATIONS:** synthetic data only; labels are authored motifs; player-centre tracking cannot adjudicate marginal offside; agent quality measured on a small number of real runs.
