import json
import os
import tempfile
import unittest

from backend.services.media_file_route_service import MediaFileRouteService


class FakeHandler:
    def __init__(self, body):
        self._body = body


class MediaFileRouteServiceDerivativeTest(unittest.TestCase):
    def make_service(self, tmpdir):
        uploads_dir = os.path.join(tmpdir, "data", "uploads")
        output_dir = os.path.join(tmpdir, "output")
        os.makedirs(uploads_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        return MediaFileRouteService(
            directory=tmpdir,
            uploads_dir_getter=lambda: uploads_dir,
            output_dir_getter=lambda: output_dir,
            max_upload_bytes=100000000,
            next_output_filename=lambda ext: f"out.{ext}",
            load_json_file=lambda path: {},
            atomic_write_json=lambda path, data: None,
            read_body=lambda handler, max_bytes=None: handler._body,
        )

    def test_derivative_ensure_falls_back_to_original_when_pillow_unavailable_or_decode_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            service = self.make_service(tmpdir)
            filename = "upload_j5uy9r_【哲风壁纸】动漫-女孩-美女.jpg"
            local_path = f"data/uploads/{filename}"
            abs_path = os.path.join(tmpdir, "data", "uploads", filename)
            with open(abs_path, "wb") as file:
                file.write(b"not-a-real-image")

            handler = FakeHandler(json.dumps({"localPath": local_path}, ensure_ascii=False).encode("utf-8"))
            result = service._handle_images_derivatives_ensure(handler)

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertEqual(payload["success"], True)
            self.assertEqual(payload["localPath"], local_path)
            self.assertEqual(payload["originalLocalPath"], local_path)
            self.assertEqual(payload["url"], f"/{local_path}")
            self.assertEqual(payload["originalUrl"], f"/{local_path}")
            self.assertEqual(payload["derivativeStatus"], "failed")


if __name__ == "__main__":
    unittest.main()