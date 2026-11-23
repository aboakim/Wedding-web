"""Export a run's embeddings + reference vectors + expected per-photo scores for eval/sql_parity.mjs.

Usage: .venv/bin/python eval/export_sql_input.py <runDir>
Writes <runDir>/sql_input.json (local, git-ignored). Embeddings are rounded to
8 decimals exactly like python/face_server.py vector_of().
"""

import json
import sys
from pathlib import Path

import numpy as np

run = Path(sys.argv[1])
npz = np.load(run / "faces.npz")
E, owner = npz["embeddings"].astype(np.float64), [str(p) for p in npz["photo"]]
refs = {k[4:]: npz[k].astype(np.float64) for k in npz.files if k.startswith("ref_")}
expected = {}
for key, ref in refs.items():
    sims = E @ ref
    best = {}
    for p, s in zip(owner, sims):
        best[p] = max(best.get(p, -1.0), float(s))
    expected[key] = best
(run / "sql_input.json").write_text(json.dumps({
    "photos": sorted(set(owner)),
    "owner": owner,
    "embeddings": [[round(float(v), 8) for v in row] for row in E],
    "refs": {k: [round(float(v), 8) for v in r] for k, r in refs.items()},
    "expected": expected,
}))
print(f"wrote {run / 'sql_input.json'}: {len(E)} faces, refs {list(refs)}")
