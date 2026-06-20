import json
import os
import tempfile
import threading
import unittest
import urllib.request

import server
from backend.services.storage_usage_service import StorageUsageService


class StorageUsageRouteTest(unittest.TestCase):
    def _start_http_server(self):
        httpd = server.QuietThreadingTCPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"

    def _json_request(self, url):
        request = urllib.request.Request(url, headers={"Content-Type": "application/json"}, method="GET")
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def test_storage_usage_route_returns_usage_and_quota_without_secrets(self):
        previous = getattr(server, "STORAGE_USAGE_SERVICE", None)
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            assets_file = os.path.join(user_dir, "assets.json")
            settings_file = os.path.join(user_dir, "settings.json")
            self._write_json(
                assets_file,
                {
                    "version": 1,
                    "assets": [
                        {
                            "assetId": "asset_route_active",
                            "status": "ready",
                            "type": "image",
                            "size": 80,
                            "lifecycleStatus": "active",
                            "storage": {"type": "local"},
                            "usage": {"usageCount": 1, "references": [{"projectId": "project-a"}]},
                        },
                        {
                            "assetId": "asset_route_orphan",
                            "status": "ready",
                            "type": "video",
                            "size": 30,
                            "lifecycleStatus": "orphan",
                            "secretAccessKey": "must-not-return",
                            "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
                            "storage": {"type": "s3-compatible", "bucket": "safe", "signature": "must-not-return"},
                        },
                        {
                            "assetId": "asset_route_deleted",
                            "status": "ready",
                            "type": "audio",
                            "size": 20,
                            "lifecycleStatus": "deleted",
                        },
                    ],
                },
            )
            self._write_json(
                settings_file,
                {"storageQuota": {"enabled": True, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": False}},
            )
            server.STORAGE_USAGE_SERVICE = StorageUsageService(
                assets_file_path=assets_file,
                settings_file_getter=lambda: settings_file,
            )
            httpd, base_url = self._start_http_server()
            try:
                payload = self._json_request(f"{base_url}/api/v2/storage/usage")
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.STORAGE_USAGE_SERVICE = previous

        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["usage"]["totalBytes"], 110)
        self.assertEqual(payload["usage"]["orphanBytes"], 30)
        self.assertEqual(payload["usage"]["deletedBytes"], 20)
        self.assertEqual(payload["quota"]["usedPercent"], 110)
        self.assertEqual(payload["quota"]["isExceeded"], True)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)
        self.assertNotIn("signature", serialized)


if __name__ == "__main__":
    unittest.main()