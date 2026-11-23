"""Run the production face engine over a preprocessed album and score targets.

Usage:
  .venv/bin/python eval/run_baseline.py <preDir> <outDir> [--targets eval/targets.json] [--threshold 0.40]

<preDir> comes from eval/preprocess.mjs. Uses python/face_server.py unchanged:
load(), decode(), engine.get(), select_faces(), vector_of(). Matching mirrors
lib/match.js: a photo matches if ANY of its faces has cosine >= threshold.
Outputs (local only, git-ignored): faces.npz, faces.csv, scores.csv, summary.json.
"""

import argparse
import csv
import json
import os
import resource
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
import face_server as fs  # noqa: E402


def peak_rss_mb():
    # macOS reports bytes, Linux kilobytes.
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return value / (1024 * 1024) if sys.platform == "darwin" else value / 1024


def detect(path):
    image = fs.decode(Path(path).read_bytes())
    if image is None:
        return None, []
    return image, fs.engine.get(image)


def pick_reference(found, side):
    """Choose the target face in a multi-person reference photo by position."""
    faces = [f for f in found if float(f.det_score) >= fs.DET_ALBUM]
    if not faces:
        return None
    largest = max(fs.box_area(f) for f in faces)
    faces = [f for f in faces if fs.box_area(f) >= largest * 0.25]
    centre = lambda f: (float(f.bbox[0]) + float(f.bbox[2])) / 2  # noqa: E731
    return min(faces, key=centre) if side == "left" else max(faces, key=centre)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pre")
    parser.add_argument("out")
    parser.add_argument("--targets", default="eval/targets.json")
    parser.add_argument("--threshold", type=float, default=0.40)
    args = parser.parse_args()
    pre, out = Path(args.pre), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((pre / "meta.json").read_text())
    targets = json.loads(Path(args.targets).read_text())

    t0 = time.perf_counter()
    fs.load()
    load_s = time.perf_counter() - t0

    # References
    refs = {}
    ref_info = {}
    for key, spec in targets.items():
        _, found = detect(pre / "refs" / spec["ref"])
        _, selfie_error = fs.select_faces(found, "selfie")
        face = pick_reference(found, spec["pick"])
        vec = fs.vector_of(face) if face is not None else None
        ref_info[key] = {
            "ref": spec["ref"],
            "pick": spec["pick"],
            "faces_in_ref": len(found),
            "production_selfie_mode": selfie_error or "ok",
            "ref_face_px": None if face is None else round(min(float(face.bbox[2] - face.bbox[0]), float(face.bbox[3] - face.bbox[1])), 1),
            "ref_det_score": None if face is None else round(float(face.det_score), 3),
            "ref_bbox": None if face is None else [round(float(v), 1) for v in face.bbox],
        }
        if vec is None:
            print(f"WARNING: no reference face for {key}", file=sys.stderr)
            continue
        refs[key] = np.asarray(vec, dtype=np.float32)

    # Album
    names = sorted(k.split("/", 1)[1] for k in meta if k.startswith("album/") and "error" not in meta[k])
    rows, embeddings, owners = [], [], []
    per_photo = []
    t1 = time.perf_counter()
    for name in names:
        ts = time.perf_counter()
        image, found = detect(pre / "album" / name)
        selected, _ = fs.select_faces(found, "album")
        info = meta[f"album/{name}"]
        det_scale = 640.0 / max(info["pre_w"], info["pre_h"])
        n = 0
        for idx, face in enumerate(selected):
            vec = fs.vector_of(face)
            if vec is None:
                continue
            x1, y1, x2, y2 = [float(v) for v in face.bbox]
            side = min(x2 - x1, y2 - y1)
            rows.append({
                "photo": name, "face": idx,
                "x1": round(x1, 1), "y1": round(y1, 1), "x2": round(x2, 1), "y2": round(y2, 1),
                "det_score": round(float(face.det_score), 4),
                "side_pre_px": round(side, 1),
                "side_det_px": round(side * det_scale, 1),
            })
            embeddings.append(vec)
            owners.append(name)
            n += 1
        per_photo.append({"photo": name, "faces": n, "seconds": time.perf_counter() - ts})
    album_s = time.perf_counter() - t1

    E = np.asarray(embeddings, dtype=np.float32).reshape(-1, 512)
    owners_arr = np.asarray(owners)
    np.savez_compressed(out / "faces.npz", embeddings=E, photo=owners_arr,
                        **{f"ref_{k}": v for k, v in refs.items()})
    with open(out / "faces.csv", "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["photo"])
        writer.writeheader()
        writer.writerows(rows)

    # Scores: max cosine over faces per photo (vectors are L2-normalized).
    scores = {name: {k: None for k in refs} for name in names}
    for key, ref in refs.items():
        sims = E @ ref if len(E) else np.zeros(0)
        for photo, sim in zip(owners, sims):
            prev = scores[photo][key]
            scores[photo][key] = float(sim) if prev is None else max(prev, float(sim))
    faces_by_photo = {p["photo"]: p["faces"] for p in per_photo}
    with open(out / "scores.csv", "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["photo", "faces"] + [f"{k}_score" for k in refs])
        for name in names:
            writer.writerow([name, faces_by_photo[name]] + [
                "" if scores[name][k] is None else f"{scores[name][k]:.4f}" for k in refs])

    sides = np.asarray([r["side_det_px"] for r in rows]) if rows else np.zeros(0)
    times = np.asarray([p["seconds"] for p in per_photo])
    matches = {}
    for key in refs:
        excluded = set(targets[key].get("exclude", []))
        matches[key] = sum(1 for n in names if n not in excluded
                           and scores[n][key] is not None and scores[n][key] >= args.threshold)
    summary = {
        "threshold": args.threshold,
        "photos": len(names),
        "preprocess_errors": sum(1 for k, v in meta.items() if k.startswith("album/") and "error" in v),
        "faces": int(len(rows)),
        "photos_zero_faces": int(sum(1 for p in per_photo if p["faces"] == 0)),
        "faces_per_photo_mean": round(len(rows) / max(1, len(names)), 2),
        "face_side_at_det_scale_px": {q: round(float(np.percentile(sides, p)), 1) for q, p in
                                      [("p5", 5), ("p25", 25), ("median", 50), ("p75", 75)]} if len(sides) else {},
        "model_load_seconds": round(load_s, 1),
        "album_seconds": round(album_s, 1),
        "seconds_per_photo": {"mean": round(float(times.mean()), 3), "p95": round(float(np.percentile(times, 95)), 3)} if len(times) else {},
        "peak_rss_mb": round(peak_rss_mb(), 0),
        "references": ref_info,
        "matches_at_threshold": matches,
        "onnxruntime_providers": "CPUExecutionProvider",
        "insightface_root": os.environ.get("INSIGHTFACE_ROOT", "~/.insightface"),
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
