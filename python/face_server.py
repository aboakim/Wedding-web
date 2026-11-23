"""Local face engine.

InsightFace buffalo_l: RetinaFace finds every face, ArcFace builds a 512-number
code. The same person keeps a close code across different photos.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import cv2
import numpy as np
from insightface.app import FaceAnalysis

HOST = "127.0.0.1"
PORT = 53721
MAX_BODY = 20 * 1024 * 1024
DET_ALBUM = 0.45
DET_SELFIE = 0.55
MIN_PICK_SIDE = 40  # px in the (max 1600px) image; smaller faces make poor references
MAX_PICK = 12

lock = threading.Lock()
engine = None


def load():
    global engine
    # Only detection (boxes + 5 keypoints for alignment) and recognition (embedding)
    # are used. Skipping the landmark and gender/age models saves time per face and
    # avoids inferring attributes nobody asked for.
    app = FaceAnalysis(
        name="buffalo_l",
        root=os.environ.get("INSIGHTFACE_ROOT", "~/.insightface"),
        allowed_modules=["detection", "recognition"],
        providers=["CPUExecutionProvider"],
    )
    app.prepare(ctx_id=-1, det_size=(640, 640))
    engine = app


def box_area(face):
    x1, y1, x2, y2 = [float(v) for v in face.bbox]
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def decode(raw):
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    return image


def vector_of(face):
    values = np.asarray(face.embedding, dtype=np.float32)
    if values.shape != (512,):
        return None
    norm = float(np.linalg.norm(values))
    if norm <= 1e-8:
        return None
    values = values / norm
    return [round(float(n), 8) for n in values]


def select_faces(found, mode):
    """Apply the selfie/album face rules. Returns (faces, error)."""
    if mode == "selfie":
        found = [face for face in found if float(face.det_score) >= DET_SELFIE]
        if not found:
            return [], "none"
        largest = max(box_area(face) for face in found)
        found = [face for face in found if box_area(face) >= largest * 0.25]
        if len(found) > 1:
            return [], "multiple"
        return found, None
    found = [face for face in found if float(face.det_score) >= DET_ALBUM]
    found.sort(key=box_area, reverse=True)
    return found[:30], None


def pick_candidates(found):
    """Faces a guest may choose as their reference, left to right."""
    faces = [f for f in found if float(f.det_score) >= DET_SELFIE
             and min(float(f.bbox[2] - f.bbox[0]), float(f.bbox[3] - f.bbox[1])) >= MIN_PICK_SIDE]
    faces.sort(key=lambda f: float(f.bbox[0] + f.bbox[2]))
    return faces[:MAX_PICK]


def normalized_box(face, shape):
    h, w = shape[:2]
    x1, y1, x2, y2 = [float(v) for v in face.bbox]
    return [round(max(0.0, x1 / w), 4), round(max(0.0, y1 / h), 4), round(min(1.0, x2 / w), 4), round(min(1.0, y2 / h), 4)]


def face_at(faces, shape, point):
    """The candidate whose box contains the point, else the nearest centre within 0.15."""
    px, py = point
    best, dist = None, 0.15
    for face in faces:
        x1, y1, x2, y2 = normalized_box(face, shape)
        if x1 <= px <= x2 and y1 <= py <= y2:
            return face
        d = ((px - (x1 + x2) / 2) ** 2 + (py - (y1 + y2) / 2) ** 2) ** 0.5
        if d < dist:
            best, dist = face, d
    return best


def embed(raw, mode, point=None):
    image = decode(raw)
    if image is None:
        return {"ok": False, "error": "image"}
    with lock:
        detected = engine.get(image)
    if mode == "selfie" and point is not None:
        chosen = face_at(pick_candidates(detected), image.shape, point)
        if chosen is None:
            return {"ok": False, "error": "none"}
        found, error = [chosen], None
    else:
        found, error = select_faces(detected, mode)
    if error == "multiple":
        # Let the guest choose: return boxes only (normalized), never image data.
        candidates = pick_candidates(detected)
        if len(candidates) >= 2:
            return {"ok": False, "error": "multiple",
                    "faces": [normalized_box(f, image.shape) for f in candidates]}
    if error:
        return {"ok": False, "error": error}
    faces = []
    for face in found:
        vec = vector_of(face)
        if vec:
            faces.append(vec)
    if mode == "selfie" and not faces:
        return {"ok": False, "error": "none"}
    return {"ok": True, "faces": faces}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/health":
            self.send_error(404)
            return
        self._json(200, {"ok": engine is not None, "dim": 512})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/embed":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length") or 0)
        if length < 1 or length > MAX_BODY:
            self._json(400, {"ok": False, "error": "size"})
            return
        raw = self.rfile.read(length)
        params = parse_qs(urlsplit(self.path).query)
        mode = "selfie" if params.get("mode", [""])[0] == "selfie" else "album"
        point = None
        try:
            if "x" in params and "y" in params:
                point = (float(params["x"][0]), float(params["y"][0]))
                if not (0.0 <= point[0] <= 1.0 and 0.0 <= point[1] <= 1.0):
                    raise ValueError("point")
        except ValueError:
            self._json(400, {"ok": False, "error": "point"})
            return
        try:
            payload = embed(raw, mode, point)
        except Exception:
            payload = {"ok": False, "error": "engine"}
        self._json(200 if payload.get("ok") else 422, payload)

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    load()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
