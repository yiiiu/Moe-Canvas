import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server
from backend.services.asset_registry_service import AssetRegistryService


class AssetRegistryQueryRouteTest(unittest.TestCase):
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

    def test_get_asset_route_returns_sanitized_asset(self):
        previous = server.ASSET_REGISTRY_SERVICE
        with tempfile.TemporaryDirectory() as tmpdir:
            assets_file = os.path.join(tmpdir, "user", "assets.json")
            registry = AssetRegistryService(assets_file_path=assets_file)
            registry.create_ready_asset({
                "assetId": "asset_route_image",
                "type": "image",
                "url": "https://cdn.example.com/route-image.png",
                "storage": {"type": "s3-compatible", "bucket": "canvas-assets", "endpoint": "http://127.0.0.1:9000"},
            })
            with open(assets_file, "r+", encoding="utf-8") as file:
                data = json.load(file)
                data["assets"][0]["secretAccessKey"] = "should-not-return"
                data["assets"][0]["Authorization"] = "AWS4-HMAC-SHA256 Signature=abc"
                file.seek(0)
                json.dump(data, file, ensure_ascii=False)
                file.truncate()
            server.ASSET_REGISTRY_SERVICE = registry
            httpd, base_url = self._start_http_server()
            try:
                payload = self._json_request(f"{base_url}/api/v2/assets/asset_route_image")
            finally:
                httpd.shutdown()
                server.ASSET_REGISTRY_SERVICE = previous

        self.assertTrue(payload["success"])
        self.assertEqual(payload["asset"]["assetId"], "asset_route_image")
        self.assertEqual(payload["asset"]["url"], "https://cdn.example.com/route-image.png")
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)

    def test_batch_asset_route_returns_existing_assets_only(self):
        previous = server.ASSET_REGISTRY_SERVICE
        with tempfile.TemporaryDirectory() as tmpdir:
            registry = AssetRegistryService(assets_file_path=os.path.join(tmpdir, "user", "assets.json"))
            registry.create_ready_asset({"assetId": "asset_batch_a", "type": "image", "url": "/output/a.png"})
            registry.create_ready_asset({"assetId": "asset_batch_b", "type": "audio", "url": "/output/b.mp3"})
            server.ASSET_REGISTRY_SERVICE = registry
            httpd, base_url = self._start_http_server()
            try:
                payload = self._json_request(
                    f"{base_url}/api/v2/assets/batch",
                    {"assetIds": ["asset_batch_b", "missing", "asset_batch_a"]},
                    method="POST",
                )
            finally:
                httpd.shutdown()
                server.ASSET_REGISTRY_SERVICE = previous

        self.assertTrue(payload["success"])
        self.assertEqual([asset["assetId"] for asset in payload["assets"]], ["asset_batch_b", "asset_batch_a"])

    def test_get_missing_asset_route_returns_404(self):
        previous = server.ASSET_REGISTRY_SERVICE
        with tempfile.TemporaryDirectory() as tmpdir:
            server.ASSET_REGISTRY_SERVICE = AssetRegistryService(assets_file_path=os.path.join(tmpdir, "user", "assets.json"))
            httpd, base_url = self._start_http_server()
            try:
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    self._json_request(f"{base_url}/api/v2/assets/missing")
                self.assertEqual(ctx.exception.code, 404)
            finally:
                httpd.shutdown()
                server.ASSET_REGISTRY_SERVICE = previous


if __name__ == "__main__":
    unittest.main()