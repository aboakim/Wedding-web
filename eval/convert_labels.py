"""Convert exported 0/1 labels to 3 classes.

Usage: .venv/bin/python eval/convert_labels.py <inDir> <outDir> [--override eval/label_overrides.json]

Classes (column contains_target):
  1 = target present and the photo should be shown in the main gallery
  2 = target present but background / out of focus ("You may also appear in")
  0 = target not present
Rule agreed with the labeler (2026-11-23): an exported 0 WITH a note means the
target is present but in the background -> 2. Overrides fix individual rows.
"""

import argparse
import csv
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--override", default="eval/label_overrides.json")
    args = ap.parse_args()
    inp, out = Path(args.inp), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    overrides = json.loads(Path(args.override).read_text()) if Path(args.override).exists() else {}
    for src in sorted(inp.glob("labels_*.csv")):
        target = src.stem.split("_", 1)[1]
        fix = overrides.get(target, {})
        counts = {0: 0, 1: 0, 2: 0}
        rows = []
        for row in csv.DictReader(open(src)):
            value = int(row["contains_target"])
            if value == 0 and row["notes"].strip():
                value = 2
            if row["filename"] in fix:
                value = int(fix[row["filename"]]["class"])
                row["notes"] = (row["notes"] + " | " + fix[row["filename"]]["why"]).strip(" |")
            counts[value] += 1
            rows.append({"filename": row["filename"], "contains_target": value, "notes": row["notes"]})
        with open(out / src.name, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["filename", "contains_target", "notes"])
            writer.writeheader()
            writer.writerows(rows)
        print(f"{target}: show={counts[1]} background={counts[2]} absent={counts[0]}")


if __name__ == "__main__":
    main()
