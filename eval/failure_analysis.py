"""Failure analysis: describe every error and the target face vs the other faces.

Usage:
  .venv/bin/python eval/failure_analysis.py --run eval/out/baseline --labels eval/out/labels3 \
      --album /path/to/album [--diagnose]

For every (target, photo) that is labeled present (class 1/2) or scores >= 0.30,
take the target's best-matching face and compute, at ORIGINAL resolution:
  side_det    face side in px as the detector saw it (640 px scale)
  rel_size    face side / largest face side in the same photo
  sharp       Laplacian variance of the face crop resized to 128x128 (focus)
  rel_sharp   sharp / sharpest face in the same photo
  bright      mean grey level of the face crop (low light)
  yaw         nose offset from the eye midpoint / eye distance (|yaw| > 0.5 ~ profile)
  centre      distance of the face centre from the image centre (0 = centre, 1 = corner)
  n_faces     faces detected in the photo
--diagnose re-detects missed photos at 2x resolution with det_thresh 0.3 to tell
detection/resolution failures from embedding failures (analysis only).
Writes <run>/analysis/cases.csv and prints a summary. Prints filenames and boxes only.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))

THRESHOLD = 0.40
CATEGORY_RULES = {
    "small_face (<16px at detector)": lambda r: r["side_det"] < 16,
    "profile (|yaw|>0.5)": lambda r: abs(r["yaw"]) > 0.5,
    "blur (sharp<30)": lambda r: r["sharp"] < 30,
    "low_light (bright<70)": lambda r: r["bright"] < 70,
    "group_shot (>=6 faces)": lambda r: r["n_faces"] >= 6,
    "not_main_face (rel_size<0.6)": lambda r: r["rel_size"] < 0.6,
    "out_of_focus_vs_others (rel_sharp<0.3)": lambda r: r["rel_sharp"] < 0.3,
}


def sharpness(gray, box, scale):
    x1, y1, x2, y2 = [int(round(v * scale)) for v in box]
    h, w = gray.shape
    crop = gray[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]
    if crop.size == 0:
        return 0.0, 0.0
    small = cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(small, cv2.CV_64F).var()), float(small.mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="eval/out/baseline")
    ap.add_argument("--labels", default="eval/out/labels3")
    ap.add_argument("--pre", default="eval/out/pre")
    ap.add_argument("--album", required=True)
    ap.add_argument("--targets", default="eval/targets.json")
    ap.add_argument("--split", default="eval/split.json")
    ap.add_argument("--diagnose", action="store_true")
    args = ap.parse_args()
    run, album = Path(args.run), Path(args.album)
    targets = json.loads(Path(args.targets).read_text())
    split = json.loads(Path(args.split).read_text())["split"]
    meta = json.loads((Path(args.pre) / "meta.json").read_text())
    npz = np.load(run / "faces.npz")
    E, P = npz["embeddings"], npz["photo"]
    faces = list(csv.DictReader(open(run / "faces.csv")))
    by_photo = {}
    for i, r in enumerate(faces):
        by_photo.setdefault(r["photo"], []).append(i)

    # Keypoints are not in faces.csv; re-derive yaw from a fresh detection only for analysed photos.
    import face_server as fs
    fs.load()

    cases = []
    cache = {}
    for key, spec in targets.items():
        ref = npz[f"ref_{key}"]
        sims = E @ ref
        labels = {r["filename"]: int(r["contains_target"]) for r in csv.DictReader(open(Path(args.labels) / f"labels_{key}.csv"))}
        for photo, cls in labels.items():
            idx = by_photo.get(photo, [])
            score = float(max(sims[i] for i in idx)) if idx else -1.0
            if cls == 0 and score < 0.30:
                continue
            if photo not in cache:
                info = meta[f"album/{photo}"]
                scale = info["orig_w"] / info["pre_w"]
                gray = cv2.imread(str(album / photo), cv2.IMREAD_GRAYSCALE)
                assert gray.shape[1] == info["orig_w"], f"orientation mismatch {photo}"
                per_face = []
                for i in idx:
                    r = faces[i]
                    box = [float(r[k]) for k in ("x1", "y1", "x2", "y2")]
                    sh, br = sharpness(gray, box, scale)
                    per_face.append({"i": i, "box": box, "side": min(box[2] - box[0], box[3] - box[1]),
                                     "sharp": sh, "bright": br})
                image = fs.decode((Path(args.pre) / "album" / photo).read_bytes())
                found, _ = fs.select_faces(fs.engine.get(image), "album")
                cache[photo] = (per_face, found, info)
            per_face, found, info = cache[photo]
            row = {"target": key, "photo": photo, "split": split.get(photo, "?"), "class": cls, "score": round(score, 4)}
            if idx:
                best = max(per_face, key=lambda f: sims[f["i"]])
                kps = None
                for f in found:  # same detector, same input -> same boxes; match by IoU
                    bx = [float(v) for v in f.bbox]
                    if abs(bx[0] - best["box"][0]) < 2 and abs(bx[1] - best["box"][1]) < 2:
                        kps = np.asarray(f.kps)
                yaw = 0.0
                if kps is not None:
                    eye_mid = (kps[0] + kps[1]) / 2
                    eye_dist = max(1e-6, float(np.linalg.norm(kps[1] - kps[0])))
                    yaw = float((kps[2][0] - eye_mid[0]) / eye_dist)
                cx = (best["box"][0] + best["box"][2]) / 2 / info["pre_w"] - 0.5
                cy = (best["box"][1] + best["box"][3]) / 2 / info["pre_h"] - 0.5
                row.update({
                    "box_pre": [round(v) for v in best["box"]],
                    "side_det": round(best["side"] * 640 / max(info["pre_w"], info["pre_h"]), 1),
                    "rel_size": round(best["side"] / max(f["side"] for f in per_face), 3),
                    "sharp": round(best["sharp"], 1),
                    "rel_sharp": round(best["sharp"] / max(1e-6, max(f["sharp"] for f in per_face)), 3),
                    "bright": round(best["bright"], 1),
                    "yaw": round(yaw, 2),
                    "centre": round(float(np.hypot(cx, cy) / np.hypot(0.5, 0.5)), 3),
                    "det_score": float(faces[best["i"]]["det_score"]),
                    "n_faces": len(per_face),
                })
            cases.append(row)

    out = run / "analysis"
    out.mkdir(exist_ok=True)
    keys = sorted({k for c in cases for k in c})
    with open(out / "cases.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(cases)

    def group(name, rows):
        print(f"\n## {name}: {len(rows)}")
        for r in sorted(rows, key=lambda r: (r["target"], -r["score"])):
            extra = "" if "side_det" not in r else (
                f" box={r['box_pre']} side={r['side_det']} rel_size={r['rel_size']} sharp={r['sharp']} "
                f"rel_sharp={r['rel_sharp']} yaw={r['yaw']} bright={r['bright']} faces={r['n_faces']} det={r['det_score']:.2f}")
            print(f"  {r['target']} {r['photo']} [{r['split']}] class={r['class']} score={r['score']:.2f}{extra}")
        counts = {}
        for name_, rule in CATEGORY_RULES.items():
            counts[name_] = sum(1 for r in rows if "side_det" in r and rule(r))
        counts["no_face_detected_in_photo"] = sum(1 for r in rows if "side_det" not in r)
        print("  categories (a case can have several):", json.dumps(counts))
        return counts

    missed = [c for c in cases if c["class"] > 0 and c["score"] < THRESHOLD]
    wrong = [c for c in cases if c["class"] == 0 and c["score"] >= 0.30]
    bg_main = [c for c in cases if c["class"] == 2 and c["score"] >= THRESHOLD]
    shown = [c for c in cases if c["class"] == 1]
    summary = {
        "missed_present (score<0.40)": group("Recognition misses (present, score < 0.40)", missed),
        "wrong_person (score>=0.30)": group("Wrong person scoring >= 0.30 (absent label)", wrong),
        "background_in_main (score>=0.40)": group("Background photos that reach the main gallery (score >= 0.40)", bg_main),
    }
    print("\n## Show photos (class 1), all found; feature ranges for contrast")
    for k in ("side_det", "rel_size", "sharp", "rel_sharp", "yaw", "centre", "n_faces"):
        vals = [c[k] for c in shown if k in c]
        print(f"  {k}: min={min(vals)} median={np.median(vals):.3g} max={max(vals)}")

    # Subject vs background separability on TUNE only (class 1 vs class 2, score >= 0.40).
    print("\n## TUNE only: class 1 (show) vs class 2 (background) among matched photos")
    tune = [c for c in cases if c["split"] == "tune" and c["class"] > 0 and c["score"] >= THRESHOLD and "side_det" in c]
    for k in ("side_det", "rel_size", "sharp", "rel_sharp", "abs_yaw", "centre", "n_faces", "det_score"):
        get = (lambda c: abs(c["yaw"])) if k == "abs_yaw" else (lambda c, k=k: c[k])
        a = sorted(get(c) for c in tune if c["class"] == 1)
        b = sorted(get(c) for c in tune if c["class"] == 2)
        print(f"  {k:10} show n={len(a)}: {[round(v, 2) for v in a]}\n  {'':10} bg   n={len(b)}: {[round(v, 2) for v in b]}")
    (out / "summary.json").write_text(json.dumps(summary, indent=2))

    if args.diagnose and missed:
        from insightface.app import FaceAnalysis
        import os
        hi = FaceAnalysis(name="buffalo_l", root=os.environ.get("INSIGHTFACE_ROOT", "~/.insightface"),
                          allowed_modules=["detection", "recognition"], providers=["CPUExecutionProvider"])
        hi.prepare(ctx_id=-1, det_thresh=0.3, det_size=(1280, 1280))
        print("\n## Diagnose misses: re-detect at 3200px input / det_size 1280 / det_thresh 0.3")
        for c in missed:
            img = cv2.imread(str(album / c["photo"]))
            s = 3200 / max(img.shape[:2])
            img = cv2.resize(img, (round(img.shape[1] * s), round(img.shape[0] * s)), interpolation=cv2.INTER_AREA)
            found = hi.get(img)
            ref = npz[f"ref_{c['target']}"]
            best = max(((float(np.dot(f.normed_embedding, ref)), f) for f in found), key=lambda t: t[0], default=(None, None))
            n_prod = c.get("n_faces", 0)
            bs = best[0]
            print(f"  {c['target']} {c['photo']}: baseline score {c['score']:.2f} ({n_prod} faces) -> "
                  f"hi-res score {bs if bs is None else round(bs, 2)} ({len(found)} faces"
                  + ("" if best[1] is None else f", det={float(best[1].det_score):.2f}") + ")")


if __name__ == "__main__":
    main()
