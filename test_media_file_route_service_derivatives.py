import json
import os
import tempfile
import unittest

from backend.services.media_file_route_service import MediaFileRouteService
import backend.services.media_file_route_service as media_file_route_service
from backend.services.storage_bucket_service import StorageBucketService
import backend.services.storage_bucket_service as storage_bucket_service


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
            self.assertIn("自定义存储桶上传失败", result["message"])
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

    def test_storage_connection_uses_request_bucket_and_runs_full_probe_checks(self):
        class FakeResponse:
            def __init__(self, status=200, body=b"ai-canvas-storage-probe"):
                self.status = status
                self._body = body
                self.headers = {"Content-Type": "text/plain"}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self, _size=-1):
                return self._body

        requests = []
        service = StorageBucketService(settings_getter=lambda: {})
        original_urlopen = storage_bucket_service.urllib.request.urlopen
        try:
            def fake_urlopen(request, timeout=0):
                requests.append({
                    "method": request.get_method(),
                    "url": request.full_url,
                    "data": request.data,
                    "timeout": timeout,
                    "authorization": request.headers.get("Authorization"),
                })
                if request.get_method() == "PUT":
                    return FakeResponse(200)
                if request.get_method() == "HEAD":
                    return FakeResponse(200)
                if request.get_method() == "DELETE":
                    return FakeResponse(204, b"")
                return FakeResponse(200)

            storage_bucket_service.urllib.request.urlopen = fake_urlopen
            result = service.test_connection({
                "endpoint": "http://127.0.0.1:9000",
                "region": "us-east-1",
                "bucket": "canvas-assets",
                "accessKeyId": "minio-user",
                "secretAccessKey": "minio-secret",
                "forcePathStyle": True,
                "publicBaseUrl": "http://public.example.com/assets",
                "prefix": "ai-canvas/",
                "enabled": True,
            })
        finally:
            storage_bucket_service.urllib.request.urlopen = original_urlopen

        self.assertEqual(result["success"], True)
        self.assertEqual(result["checks"], {
            "config": True,
            "write": True,
            "read": True,
            "publicAccess": True,
            "delete": True,
        })
        self.assertEqual(result["message"], "连接测试成功")
        self.assertRegex(result["key"], r"^ai-canvas/__probe__/connection-test-[a-f0-9-]+\.txt$")
        self.assertEqual([item["method"] for item in requests], ["PUT", "HEAD", "GET", "DELETE"])
        self.assertEqual(requests[0]["data"], b"ai-canvas-storage-probe")
        self.assertIn("/canvas-assets/ai-canvas/__probe__/connection-test-", requests[0]["url"])
        self.assertIn("http://public.example.com/assets/ai-canvas/__probe__/connection-test-", requests[2]["url"])
        self.assertIsNotNone(requests[0]["authorization"])
        self.assertEqual(requests[0]["timeout"], 30)

    def test_storage_connection_probe_failure_masks_secret_values_and_still_deletes_probe(self):
        class FakeResponse:
            status = 204

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        requests = []
        service = StorageBucketService(settings_getter=lambda: {})
        original_urlopen = storage_bucket_service.urllib.request.urlopen
        try:
            def fake_urlopen(request, timeout=0):
                requests.append(request.get_method())
                if request.get_method() == "PUT":
                    raise RuntimeError("bad credential minio-user minio-secret Authorization AWS4-HMAC-SHA256 Signature=abc")
                return FakeResponse()

            storage_bucket_service.urllib.request.urlopen = fake_urlopen
            with self.assertRaises(RuntimeError) as context:
                service.test_connection({
                    "endpoint": "http://127.0.0.1:9000",
                    "region": "us-east-1",
                    "bucket": "canvas-assets",
                    "accessKeyId": "minio-user",
                    "secretAccessKey": "minio-secret",
                    "forcePathStyle": True,
                    "prefix": "ai-canvas/",
                    "enabled": True,
                })
        finally:
            storage_bucket_service.urllib.request.urlopen = original_urlopen

        message = str(context.exception)
        self.assertIn("认证失败", message)
        self.assertIn("DELETE", requests)
        self.assertNotIn("minio-user", message)
        self.assertNotIn("minio-secret", message)
        self.assertNotIn("Authorization", message)
        self.assertNotIn("Signature", message)

    def test_storage_test_route_uses_request_body_bucket_config(self):
        class FakeStorageBucketService:
            def __init__(self):
                self.received = None

            def test_connection(self, bucket_config=None):
                self.received = bucket_config
                return {
                    "success": True,
                    "checks": {"config": True, "write": True, "read": True, "publicAccess": True, "delete": True},
                    "message": "连接测试成功",
                }

            def sanitize_error(self, error):
                return str(error)

        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            service = self.make_service(tmpdir, storage_bucket_service=bucket)
            body = json.dumps({
                "endpoint": "http://127.0.0.1:9000",
                "bucket": "canvas-assets",
                "region": "us-east-1",
                "accessKeyId": "minio-user",
                "secretAccessKey": "minio-secret",
                "forcePathStyle": True,
                "publicBaseUrl": "http://public.example.com/assets",
                "prefix": "ai-canvas/",
            }).encode("utf-8")

            result = service._handle_storage_test(FakeHandler(body, path="/api/v2/storage/test"))

            self.assertEqual(result["kind"], "json_ok")
            self.assertEqual(bucket.received["endpoint"], "http://127.0.0.1:9000")
            self.assertEqual(bucket.received["secretAccessKey"], "minio-secret")
            self.assertEqual(result["data"]["checks"]["write"], True)


if __name__ == "__main__":
    unittest.main()