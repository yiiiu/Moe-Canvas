import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server
from backend.services.storage_quota_service import StorageQuotaService


class StorageQuotaRouteTest(unittest.TestCase):
    def _start_http_server(self):
        httpd = server.QuietThreadingTCPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"

    def _json_post(self, url, payload):
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def test_storage_quota_preflight_route_returns_sanitized_projection(self):
        previous = getattr(server, "STORAGE_QUOTA_SERVICE", None)
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
                            "size": 90,
                            "lifecycleStatus": "active",
                        }
                    ],
                },
            )
            self._write_json(
                settings_file,
                {
                    "storageQuota": {
                        "enabled": True,
                        "limitBytes": 100,
                        "warningPercent": 80,
                        "blockWhenExceeded": True,
                        "secretAccessKey": "must-not-return",
                    }
                },
            )
            server.STORAGE_QUOTA_SERVICE = StorageQuotaService(
                assets_file_path=assets_file,
                settings_file_getter=lambda: settings_file,
            )
            httpd, base_url = self._start_http_server()
            try:
                status, payload = self._json_post(
                    f"{base_url}/api/v2/storage/quota/preflight",
                    {
                        "operation": "upload",
                        "assetType": "image",
                        "incomingBytes": 20,
                        "sourceUrl": "https://user:password@example.invalid/private.png?Signature=abc",
                    },
                )
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.STORAGE_QUOTA_SERVICE = previous

        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])
        self.assertFalse(payload["allowed"])
        self.assertEqual(payload["reason"], "quota_exceeded")
        self.assertEqual(payload["projectedBytes"], 110)
        self.assertEqual(payload["error"], "storage_quota_exceeded")
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)
        self.assertNotIn("password", serialized)


if __name__ == "__main__":
    unittest.main()