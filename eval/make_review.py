"""Build a local, offline labeling page from a baseline run.

Usage:
  .venv/bin/python eval/make_review.py <preDir> <runDir> <outDir> [--targets eval/targets.json] [--threshold 0.40]

Writes <outDir>/review.html plus thumbnails and reference crops next to it.
Open review.html directly from disk (file://). Nothing is uploaded anywhere.
Labels are kept in the browser (localStorage) and exported as
labels_<target>.csv with columns: filename,contains_target,notes.
"""

import argparse
import csv
import html
import json
from pathlib import Path

import cv2
import numpy as np

THUMB_EDGE = 420


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pre")
    parser.add_argument("run")
    parser.add_argument("out")
    parser.add_argument("--targets", default="eval/targets.json")
    parser.add_argument("--threshold", type=float, default=0.40)
    args = parser.parse_args()
    pre, run, out = Path(args.pre), Path(args.run), Path(args.out)
    (out / "thumbs").mkdir(parents=True, exist_ok=True)
    (out / "refs").mkdir(parents=True, exist_ok=True)

    targets = json.loads(Path(args.targets).read_text())
    summary = json.loads((run / "summary.json").read_text())
    meta = json.loads((pre / "meta.json").read_text())
    faces = list(csv.DictReader(open(run / "faces.csv")))
    npz = np.load(run / "faces.npz")
    E = npz["embeddings"]
    assert len(faces) == len(E), "faces.csv and faces.npz out of sync"

    names = sorted(k.split("/", 1)[1] for k in meta if k.startswith("album/") and "error" not in meta[k])

    # Thumbnails (from the 1600px preprocessed images, same orientation as the boxes).
    for name in names:
        dest = out / "thumbs" / name
        if dest.exists():
            continue
        img = cv2.imread(str(pre / "album" / name))
        h, w = img.shape[:2]
        s = THUMB_EDGE / max(h, w)
        cv2.imwrite(str(dest), cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA),
                    [cv2.IMWRITE_JPEG_QUALITY, 80])

    by_photo = {}
    for i, row in enumerate(faces):
        by_photo.setdefault(row["photo"], []).append(i)

    data = {"threshold": args.threshold, "targets": {}}
    for key, spec in targets.items():
        ref_key = f"ref_{key}"
        if ref_key not in npz:
            continue
        ref = npz[ref_key]
        sims = E @ ref
        info = summary["references"][key]
        # Reference crop so the labeler knows who the target is.
        crop_name = f"{key}.jpg"
        img = cv2.imread(str(pre / "refs" / spec["ref"]))
        x1, y1, x2, y2 = info["ref_bbox"]
        pad = 0.35 * max(x2 - x1, y2 - y1)
        H, W = img.shape[:2]
        crop = img[max(0, int(y1 - pad)):min(H, int(y2 + pad)), max(0, int(x1 - pad)):min(W, int(x2 + pad))]
        cv2.imwrite(str(out / "refs" / crop_name), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])

        excluded = set(spec.get("exclude", []))
        items = []
        for name in names:
            if name in excluded:
                continue
            m = meta[f"album/{name}"]
            idx = by_photo.get(name, [])
            entry = {"f": name, "n": len(idx), "s": None, "b": None}
            if idx:
                best = max(idx, key=lambda i: sims[i])
                r = faces[best]
                entry["s"] = round(float(sims[best]), 4)
                # Box as percentages of the image, so it scales with the thumbnail.
                entry["b"] = [round(100 * float(r["x1"]) / m["pre_w"], 2), round(100 * float(r["y1"]) / m["pre_h"], 2),
                              round(100 * (float(r["x2"]) - float(r["x1"])) / m["pre_w"], 2),
                              round(100 * (float(r["y2"]) - float(r["y1"])) / m["pre_h"], 2)]
            items.append(entry)
        items.sort(key=lambda e: -1 if e["s"] is None else e["s"], reverse=True)
        data["targets"][key] = {"ref": f"refs/{crop_name}", "kind": spec.get("kind", ""), "items": items}

    page = TEMPLATE.replace("__DATA__", json.dumps(data)).replace("__PRE__", html.escape(
        Path("../pre/album").as_posix()))
    (out / "review.html").write_text(page, encoding="utf-8")
    print(f"wrote {out / 'review.html'} ({len(names)} photos, targets: {', '.join(data['targets'])})")


