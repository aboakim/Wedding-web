# Evaluation changelog

Album: one wedding, 471 JPEGs (mostly 6720×4480). Targets: T1, T2 (car selfie, one reference
each), T3 (album photo RAFO3389, excluded from scoring). Labels: 3 classes
(1 show, 2 present-but-background, 0 absent), see `eval/convert_labels.py`.
Split: `eval/split.json` (seed 20261123, 283 tune / 188 test photos). All numbers are on the
**TEST split**, threshold 0.40 unless noted. Test set: 9 "show" positives, 14 "present"
positives, so 95% CIs are wide; differences under ~20–30 points are within noise.

- **Main** = main-gallery task (positive = class 1).
- **Presence** = recognition task (positive = class 1 or 2).
- **Runtime** = engine time for the whole album on CPU (M4 Pro), excluding image preprocessing (≈17 s).

Reproduce a row: `node eval/preprocess.mjs <album> eval/out/pre <refs…>`,
`.venv/bin/python eval/run_baseline.py eval/out/pre eval/out/<run>`,
`.venv/bin/python eval/harness.py --run eval/out/<run>`.

| # | Change | Precision (main / presence) | Recall (main / presence) | F1 (main / presence) | Runtime | Commit | Keep/Revert |
|---|---|---|---|---|---|---|---|
| 0 | Baseline (production pipeline as of `96447c6`) | 0.750 / 1.000 | 1.000 / 0.857 | 0.857 / 0.923 | 65.4 s | `96447c6` | – |
| 1 | #2 Return scores, results sorted best-first (SQL parity verified: same sets, Δscore ≤ 6e-8, 0.4 s/search) | 0.750 / 1.000 | 1.000 / 0.857 | 0.857 / 0.923 | 65.4 s (unchanged) | `779e3af` | Keep (no metric change expected) |
| 2 | #1a Two sections by face focus at original resolution (sharp_orig ≥ 32.75, cutoff tuned on TUNE where it scored main F1 1.00). TEST: background-in-main 3 → 3, show demoted 0. Extra cost ≈ 32 s/album (reads originals) | 0.750 / 1.000 | 1.000 / 0.857 | 0.857 / 0.923 | 65.4 s + 31.8 s | `e06cc86` | **Revert** (no TEST gain; rule overfit 6 TUNE background photos) |
| 3 | #3 Pick-your-face for multi-face references. Usable references 0/3 → 3/3 (production previously rejected all with "multiple"); tapped face = harness reference (cos 1.0000); album scores byte-identical | 0.750 / 1.000 | 1.000 / 0.857 | 0.857 / 0.923 | 64.6 s (unchanged) | `56f7f47` | Keep (product blocker fixed; metrics unaffected by design) |
