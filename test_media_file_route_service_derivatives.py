import json
import os
import tempfile
import unittest

from backend.services.media_file_route_service import MediaFileRouteService
import backend.services.media_file_route_service as media_file_route_service


class FakeHandler:
    def __init__(self, body, path="/", headers=None):
        self._body = body
        self.path = path
        self.headers = headers or {}


class FakeStorageBucketService:
    def __init__(self, *, enabled=True, fail_message=""):
        self.enabled = enabled
        self.fail_message = fail_message
        self.uploads = []

    def is_enabled(self):
        return self.enabled

    def upload_media_bytes(self, file_bytes, *, filename, content_type="", local_path=""):
        if self.fail_message:
            raise RuntimeError(self.fail_message)
        self.uploads.append({
            "bytes": file_bytes,
            "filename": filename,
            "contentType": content_type,
            "localPath": local_path,
        })
        return {
            "url": f"https://cdn.example.com/ai-canvas/{filename}",
            "key": f"ai-canvas/{filename}",
            "bucket": "canvas-assets",
            "size": len(file_bytes),
            "contentType": content_type,
        }

    def sanitize_error(self, error):
        return str(error).replace("minio-secret", "***")


class MediaFileRouteServiceDerivativeTest(unittest.TestCase):
    def make_service(self, tmpdir, storage_bucket_service=None):
        uploads_dir = os.path.join(tmpdir, "data", "uploads")
        output_dir = os.path.join(tmpdir, "output")
        os.makedirs(uploads_dir, exist_ok=True)
        os.makedirs(output_dir, exist_ok=True)
        service = MediaFileRouteService(
            directory=tmpdir,
            uploads_dir_getter=lambda: uploads_dir,
            output_dir_getter=lambda: output_dir,
            max_upload_bytes=100000000,
            next_output_filename=lambda ext: f"out.{ext}",
            load_json_file=lambda path: {},
            atomic_write_json=lambda path, data: None,
            read_body=lambda handler, max_bytes=None: handler._body,
        )
        if storage_bucket_service is not None:
            service.storage_bucket_service = storage_bucket_service
        return service

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

    def test_save_output_uses_enabled_storage_bucket_and_keeps_response_shape(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            service = self.make_service(tmpdir, storage_bucket_service=bucket)
            handler = FakeHandler(b"image-bytes", path="/api/v2/save_output?ext=png")

            result = service._handle_save_output(handler)

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertEqual(payload["success"], True)
            self.assertEqual(payload["filename"], "out.png")
            self.assertEqual(payload["path"], "output/out.png")
            self.assertEqual(payload["localPath"], "output/out.png")
            self.assertEqual(payload["url"], "https://cdn.example.com/ai-canvas/out.png")
            self.assertEqual(payload["storage"], "s3-compatible")
            self.assertEqual(payload["storageKey"], "ai-canvas/out.png")
            self.assertEqual(bucket.uploads[0]["bytes"], b"image-bytes")

    def test_save_output_bucket_error_masks_secret_values(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService(fail_message="upload failed with minio-secret")
            service = self.make_service(tmpdir, storage_bucket_service=bucket)
            handler = FakeHandler(b"image-bytes", path="/api/v2/save_output?ext=png")

            result = service._handle_save_output(handler)

            self.assertEqual(result["kind"], "json_err")
            self.assertEqual(result["code"], 502)
            self.assertIn("***", result["message"])
            self.assertNotIn("minio-secret", result["message"])

    def test_upload_uses_enabled_storage_bucket_and_keeps_local_path_metadata(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            service = self.make_service(tmpdir, storage_bucket_service=bucket)
            handler = FakeHandler(
                b"upload-bytes",
                path="/api/upload?filename=sample.png",
                headers={"Content-Type": "image/png"},
            )

            result = service._handle_upload(handler)

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertEqual(payload["filename"], "sample.png")
            self.assertEqual(payload["localPath"], "data/uploads/sample.png")
            self.assertEqual(payload["url"], "https://cdn.example.com/ai-canvas/sample.png")
            self.assertEqual(payload["storage"], "s3-compatible")
            self.assertEqual(bucket.uploads[0]["localPath"], "data/uploads/sample.png")

    def test_save_output_from_url_uses_enabled_storage_bucket_response_url(self):
        class FakeResponse:
            headers = {"Content-Type": "image/png"}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self, _size):
                if getattr(self, "done", False):
                    return b""
                self.done = True
                return b"remote-bytes"

        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            service = self.make_service(tmpdir, storage_bucket_service=bucket)
            handler = FakeHandler(
                json.dumps({"url": "https://runninghub.cn/result.png", "ext": "png"}).encode("utf-8"),
                path="/api/v2/save_output_from_url",
            )
            original_urlopen = media_file_route_service.urllib.request.urlopen
            try:
                media_file_route_service.urllib.request.urlopen = lambda *args, **kwargs: FakeResponse()
                result = service._handle_save_output_from_url(handler)
            finally:
                media_file_route_service.urllib.request.urlopen = original_urlopen

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertEqual(payload["filename"], "out.png")
            self.assertEqual(payload["localPath"], "output/out.png")
            self.assertEqual(payload["url"], "https://cdn.example.com/ai-canvas/out.png")
            self.assertEqual(payload["storage"], "s3-compatible")
            self.assertEqual(bucket.uploads[0]["bytes"], b"remote-bytes")


if __name__ == "__main__":
    unittest.main()