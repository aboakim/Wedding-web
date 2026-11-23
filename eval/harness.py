"""Metrics harness: precision / recall / F1, PR curve, threshold sweep, operating points.

Usage (one reproducible command):
  .venv/bin/python eval/harness.py --run eval/out/baseline --labels eval/out/labels

Inputs
  --run      a run directory with faces.npz + faces.csv (from eval/run_baseline.py)
  --labels   directory with labels_<target>.csv (filename,contains_target,notes)
  --split    eval/split.json; created once (seeded, stratified, by photo) if missing,
             then reused so every change is measured on the same photos.
Scoring mirrors lib/match.js: photo score = max cosine over its faces; a photo
with no detected face can never match (score = -1).
Thresholds are tuned on the TUNE split only; final numbers are on TEST.
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
    npz = np.load(run / "faces.npz")
    photos = npz["photo"]
    E = npz["embeddings"]
    scores = {}
    for key in targets:
        if f"ref_{key}" not in npz:
            continue
        sims = E @ npz[f"ref_{key}"]
        best = {}
        for p, s in zip(photos, sims):
            best[str(p)] = max(best.get(str(p), -1.0), float(s))
        scores[key] = best
    return scores


def load_labels(folder, key, excluded):
    path = folder / f"labels_{key}.csv"
    if not path.exists():
        return None
    out = {}
    for row in csv.DictReader(open(path)):
        if row["filename"] in excluded or row["contains_target"] not in ("0", "1"):
            continue
        out[row["filename"]] = int(row["contains_target"])
    return out


def make_split(path, photos, positive_any, seed=20261123, tune_frac=0.6):
    rng = random.Random(seed)
    pos = sorted(p for p in photos if positive_any.get(p))
    neg = sorted(p for p in photos if not positive_any.get(p))
    rng.shuffle(pos)
    rng.shuffle(neg)
    tune = pos[: round(len(pos) * tune_frac)] + neg[: round(len(neg) * tune_frac)]
    split = {p: ("tune" if p in set(tune) else "test") for p in photos}
    path.write_text(json.dumps({"seed": seed, "tune_frac": tune_frac, "split": split}, indent=0, sort_keys=True))
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="eval/out/baseline")
    ap.add_argument("--labels", default="eval/out/labels")
    ap.add_argument("--targets", default="eval/targets.json")
    ap.add_argument("--split", default="eval/split.json")
    ap.add_argument("--min-precision", type=float, default=TARGET_PRECISION)
    args = ap.parse_args()
    run, labels_dir = Path(args.run), Path(args.labels)
    targets = json.loads(Path(args.targets).read_text())
    scores = load_scores(run, targets)

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
        positive_any = {p: any(l.get(p) == 1 for l in labels.values()) for p in photos}
        split = make_split(split_path, photos, positive_any)

    # Flatten (target, photo) pairs.
    data = {"tune": [], "test": []}
    for key, lab in labels.items():
        for photo, y in lab.items():
            part = split.get(photo)
            if part is None:
                continue
            data[part].append((key, photo, y, scores[key].get(photo, -1.0)))

    out = run / "metrics"
    out.mkdir(exist_ok=True)
    report = {"labels": {k: {"photos": len(v), "positives": sum(v.values())} for k, v in labels.items()},
              "split": {p: len(rows) for p, rows in data.items()}}

    arrays = {}
    for part, rows in data.items():
        y = np.asarray([r[2] for r in rows])
        s = np.asarray([r[3] for r in rows])
        pid = np.asarray([r[1] for r in rows])
        arrays[part] = (y, s, pid, rows)
        sw = sweep(y, s)
        write_csv(out / f"sweep_{part}.csv", sw)
        order = np.argsort(-s)
        tp = np.cumsum(y[order] == 1)
        fp = np.cumsum(y[order] == 0)
        pr = [{"threshold": round(float(s[order][i]), 4), "precision": round(float(tp[i] / (tp[i] + fp[i])), 4),
               "recall": round(float(tp[i] / max(1, y.sum())), 4)} for i in range(len(order))]
        write_csv(out / f"pr_{part}.csv", pr)

    y_tune, s_tune, _, _ = arrays["tune"]
    sw_tune = sweep(y_tune, s_tune)
    chosen = recall_at_precision(sw_tune, args.min_precision)
    tuned_t = chosen["threshold"] if chosen else PRODUCTION_THRESHOLD

    y, s, pid, rows = arrays["test"]
    sw_test = sweep(y, s)
    positives_no_face = int(np.sum((y == 1) & (s <= -1.0)))
    report["test"] = {
        "at_production_0.40": evaluate(y, s, pid, PRODUCTION_THRESHOLD),
        f"at_tuned_threshold (max recall with tune precision >= {args.min_precision})": evaluate(y, s, pid, tuned_t),
        "recall_at_precision_0.95": recall_at_precision(sw_test, 0.95),
        "recall_at_precision_0.99": recall_at_precision(sw_test, 0.99),
        "precision_at_recall_0.90": precision_at_recall(sw_test, 0.90),
        "positives": int(y.sum()),
        "positives_with_no_detected_face_in_photo": positives_no_face,
        "recall_ceiling_if_threshold_were_lowest": round(float(np.mean(s[y == 1] > -1.0)), 4) if y.sum() else None,
        "per_target_at_tuned": {},
    }
    for key in labels:
        m = np.asarray([r[0] == key for r in rows])
        if m.any():
            tp, fp, fn = confusion(y[m], s[m], tuned_t)
            p, r, f = prf(tp, fp, fn)
            report["test"]["per_target_at_tuned"][key] = {"tp": tp, "fp": fp, "fn": fn, "precision": round(p, 4),
                                                         "recall": round(r, 4), "f1": round(f, 4)}
    report["tuned_threshold"] = tuned_t
    (out / "report.json").write_text(json.dumps(report, indent=2))

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    for part, style in (("tune", "--"), ("test", "-")):
        sw = sweep(*arrays[part][:2])
        axes[0].plot([r["recall"] for r in sw], [r["precision"] for r in sw], style, label=part)
        axes[1].plot(SWEEP, [r["precision"] for r in sw], style, label=f"precision ({part})")
        axes[1].plot(SWEEP, [r["recall"] for r in sw], style, label=f"recall ({part})")
    axes[0].set(xlabel="recall", ylabel="precision", title="PR curve (threshold sweep)", xlim=(0, 1.02), ylim=(0, 1.02))
    axes[0].legend()
    for t, lab in ((PRODUCTION_THRESHOLD, "production 0.40"), (tuned_t, f"tuned {tuned_t:.2f}")):
        axes[1].axvline(t, color="grey", lw=0.8, ls=":")
        axes[1].text(t, 0.02, lab, rotation=90, fontsize=8)
    axes[1].set(xlabel="cosine threshold", title="Threshold sweep", ylim=(0, 1.02))
    axes[1].legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(out / "pr.png", dpi=130)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
