import json
import os
import ssl
import tempfile
import unittest
from unittest import mock

from backend.services.media_file_route_service import MediaFileRouteService


class DummyHandler:
    def __init__(self, body):
        self.body = body
        self.headers = {}
        self.path = "/api/v2/save_output_from_url"


class FailingStorageBucketService:
    def is_enabled(self):
        return True

    def upload_media_bytes(self, *args, **kwargs):
        raise RuntimeError("minio tls reset")

    def sanitize_error(self, exc):
        return str(exc)


class FakeDownloadResponse:
    def __init__(self, *, body=b"", content_type="image/png"):
        self._body = body
        self._offset = 0
        self.headers = {
            "Content-Type": content_type,
            "Content-Length": str(len(body)),
        }

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, size=-1):
        if self._offset >= len(self._body):
            return b""
        if size is None or size < 0:
            size = len(self._body) - self._offset
        chunk = self._body[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk


class MediaFileRouteServiceSaveOutputFromUrlTest(unittest.TestCase):
    def _create_service(self, tmpdir, storage_bucket_service=None):
        output_dir = os.path.join(tmpdir, "output")
        return MediaFileRouteService(
            directory=tmpdir,
            uploads_dir_getter=lambda: os.path.join(tmpdir, "uploads"),
            output_dir_getter=lambda: output_dir,
            max_upload_bytes=1024 * 1024,
            next_output_filename=lambda ext: f"gen_0001.{ext or 'bin'}",
            load_json_file=lambda path: {},
            atomic_write_json=lambda path, data: None,
            read_body=lambda handler, limit=None: handler.body,
            storage_bucket_service=storage_bucket_service,
        )

    def test_save_output_from_url_returns_remote_fallback_when_download_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            service = self._create_service(tmpdir)
            source_url = "https://grsai-file.dakka.com.cn/generated/result.png"
            body = json.dumps({"url": source_url, "ext": "png"}).encode("utf-8")
            handler = DummyHandler(body)

            with mock.patch(
                "backend.services.media_file_route_service.urllib.request.urlopen",
                side_effect=ssl.SSLError("UNEXPECTED_EOF_WHILE_READING"),
            ):
                result = service.handle_post(handler, "/api/v2/save_output_from_url")

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertTrue(payload["success"])
            self.assertFalse(payload["saved"])
            self.assertEqual(payload["url"], source_url)
            self.assertEqual(payload["displayUrl"], source_url)
            self.assertEqual(payload["originalUrl"], source_url)
            self.assertEqual(payload["localPath"], "")
            self.assertEqual(payload["storage"], "remote-fallback")
            self.assertIn("Download failed", payload["saveWarning"])
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "output", "gen_0001.png")))

    def test_save_output_from_url_keeps_local_result_when_storage_upload_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            service = self._create_service(tmpdir, storage_bucket_service=FailingStorageBucketService())
            source_url = "https://grsai-file.dakka.com.cn/generated/result.png"
            body = json.dumps({"url": source_url, "ext": "png"}).encode("utf-8")
            handler = DummyHandler(body)

            def fake_urlopen(request, timeout=0):
                return FakeDownloadResponse(body=b"png bytes", content_type="image/png")

            with mock.patch(
                "backend.services.media_file_route_service.urllib.request.urlopen",
                side_effect=fake_urlopen,
            ):
                result = service.handle_post(handler, "/api/v2/save_output_from_url")

            self.assertEqual(result["kind"], "json_ok")
            payload = result["data"]
            self.assertTrue(payload["success"])
            self.assertTrue(payload["saved"])
            self.assertTrue(payload["persisted"])
            self.assertEqual(payload["localPath"], "output/gen_0001.png")
            self.assertEqual(payload["url"], "/output/gen_0001.png")
            self.assertEqual(payload["storage"], "local")
            self.assertTrue(payload["storageUploadFailed"])
            self.assertIn("自定义存储桶上传失败", payload["storageWarning"])
            self.assertTrue(os.path.exists(os.path.join(tmpdir, "output", "gen_0001.png")))


if __name__ == "__main__":
    unittest.main()