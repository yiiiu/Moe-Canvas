import json
import os
import tempfile
import threading
import unittest
import urllib.request

import server
from backend.services.asset_usage_index_service import AssetUsageIndexService


class AssetUsageIndexRouteTest(unittest.TestCase):
    def _start_http_server(self):
        httpd = server.QuietThreadingTCPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"

    def _json_request(self, url, payload=None, method="GET"):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def test_rebuild_usage_index_route_updates_registry_and_returns_summary(self):
        previous = getattr(server, "ASSET_USAGE_INDEX_SERVICE", None)
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            self._write_json(
                assets_file,
                {"version": 1, "assets": [{"assetId": "asset_route_used", "type": "image", "url": "/output/u.png"}]},
            )
            self._write_json(
                os.path.join(canvas_dir, "route-project.json"),
                {"canvases": [{"id": "canvas_route", "nodes": [{"id": "node_route", "type": "source-image", "assetId": "asset_route_used"}]}]},
            )
            server.ASSET_USAGE_INDEX_SERVICE = AssetUsageIndexService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: canvas_dir,
            )
            httpd, base_url = self._start_http_server()
            try:
                payload = self._json_request(f"{base_url}/api/v2/assets/rebuild-usage-index", {}, method="POST")
            finally:
                httpd.shutdown()
                server.ASSET_USAGE_INDEX_SERVICE = previous

            with open(assets_file, "r", encoding="utf-8-sig") as file:
                registry = json.load(file)

        self.assertTrue(payload["success"])
        self.assertEqual(payload["scannedProjects"], 1)
        self.assertEqual(payload["usedAssets"], 1)
        self.assertEqual(registry["assets"][0]["usage"]["usageCount"], 1)

    def test_usage_and_orphans_routes_return_sanitized_payloads(self):
        previous = getattr(server, "ASSET_USAGE_INDEX_SERVICE", None)
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            self._write_json(
                assets_file,
                {
                    "version": 1,
                    "assets": [
                        {
                            "assetId": "asset_route_orphan",
                            "type": "audio",
                            "url": "/output/o.mp3",
                            "secretAccessKey": "must-not-return",
                            "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
                            "storage": {"type": "s3-compatible", "bucket": "safe", "signature": "must-not-return"},
                        }
                    ],
                },
            )
            self._write_json(os.path.join(canvas_dir, "empty.json"), {"nodes": []})
            service = AssetUsageIndexService(assets_file_path=assets_file, canvas_dir_getter=lambda: canvas_dir)
            service.rebuild_usage_index()
            server.ASSET_USAGE_INDEX_SERVICE = service
            httpd, base_url = self._start_http_server()
            try:
                usage = self._json_request(f"{base_url}/api/v2/assets/usage/asset_route_orphan")
                orphans = self._json_request(f"{base_url}/api/v2/assets/orphans")
            finally:
                httpd.shutdown()
                server.ASSET_USAGE_INDEX_SERVICE = previous

        serialized = json.dumps({"usage": usage, "orphans": orphans}, ensure_ascii=False)
        self.assertTrue(usage["success"])
        self.assertEqual(usage["usage"]["assetId"], "asset_route_orphan")
        self.assertTrue(orphans["success"])
        self.assertEqual(orphans["assets"][0]["assetId"], "asset_route_orphan")
        self.assertEqual(orphans["assets"][0]["storage"]["type"], "s3-compatible")
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)
        self.assertNotIn("signature", serialized)


if __name__ == "__main__":
    unittest.main()