"""Metrics harness: precision / recall / F1, PR curve, threshold sweep, operating points.

Usage (one reproducible command):
  .venv/bin/python eval/harness.py --run eval/out/baseline --labels eval/out/labels

Inputs
  --run      a run directory with faces.npz + faces.csv (from eval/run_baseline.py)
  --labels   directory with labels_<target>.csv (filename,contains_target,notes)
  --split    eval/split.json; created once (seeded, stratified, by photo) if missing,
             then reused so every change is measured on the same photos.
Labels have 3 classes (see eval/convert_labels.py): 1 = show in main gallery,
2 = present but background, 0 = absent. Two tasks are scored:
  presence  positive = class 1 or 2  (is the matcher finding the person?)
  show      positive = class 1       (would the main gallery be right?)
Scoring mirrors lib/match.js: photo score = max cosine over its faces; a photo
with no detected face can never match (score = -1).
The threshold is tuned on the TUNE split (presence task) only; final numbers
are on TEST. "all_labeled" numbers are context only (they include tune photos).
Outputs go to <run>/metrics/: sweep_<split>.csv, pr_<split>.csv, report.json, pr.png.
"""

import argparse
import csv
import json
import random
from pathlib import Path

import numpy as np

TARGET_PRECISION = 0.90
SWEEP = np.round(np.arange(0.10, 0.801, 0.01), 2)
PRODUCTION_THRESHOLD = 0.40


def load_scores(run, targets):
    """Per target: {photo: best score} and {photo: row index of the best face}."""
    npz = np.load(run / "faces.npz")
    photos = npz["photo"]
    E = npz["embeddings"]
    scores, best_face = {}, {}
    for key in targets:
        if f"ref_{key}" not in npz:
            continue
        sims = E @ npz[f"ref_{key}"]
        best, where = {}, {}
        for i, (p, s) in enumerate(zip(photos, sims)):
            if float(s) > best.get(str(p), -2.0):
                best[str(p)], where[str(p)] = float(s), i
        scores[key], best_face[key] = best, where
    return scores, best_face


