"""Local face engine.

InsightFace buffalo_l: RetinaFace finds every face, ArcFace builds a 512-number
code. The same person keeps a close code across different photos.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from insightface.app import FaceAnalysis

HOST = "127.0.0.1"
PORT = 53721
MAX_BODY = 20 * 1024 * 1024
DET_ALBUM = 0.45
DET_SELFIE = 0.55

lock = threading.Lock()
engine = None


def load():
    global engine
    # Only detection (boxes + 5 keypoints for alignment) and recognition (embedding)
    # are used. Skipping the landmark and gender/age models saves time per face and
    # avoids inferring attributes nobody asked for.
    app = FaceAnalysis(
        name="buffalo_l",
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


def embed(raw, mode):
    image = decode(raw)
    if image is None:
        return {"ok": False, "error": "image"}
    with lock:
        found = engine.get(image)
    if mode == "selfie":
        found = [face for face in found if float(face.det_score) >= DET_SELFIE]
        if not found:
            return {"ok": False, "error": "none"}
        largest = max(box_area(face) for face in found)
        found = [face for face in found if box_area(face) >= largest * 0.25]
        if len(found) > 1:
            return {"ok": False, "error": "multiple"}
    else:
        found = [face for face in found if float(face.det_score) >= DET_ALBUM]
        found.sort(key=box_area, reverse=True)
        found = found[:30]
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
        mode = "selfie" if "mode=selfie" in self.path else "album"
        try:
            payload = embed(raw, mode)
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