TEMPLATE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Face Label Review</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--ink:#1c1c1c;--mute:#6b6b6b;--line:#ddd;--yes:#1a7f37;--no:#b42318;--box:#f5b700;--hi:#e8f0fe}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--card:#222;--ink:#eee;--mute:#9a9a9a;--line:#3a3a3a;--hi:#1d2a3f}}
*{box-sizing:border-box}body{margin:0;font:14px/1.4 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.tabs button{font:inherit;padding:6px 12px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:6px;cursor:pointer}
.tabs button.on{background:var(--ink);color:var(--bg)}
.ref{display:flex;gap:10px;align-items:center}.ref img{height:64px;border-radius:6px}
.stats{color:var(--mute)}.tools button{font:inherit;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.help{color:var(--mute);padding:8px 16px 0}
h2{font-size:13px;font-weight:600;color:var(--mute);margin:18px 16px 8px;text-transform:uppercase;letter-spacing:.04em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;padding:0 16px}
.card{background:var(--card);border:3px solid transparent;border-radius:8px;overflow:hidden;cursor:pointer;user-select:none}
.card.yes{border-color:var(--yes)}.card.no{border-color:var(--no);opacity:.55}
.pic{position:relative;line-height:0}.pic img{width:100%;height:auto}
.box{position:absolute;border:2px solid var(--box);box-shadow:0 0 0 1px #000a}
.meta{display:flex;justify-content:space-between;align-items:center;padding:5px 7px;font-size:12px;gap:6px}
.meta .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-weight:700}.yes .tag{color:var(--yes)}.no .tag{color:var(--no)}
.zoom{border:0;background:none;color:var(--ink);cursor:pointer;font-size:14px;padding:0 2px}
.note{font-size:11px;color:var(--mute);padding:0 7px 5px}
.hide-scores .sc{visibility:hidden}
#lb{position:fixed;inset:0;background:#000e;display:none;z-index:10;align-items:center;justify-content:center;flex-direction:column}
#lb.on{display:flex}#lb .wrap{position:relative;max-width:96vw;max-height:88vh;line-height:0}#lb img{max-width:96vw;max-height:88vh}
#lb .bar{color:#fff;padding:8px;font-size:13px}
</style></head><body>
<header>
  <div class="tabs" id="tabs"></div>
  <div class="ref" id="ref"></div>
  <div class="stats" id="stats"></div>
  <div class="tools">
    <label><input type="checkbox" id="hs"> hide scores</label>
    <button id="rest">Mark unlabeled as NO</button>
    <button id="exp">Export labels CSV</button>
  </div>
</header>
<p class="help">Click a photo: <b>yes</b> → <b>no</b> → clear. 🔍 opens the large image. ✎ adds a note (e.g. "back of head", "far background").
The yellow box is the face the system thinks is most similar — it may be the wrong person. Mark <b>yes</b> whenever the target is anywhere in the photo.
Please look through <b>all</b> sections, including the lowest scores: missed photos are what we need to find.</p>
<div id="body"></div>
<div id="lb"><div class="wrap"><img id="lbimg" alt=""><div class="box" id="lbbox"></div></div><div class="bar" id="lbbar"></div></div>
<script>
const DATA = __DATA__;
const PRE = "__PRE__";
let cur = Object.keys(DATA.targets)[0];
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem('labels_'+k) || '{}'); } catch { return {}; } },
  set(k,v){ try { localStorage.setItem('labels_'+k, JSON.stringify(v)); } catch {} }
};
let labels = {};
function load(){ labels = store.get(cur); }
function save(){ store.set(cur, labels); }
function section(title, items){
  if(!items.length) return '';
  return `<h2>${title} · ${items.length}</h2><div class="grid">` + items.map(card).join('') + '</div>';
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function card(e){
  const l = labels[e.f] || {};
  const st = l.v === 1 ? 'yes' : l.v === 0 ? 'no' : '';
  const box = e.b ? `<div class="box" style="left:${e.b[0]}%;top:${e.b[1]}%;width:${e.b[2]}%;height:${e.b[3]}%"></div>` : '';
  return `<div class="card ${st}" data-f="${esc(e.f)}"><div class="pic"><img loading="lazy" src="thumbs/${encodeURIComponent(e.f)}" alt="">${box}</div>
  <div class="meta"><span class="name">${esc(e.f)}</span><span class="sc">${e.s===null?'no face':e.s.toFixed(2)}</span>
  <span class="tag">${st==='yes'?'YES':st==='no'?'NO':''}</span><button class="zoom" data-z="1" title="Open large">🔍</button><button class="zoom" data-n="1" title="Note">✎</button></div>
  ${l.n ? `<div class="note">${esc(l.n)}</div>` : ''}</div>`;
}
function render(){
  const t = DATA.targets[cur], th = DATA.threshold;
  document.getElementById('tabs').innerHTML = Object.keys(DATA.targets).map(k => `<button class="${k===cur?'on':''}" data-t="${k}">${k}</button>`).join(' ');
  document.getElementById('ref').innerHTML = `<img src="${t.ref}" alt="reference"><span>Target <b>${cur}</b><br><span class="stats">${esc(t.kind)}</span></span>`;
  const it = t.items;
  document.getElementById('body').innerHTML =
    section(`Matched by the system (score ≥ ${th.toFixed(2)})`, it.filter(e => e.s !== null && e.s >= th)) +
    section('Near the threshold (0.25 – ' + th.toFixed(2) + ')', it.filter(e => e.s !== null && e.s < th && e.s >= 0.25)) +
    section('Low scores', it.filter(e => e.s !== null && e.s < 0.25)) +
    section('No face detected', it.filter(e => e.s === null));
  stats();
}
function stats(){
  const it = DATA.targets[cur].items, done = it.filter(e => labels[e.f] && labels[e.f].v !== undefined).length;
  const yes = it.filter(e => labels[e.f] && labels[e.f].v === 1).length;
  document.getElementById('stats').textContent = `labeled ${done}/${it.length} · yes ${yes}`;
}
document.addEventListener('click', ev => {
  const tab = ev.target.closest('[data-t]'); if (tab) { cur = tab.dataset.t; load(); render(); return; }
  const c = ev.target.closest('.card'); if (!c) return;
  const f = c.dataset.f, e = DATA.targets[cur].items.find(x => x.f === f);
  if (ev.target.dataset.z) { openLb(e); return; }
  if (ev.target.dataset.n) {
    const n = prompt('Note for ' + f, (labels[f] && labels[f].n) || '');
    if (n !== null) { labels[f] = Object.assign({}, labels[f], { n: n.replace(/[\r\n,]/g, ' ').trim() }); save(); c.outerHTML = card(e); }
    return;
  }
  const l = labels[f] || {};
  const v = l.v === undefined ? 1 : l.v === 1 ? 0 : undefined;
  labels[f] = Object.assign({}, l, { v }); if (v === undefined) delete labels[f].v;
  save(); c.outerHTML = card(e); stats();
});
function openLb(e){
  const lb = document.getElementById('lb'), img = document.getElementById('lbimg'), box = document.getElementById('lbbox');
  img.src = PRE + '/' + encodeURIComponent(e.f);
  if (e.b) { box.style.cssText = `display:block;left:${e.b[0]}%;top:${e.b[1]}%;width:${e.b[2]}%;height:${e.b[3]}%`; } else box.style.display = 'none';
  document.getElementById('lbbar').textContent = e.f + ' · ' + (e.s === null ? 'no face detected' : 'score ' + e.s.toFixed(3) + ' · ' + e.n + ' faces') + ' · click anywhere to close';
  lb.classList.add('on');
}
document.getElementById('lb').addEventListener('click', ev => { ev.stopPropagation(); document.getElementById('lb').classList.remove('on'); }, true);
document.getElementById('hs').addEventListener('change', ev => document.body.classList.toggle('hide-scores', ev.target.checked));
document.getElementById('rest').addEventListener('click', () => {
  const it = DATA.targets[cur].items.filter(e => !(labels[e.f] && labels[e.f].v !== undefined));
  if (!it.length || !confirm(`Mark ${it.length} unlabeled photos as NO for ${cur}? Only do this after looking through all of them.`)) return;
  it.forEach(e => { labels[e.f] = Object.assign({}, labels[e.f], { v: 0 }); }); save(); render();
});
document.getElementById('exp').addEventListener('click', () => {
  const it = DATA.targets[cur].items, missing = it.filter(e => !(labels[e.f] && labels[e.f].v !== undefined)).length;
  if (missing && !confirm(`${missing} photos are still unlabeled and will be left out. Export anyway?`)) return;
  const rows = ['filename,contains_target,notes'].concat(it.filter(e => labels[e.f] && labels[e.f].v !== undefined)
    .map(e => `${e.f},${labels[e.f].v},${(labels[e.f].n || '').replace(/[\r\n,]/g, ' ')}`));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
  a.download = `labels_${cur}.csv`; a.click();
});
load(); render();
</script></body></html>
"""

if __name__ == "__main__":
    main()