def evaluate_pred(y, pred, pid, n=2000, seed=7):
    """P/R/F1 for an explicit prediction vector, with photo-resampled 95% CI."""
    def stats(idx):
        tp = int(np.sum(pred[idx] & (y[idx] == 1)))
        fp = int(np.sum(pred[idx] & (y[idx] == 0)))
        fn = int(np.sum(~pred[idx] & (y[idx] == 1)))
        return (tp, fp, fn), prf(tp, fp, fn)
    (tp, fp, fn), (p, r, f) = stats(np.arange(len(y)))
    rng = np.random.default_rng(seed)
    uniq = np.unique(pid)
    index = {u: np.where(pid == u)[0] for u in uniq}
    boot = np.asarray([stats(np.concatenate([index[u] for u in rng.choice(uniq, len(uniq))]))[1] for _ in range(n)])
    lo, hi = np.percentile(boot, [2.5, 97.5], axis=0)
    return {"tp": tp, "fp": fp, "fn": fn, "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "ci95": {m: [round(float(lo[i]), 3), round(float(hi[i]), 3)] for i, m in enumerate(["precision", "recall", "f1"])}}


def load_labels(folder, key, excluded):
    path = folder / f"labels_{key}.csv"
    if not path.exists():
        return None
    out = {}
    for row in csv.DictReader(open(path)):
        if row["filename"] in excluded or row["contains_target"] not in ("0", "1", "2"):
            continue
        out[row["filename"]] = int(row["contains_target"])
    return out


def make_split(path, photos, stratum, seed=20261123, tune_frac=0.6):
    """Photo-level split, stratified so each split gets its share of rare classes."""
    rng = random.Random(seed)
    tune = set()
    for key in sorted(set(stratum.values())):
        group = sorted(p for p in photos if stratum[p] == key)
        rng.shuffle(group)
        tune.update(group[: round(len(group) * tune_frac)])
    split = {p: ("tune" if p in tune else "test") for p in photos}
    path.write_text(json.dumps({"seed": seed, "tune_frac": tune_frac, "stratified_by": "show > background > absent",
                                "split": split}, indent=0, sort_keys=True))
    return split


def confusion(y, s, t):
    pred = s >= t
    tp = int(np.sum(pred & (y == 1)))
    fp = int(np.sum(pred & (y == 0)))
    fn = int(np.sum(~pred & (y == 1)))
    return tp, fp, fn


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def sweep(y, s):
    rows = []
    for t in SWEEP:
        tp, fp, fn = confusion(y, s, t)
        p, r, f = prf(tp, fp, fn)
        rows.append({"threshold": float(t), "tp": tp, "fp": fp, "fn": fn,
                     "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4)})
    return rows


def recall_at_precision(rows, target):
    ok = [r for r in rows if r["precision"] >= target and r["tp"] > 0]
    return max(ok, key=lambda r: (r["recall"], r["threshold"])) if ok else None


def precision_at_recall(rows, target):
    ok = [r for r in rows if r["recall"] >= target]
    return max(ok, key=lambda r: (r["precision"], r["threshold"])) if ok else None


def bootstrap(y, s, photo_ids, t, n=2000, seed=7):
    """95% CI by resampling photos (all targets of a photo move together)."""
    rng = np.random.default_rng(seed)
    uniq = np.unique(photo_ids)
    index = {p: np.where(photo_ids == p)[0] for p in uniq}
    stats = []
    for _ in range(n):
        pick = rng.choice(uniq, size=len(uniq), replace=True)
        idx = np.concatenate([index[p] for p in pick])
        stats.append(prf(*confusion(y[idx], s[idx], t)))
    arr = np.asarray(stats)
    lo, hi = np.percentile(arr, [2.5, 97.5], axis=0)
    return {m: [round(float(lo[i]), 3), round(float(hi[i]), 3)] for i, m in enumerate(["precision", "recall", "f1"])}


def evaluate(y, s, photo_ids, t):
    tp, fp, fn = confusion(y, s, t)
    p, r, f = prf(tp, fp, fn)
    return {"threshold": round(float(t), 2), "tp": tp, "fp": fp, "fn": fn,
            "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4),
            "ci95": bootstrap(y, s, photo_ids, t)}


def write_csv(path, rows):
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def task_arrays(rows, task):
    c = np.asarray([r[2] for r in rows])
    y = (c > 0).astype(int) if task == "presence" else (c == 1).astype(int)
    s = np.asarray([r[3] for r in rows])
    pid = np.asarray([r[1] for r in rows])
    return y, s, pid, c


def pr_rows(y, s):
    order = np.argsort(-s)
    tp = np.cumsum(y[order] == 1)
    fp = np.cumsum(y[order] == 0)
    return [{"threshold": round(float(s[order][i]), 4), "precision": round(float(tp[i] / (tp[i] + fp[i])), 4),
             "recall": round(float(tp[i] / max(1, y.sum())), 4)} for i in range(len(order))]


def task_report(rows, task, tuned_t, labels):
    y, s, pid, c = task_arrays(rows, task)
    sw = sweep(y, s)
    rep = {
        "positives": int(y.sum()),
        "at_production_0.40": evaluate(y, s, pid, PRODUCTION_THRESHOLD),
        "at_tuned": evaluate(y, s, pid, tuned_t),
        "recall_at_precision_0.95": recall_at_precision(sw, 0.95),
        "recall_at_precision_0.99": recall_at_precision(sw, 0.99),
        "precision_at_recall_0.90": precision_at_recall(sw, 0.90),
        "positives_with_no_detected_face": int(np.sum((y == 1) & (s <= -1.0))),
        "per_target_at_tuned": {},
    }
    if task == "show":
        # Background photos (class 2) that a single-tier gallery would put in the main gallery.
        rep["background_in_main_gallery_at_tuned"] = int(np.sum((c == 2) & (s >= tuned_t)))
        rep["background_total"] = int(np.sum(c == 2))
    for key in labels:
        m = np.asarray([r[0] == key for r in rows])
        if m.any():
            p, r, f = prf(*confusion(y[m], s[m], tuned_t))
            tp, fp, fn = confusion(y[m], s[m], tuned_t)
            rep["per_target_at_tuned"][key] = {"positives": int(y[m].sum()), "tp": tp, "fp": fp, "fn": fn,
                                               "precision": round(p, 4), "recall": round(r, 4), "f1": round(f, 4)}
    return rep, sw


def two_sections(run, data, match_t, feature, fixed_cutoff=None):
    """Main gallery = score >= match_t AND feature(best face) >= cutoff; the rest of
    the matches go to the second section. Cutoff tuned on TUNE (main-gallery F1;
    middle of the best-F1 range) unless fixed."""
    q = [float(r[feature]) for r in csv.DictReader(open(run / "face_quality.csv"))]

    def arrays(rows):
        c = np.asarray([r[2] for r in rows])
        s = np.asarray([r[3] for r in rows])
        v = np.asarray([q[r[4]] if r[4] is not None else -1.0 for r in rows])
        return c, s, v, np.asarray([r[1] for r in rows])

    def main_pred(s, v, cut):
        return (s >= match_t) & (v >= cut)

    c, s, v, _ = arrays(data["tune"])
    grid = np.round(np.arange(0, 300.01, 0.5), 1)
    f1s = np.asarray([prf(*confusion_pred((c == 1).astype(int), main_pred(s, v, g)))[2] for g in grid])
    best = np.flatnonzero(np.isclose(f1s, f1s.max()))
    run_end = best[0]
    while run_end + 1 in set(best):
        run_end += 1
    cutoff = fixed_cutoff if fixed_cutoff is not None else float((grid[best[0]] + grid[run_end]) / 2)

    out = {"feature": feature, "match_threshold": match_t, "cutoff": cutoff,
           "cutoff_rule": "fixed" if fixed_cutoff is not None else
           f"middle of best TUNE main-F1 range [{grid[best[0]]}, {grid[run_end]}]"}
    for part in ("tune", "test"):
        c, s, v, pid = arrays(data[part])
        main = main_pred(s, v, cutoff)
        second = (s >= match_t) & ~main
        out[part] = {
            "main_gallery": evaluate_pred((c == 1).astype(int), main, pid),
            "show_photos_demoted_to_second": int(np.sum((c == 1) & second)),
            "show_photos_not_found": int(np.sum((c == 1) & (s < match_t))),
            "background_in_main": int(np.sum((c == 2) & main)),
            "background_in_second": int(np.sum((c == 2) & second)),
            "background_not_found": int(np.sum((c == 2) & (s < match_t))),
            "wrong_person_anywhere": int(np.sum((c == 0) & (s >= match_t))),
        }
    return out


def confusion_pred(y, pred):
    return (int(np.sum(pred & (y == 1))), int(np.sum(pred & (y == 0))), int(np.sum(~pred & (y == 1))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="eval/out/baseline")
    ap.add_argument("--labels", default="eval/out/labels3")
    ap.add_argument("--targets", default="eval/targets.json")
    ap.add_argument("--split", default="eval/split.json")
    ap.add_argument("--min-precision", type=float, default=TARGET_PRECISION)
    ap.add_argument("--tier-feature", help="column of <run>/face_quality.csv; enables the two-section rule")
    ap.add_argument("--tier-cutoff", type=float, help="fixed cutoff (default: tuned on TUNE)")
    args = ap.parse_args()
    run, labels_dir = Path(args.run), Path(args.labels)
    targets = json.loads(Path(args.targets).read_text())
    scores, best_face = load_scores(run, targets)

    labels = {}
    for key, spec in targets.items():
        lab = load_labels(labels_dir, key, set(spec.get("exclude", [])))
        if lab:
            labels[key] = lab
    if not labels:
        raise SystemExit(f"no labels_<target>.csv found in {labels_dir}")

    split_path = Path(args.split)
    if split_path.exists():
        split = json.loads(split_path.read_text())["split"]
    else:
        photos = sorted(set().union(*[set(l) for l in labels.values()]))
        def stratum(p):
            vals = [l.get(p, 0) for l in labels.values()]
            return "show" if 1 in vals else "background" if 2 in vals else "absent"
        split = make_split(split_path, photos, {p: stratum(p) for p in photos})

    data = {"tune": [], "test": []}
    for key, lab in labels.items():
        for photo, cls in lab.items():
            part = split.get(photo)
            if part is not None:
                data[part].append((key, photo, cls, scores[key].get(photo, -1.0), best_face[key].get(photo)))
    every = data["tune"] + data["test"]

    out = run / "metrics"
    out.mkdir(exist_ok=True)

    # Tune on the presence task, tune split only.
    y_t, s_t, _, _ = task_arrays(data["tune"], "presence")
    chosen = recall_at_precision(sweep(y_t, s_t), args.min_precision)
    tuned_t = chosen["threshold"] if chosen else PRODUCTION_THRESHOLD

    report = {
        "run": str(run),
        "labels": {k: {"show": sum(v == 1 for v in l.values()), "background": sum(v == 2 for v in l.values()),
                       "absent": sum(v == 0 for v in l.values())} for k, l in labels.items()},
        "pairs": {p: len(r) for p, r in data.items()},
        "tuned_threshold": tuned_t,
        "tuning_rule": f"max recall on TUNE presence task with precision >= {args.min_precision}",
        "test": {},
        "all_labeled_context_only": {},
    }
    sweeps = {}
    for task in ("presence", "show"):
        report["test"][task], sweeps[("test", task)] = task_report(data["test"], task, tuned_t, labels)
        report["all_labeled_context_only"][task], _ = task_report(every, task, tuned_t, labels)
        y, s, _, _ = task_arrays(data["tune"], task)
        sweeps[("tune", task)] = sweep(y, s)
        for part in ("tune", "test"):
            write_csv(out / f"sweep_{task}_{part}.csv", sweeps[(part, task)])
            y, s, _, _ = task_arrays(data[part], task)
            write_csv(out / f"pr_{task}_{part}.csv", pr_rows(y, s))
    if args.tier_feature:
        report["two_sections"] = two_sections(run, data, PRODUCTION_THRESHOLD, args.tier_feature, args.tier_cutoff)
    (out / "report.json").write_text(json.dumps(report, indent=2))

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    for (part, task), sw in sorted(sweeps.items()):
        style = "-" if part == "test" else "--"
        axes[0].plot([r["recall"] for r in sw], [r["precision"] for r in sw], style, label=f"{task} ({part})")
        if part == "test":
            axes[1].plot(SWEEP, [r["precision"] for r in sw], style, label=f"precision {task}")
            axes[1].plot(SWEEP, [r["recall"] for r in sw], style, label=f"recall {task}")
    axes[0].set(xlabel="recall", ylabel="precision", title="PR curve (threshold sweep)", xlim=(0, 1.02), ylim=(0, 1.02))
    axes[0].legend(fontsize=8)
    for t, lab in ((PRODUCTION_THRESHOLD, "production 0.40"), (tuned_t, f"tuned {tuned_t:.2f}")):
        axes[1].axvline(t, color="grey", lw=0.8, ls=":")
        axes[1].text(t, 0.02, lab, rotation=90, fontsize=8)
    axes[1].set(xlabel="cosine threshold", title="Threshold sweep (test)", ylim=(0, 1.02))
    axes[1].legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out / "pr.png", dpi=130)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
