import json
import os
import tempfile
import unittest

from backend.services.media_file_route_service import MediaFileRouteService
import backend.services.media_file_route_service as media_file_route_service
from backend.services.asset_registry_service import AssetRegistryService
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
            "endpoint": "http://127.0.0.1:9000",
            "size": len(file_bytes),
            "contentType": content_type,
            "secretAccessKey": "minio-secret",
            "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
        }

    def sanitize_error(self, error):
        return str(error).replace("minio-secret", "***")


class FakeStorageQuotaService:
    def __init__(self, *, allowed=True, reason="within_quota"):
        self.allowed = allowed
        self.reason = reason
        self.calls = []

    def preflight(self, request):
        self.calls.append(dict(request or {}))
        incoming_bytes = int((request or {}).get("incomingBytes") or 0)
        return {
            "success": True,
            "allowed": self.allowed,
            "reason": self.reason,
            "error": "" if self.allowed else "storage_quota_exceeded",
            "currentBytes": 90,
            "incomingBytes": incoming_bytes,
            "projectedBytes": 90 + incoming_bytes,
            "limitBytes": 100,
            "projectedPercent": 90 + incoming_bytes,
            "quota": {"enabled": True, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": True},
        }


class MediaFileRouteServiceDerivativeTest(unittest.TestCase):
    def make_service(self, tmpdir, storage_bucket_service=None, asset_registry_service=None, storage_quota_service=None):
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
        if asset_registry_service is not None:
            service.asset_registry_service = asset_registry_service
        if storage_quota_service is not None:
            service.storage_quota_service = storage_quota_service
        return service

    def make_asset_registry(self, tmpdir):
        return AssetRegistryService(assets_file_path=os.path.join(tmpdir, "user", "assets.json"))

    def load_asset_records(self, tmpdir):
        with open(os.path.join(tmpdir, "user", "assets.json"), "r", encoding="utf-8") as file:
            data = json.load(file)
        return data.get("assets", [])

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

    def test_save_output_with_enabled_storage_bucket_creates_ready_asset_without_secrets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(tmpdir, storage_bucket_service=bucket, asset_registry_service=registry)
            handler = FakeHandler(b"image-bytes", path="/api/v2/save_output?ext=png")

            result = service._handle_save_output(handler)

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertTrue(payload.get("assetId"))
            self.assertIsInstance(payload.get("asset"), dict)
            self.assertEqual(payload["assetId"], payload["asset"]["assetId"])
            self.assertEqual(payload["asset"]["type"], "image")
            self.assertEqual(payload["asset"]["url"], "https://cdn.example.com/ai-canvas/out.png")
            self.assertEqual(payload["asset"]["objectKey"], "ai-canvas/out.png")
            self.assertEqual(payload["asset"]["storage"]["type"], "s3-compatible")
            self.assertEqual(payload["asset"]["storage"]["bucket"], "canvas-assets")
            self.assertEqual(payload["asset"]["storage"]["endpoint"], "http://127.0.0.1:9000")
            serialized = json.dumps(payload["asset"], ensure_ascii=False)
            self.assertNotIn("secretAccessKey", serialized)
            self.assertNotIn("Authorization", serialized)
            self.assertNotIn("minio-secret", serialized)
            records = self.load_asset_records(tmpdir)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["assetId"], payload["assetId"])

    def test_save_output_without_storage_bucket_creates_local_ready_asset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(tmpdir, asset_registry_service=registry)
            handler = FakeHandler(b"image-bytes", path="/api/v2/save_output?ext=png")

            result = service._handle_save_output(handler)

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertTrue(payload.get("assetId"))
            self.assertEqual(payload["asset"]["type"], "image")
            self.assertEqual(payload["asset"]["storage"]["type"], "local")
            self.assertEqual(payload["asset"]["url"], "/output/out.png")
            self.assertEqual(payload["asset"]["localPath"], "output/out.png")
            records = self.load_asset_records(tmpdir)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["status"], "ready")

    def test_upload_failure_does_not_create_ready_asset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService(fail_message="upload failed with minio-secret")
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(tmpdir, storage_bucket_service=bucket, asset_registry_service=registry)
            handler = FakeHandler(b"image-bytes", path="/api/v2/save_output?ext=png")

            result = service._handle_save_output(handler)

            self.assertEqual(result["kind"], "json_err")
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "user", "assets.json")))

    def test_image_video_audio_outputs_create_assets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(tmpdir, asset_registry_service=registry)
            cases = [
                ("png", b"image-bytes", "image"),
                ("mp4", b"video-bytes", "video"),
                ("mp3", b"audio-bytes", "audio"),
            ]

            for ext, body, expected_type in cases:
                service._next_output_filename = lambda value, ext=ext: f"out.{ext}"
                result = service._handle_save_output(FakeHandler(body, path=f"/api/v2/save_output?ext={ext}"))
                self.assertEqual(result["kind"], "json_ok")
                self.assertTrue(result["data"].get("assetId"))
                self.assertEqual(result["data"]["asset"]["type"], expected_type)

            records = self.load_asset_records(tmpdir)
            self.assertEqual([record["type"] for record in records], ["image", "video", "audio"])

    def test_upload_with_enabled_storage_bucket_creates_asset_record(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(tmpdir, storage_bucket_service=bucket, asset_registry_service=registry)
            handler = FakeHandler(
                b"upload-bytes",
                path="/api/upload?filename=sample.png",
                headers={"Content-Type": "image/png"},
            )

            result = service._handle_upload(handler)

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertTrue(payload.get("assetId"))
            self.assertEqual(payload["asset"]["type"], "image")
            self.assertEqual(payload["asset"]["url"], "https://cdn.example.com/ai-canvas/sample.png")
            self.assertEqual(payload["asset"]["localPath"], "data/uploads/sample.png")
            records = self.load_asset_records(tmpdir)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["assetId"], payload["assetId"])

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
    def test_upload_quota_exceeded_does_not_write_upload_upload_bucket_or_create_asset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            quota = FakeStorageQuotaService(allowed=False, reason="quota_exceeded")
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(
                tmpdir,
                storage_bucket_service=bucket,
                asset_registry_service=registry,
                storage_quota_service=quota,
            )
            handler = FakeHandler(
                b"upload-bytes",
                path="/api/upload?filename=sample.png&nodeId=node-a&canvasId=canvas-a",
                headers={"Content-Type": "image/png"},
            )

            result = service._handle_upload(handler)

            self.assertEqual(result["kind"], "json_err")
            self.assertEqual(result["code"], 507)
            self.assertIn("storage_quota_exceeded", result["message"])
            self.assertEqual(quota.calls[0]["operation"], "upload")
            self.assertEqual(quota.calls[0]["assetType"], "image")
            self.assertEqual(quota.calls[0]["incomingBytes"], len(b"upload-bytes"))
            self.assertEqual(bucket.uploads, [])
            self.assertEqual(os.listdir(os.path.join(tmpdir, "data", "uploads")), [])
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "user", "assets.json")))

    def test_save_output_quota_exceeded_does_not_write_output_upload_bucket_or_create_asset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            quota = FakeStorageQuotaService(allowed=False, reason="quota_exceeded")
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(
                tmpdir,
                storage_bucket_service=bucket,
                asset_registry_service=registry,
                storage_quota_service=quota,
            )
            handler = FakeHandler(b"image-bytes", path="/api/v2/save_output?ext=png&nodeId=node-a&canvasId=canvas-a")

            result = service._handle_save_output(handler)

            self.assertEqual(result["kind"], "json_err")
            self.assertEqual(result["code"], 507)
            self.assertIn("storage_quota_exceeded", result["message"])
            self.assertEqual(quota.calls[0]["operation"], "save_output")
            self.assertEqual(quota.calls[0]["assetType"], "image")
            self.assertEqual(quota.calls[0]["incomingBytes"], len(b"image-bytes"))
            self.assertEqual(bucket.uploads, [])
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "output", "out.png")))
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "user", "assets.json")))

    def test_save_output_from_url_quota_exceeded_with_content_length_does_not_download(self):
        class FakeHeadResponse:
            headers = {"Content-Length": "11", "Content-Type": "image/png"}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        with tempfile.TemporaryDirectory() as tmpdir:
            bucket = FakeStorageBucketService()
            quota = FakeStorageQuotaService(allowed=False, reason="quota_exceeded")
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(
                tmpdir,
                storage_bucket_service=bucket,
                asset_registry_service=registry,
                storage_quota_service=quota,
            )
            handler = FakeHandler(
                json.dumps({"url": "https://runninghub.cn/result.png", "ext": "png", "nodeId": "node-a"}).encode("utf-8"),
                path="/api/v2/save_output_from_url",
            )
            requests = []
            original_urlopen = media_file_route_service.urllib.request.urlopen
            try:
                def fake_urlopen(request, timeout=0):
                    requests.append(request.get_method())
                    if request.get_method() == "HEAD":
                        return FakeHeadResponse()
                    raise AssertionError("GET should not be called when quota blocks by Content-Length")

                media_file_route_service.urllib.request.urlopen = fake_urlopen
                result = service._handle_save_output_from_url(handler)
            finally:
                media_file_route_service.urllib.request.urlopen = original_urlopen

            self.assertEqual(result["kind"], "json_err")
            self.assertEqual(result["code"], 507)
            self.assertEqual(requests, ["HEAD"])
            self.assertEqual(quota.calls[0]["operation"], "save_output_from_url")
            self.assertEqual(quota.calls[0]["incomingBytes"], 11)
            self.assertEqual(bucket.uploads, [])
            self.assertEqual(os.listdir(os.path.join(tmpdir, "output")), [])
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "user", "assets.json")))

    def test_save_output_from_url_unknown_length_download_then_quota_exceeded_cleans_file(self):
        class FakeHeadResponse:
            headers = {"Content-Type": "image/png"}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class FakeGetResponse:
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
            quota = FakeStorageQuotaService(allowed=False, reason="quota_exceeded")
            registry = self.make_asset_registry(tmpdir)
            service = self.make_service(
                tmpdir,
                storage_bucket_service=bucket,
                asset_registry_service=registry,
                storage_quota_service=quota,
            )
            handler = FakeHandler(
                json.dumps({"url": "https://runninghub.cn/result.png", "ext": "png"}).encode("utf-8"),
                path="/api/v2/save_output_from_url",
            )
            original_urlopen = media_file_route_service.urllib.request.urlopen
            try:
                def fake_urlopen(request, timeout=0):
                    if request.get_method() == "HEAD":
                        return FakeHeadResponse()
                    return FakeGetResponse()

                media_file_route_service.urllib.request.urlopen = fake_urlopen
                result = service._handle_save_output_from_url(handler)
            finally:
                media_file_route_service.urllib.request.urlopen = original_urlopen

            self.assertEqual(result["kind"], "json_err")
            self.assertEqual(result["code"], 507)
            self.assertEqual([call["incomingBytes"] for call in quota.calls], [len(b"remote-bytes")])
            self.assertEqual(bucket.uploads, [])
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "output", "out.png")))
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "user", "assets.json")))


if __name__ == "__main__":
    unittest.main()