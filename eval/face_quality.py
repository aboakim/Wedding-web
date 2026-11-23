"""Per-face focus measures for every face of a run (row-aligned with faces.csv).

Usage: .venv/bin/python eval/face_quality.py <runDir> <preDir> <albumDir>
Writes <runDir>/face_quality.csv with:
  sharp_orig  Laplacian variance of the face crop from the ORIGINAL photo, resized to 128x128 (INTER_AREA)
  sharp_pre   same, but cropped from the 1600px image the engine receives
"""

import csv
import json
import sys
from pathlib import Path

import cv2


def focus(gray, box, scale):
    x1, y1, x2, y2 = [int(round(v * scale)) for v in box]
    h, w = gray.shape
    crop = gray[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]
    if crop.size == 0:
        return 0.0
    return float(cv2.Laplacian(cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA), cv2.CV_64F).var())


def main():
    run, pre, album = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    meta = json.loads((pre / "meta.json").read_text())
    faces = list(csv.DictReader(open(run / "faces.csv")))
    out, cache = [], {}
    for r in faces:
        photo = r["photo"]
        if photo not in cache:
            cache.clear()
            cache[photo] = (cv2.imread(str(album / photo), cv2.IMREAD_GRAYSCALE),
                            cv2.imread(str(pre / "album" / photo), cv2.IMREAD_GRAYSCALE))
        orig, small = cache[photo]
        info = meta[f"album/{photo}"]
        box = [float(r[k]) for k in ("x1", "y1", "x2", "y2")]
        out.append({"photo": photo, "face": r["face"],
                    "sharp_orig": round(focus(orig, box, info["orig_w"] / info["pre_w"]), 2),
                    "sharp_pre": round(focus(small, box, 1.0), 2)})
    with open(run / "face_quality.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["photo", "face", "sharp_orig", "sharp_pre"])
        w.writeheader()
        w.writerows(out)
    print(f"wrote {run / 'face_quality.csv'}: {len(out)} faces")


if __name__ == "__main__":
    main()
