import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server
from backend.services.asset_lifecycle_service import AssetLifecycleService


class FakeStorageBucketService:
    def __init__(self):
        self.deleted_keys = []

    def delete_object(self, object_key, bucket_name=""):
        self.deleted_keys.append({"objectKey": object_key, "bucket": bucket_name})
        return {"success": True}


class AssetLifecycleRouteTest(unittest.TestCase):
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

    def _read_json(self, path):
        with open(path, "r", encoding="utf-8-sig") as file:
            return json.load(file)

    def test_cleanup_candidates_route_returns_only_orphan_assets(self):
        previous = getattr(server, "ASSET_LIFECYCLE_SERVICE", None)
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
                            "assetId": "asset_orphan",
                            "type": "image",
                            "url": "https://cdn.example/o.png",
                            "objectKey": "media/o.png",
                            "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                            "usage": {"usageCount": 0, "references": []},
                            "lifecycleStatus": "orphan",
                        },
                        {
                            "assetId": "asset_active",
                            "type": "image",
                            "url": "https://cdn.example/a.png",
                            "objectKey": "media/a.png",
                            "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                            "usage": {"usageCount": 1, "references": [{"nodeId": "node"}]},
                            "lifecycleStatus": "active",
                        },
                    ],
                },
            )
            server.ASSET_LIFECYCLE_SERVICE = AssetLifecycleService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: canvas_dir,
                storage_bucket_service=FakeStorageBucketService(),
                local_root_dir=tmpdir,
            )
            httpd, base_url = self._start_http_server()
            try:
                payload = self._json_request(f"{base_url}/api/v2/assets/cleanup-candidates")
            finally:
                httpd.shutdown()
                server.ASSET_LIFECYCLE_SERVICE = previous

        self.assertTrue(payload["success"])
        self.assertEqual([item["assetId"] for item in payload["assets"]], ["asset_orphan"])
        self.assertEqual(payload["assets"][0]["storage"], {"type": "s3-compatible", "bucket": "safe-bucket"})

    def test_delete_route_supports_dry_run_and_real_delete(self):
        previous = getattr(server, "ASSET_LIFECYCLE_SERVICE", None)
        storage = FakeStorageBucketService()
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
                            "assetId": "asset_orphan",
                            "type": "image",
                            "url": "https://cdn.example/o.png",
                            "objectKey": "media/o.png",
                            "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                            "usage": {"usageCount": 0, "references": []},
                            "lifecycleStatus": "orphan",
                        },
                        {
                            "assetId": "asset_active",
                            "type": "image",
                            "url": "https://cdn.example/a.png",
                            "objectKey": "media/a.png",
                            "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                            "usage": {"usageCount": 0, "references": []},
                            "lifecycleStatus": "orphan",
                        },
                    ],
                },
            )
            self._write_json(
                os.path.join(canvas_dir, "project.json"),
                {"nodes": [{"id": "node", "type": "source-image", "assetId": "asset_active"}]},
            )
            server.ASSET_LIFECYCLE_SERVICE = AssetLifecycleService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: canvas_dir,
                storage_bucket_service=storage,
                local_root_dir=tmpdir,
            )
            httpd, base_url = self._start_http_server()
            try:
                dry_run = self._json_request(
                    f"{base_url}/api/v2/assets/delete",
                    {"assetIds": ["asset_orphan", "asset_active", "asset_missing"], "dryRun": True},
                    method="POST",
                )
                real_delete = self._json_request(
                    f"{base_url}/api/v2/assets/delete",
                    {"assetIds": ["asset_orphan", "asset_active"], "dryRun": False},
                    method="POST",
                )
            finally:
                httpd.shutdown()
                server.ASSET_LIFECYCLE_SERVICE = previous
            registry = self._read_json(assets_file)

        dry_by_id = {item["assetId"]: item for item in dry_run["results"]}
        real_by_id = {item["assetId"]: item for item in real_delete["results"]}
        asset_by_id = {item["assetId"]: item for item in registry["assets"]}

        self.assertTrue(dry_by_id["asset_orphan"]["canDelete"])
        self.assertEqual(dry_by_id["asset_orphan"]["reason"], "orphan_asset")
        self.assertFalse(dry_by_id["asset_missing"]["canDelete"])
        self.assertEqual(dry_by_id["asset_missing"]["reason"], "asset_not_found")
        self.assertTrue(real_by_id["asset_orphan"]["deleted"])
        self.assertEqual(real_by_id["asset_active"]["reason"], "asset_in_use")
        self.assertEqual(storage.deleted_keys, [{"objectKey": "media/o.png", "bucket": "safe-bucket"}])
        self.assertEqual(asset_by_id["asset_orphan"]["lifecycleStatus"], "deleted")
        self.assertEqual(asset_by_id["asset_active"]["lifecycleStatus"], "active")

    def test_delete_route_rejects_invalid_json(self):
        httpd, base_url = self._start_http_server()
        try:
            request = urllib.request.Request(
                f"{base_url}/api/v2/assets/delete",
                data=b"{",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=5)
        finally:
            httpd.shutdown()

        self.assertEqual(caught.exception.code, 400)


if __name__ == "__main__":
    unittest.main()