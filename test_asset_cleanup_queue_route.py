import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server
from backend.services.asset_cleanup_queue_service import AssetCleanupQueueService
from backend.services.asset_lifecycle_service import AssetLifecycleService


class FakeStorageBucketService:
    def __init__(self):
        self.deleted_keys = []

    def delete_object(self, object_key, bucket_name=""):
        self.deleted_keys.append({"objectKey": object_key, "bucket": bucket_name})
        return {"success": True}


class AssetCleanupQueueRouteTest(unittest.TestCase):
    def _start_http_server(self):
        httpd = server.QuietThreadingTCPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"

    def _json_request(self, url, payload=None, method="GET"):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _read_json(self, path):
        with open(path, "r", encoding="utf-8-sig") as file:
            return json.load(file)

    def _asset(self, asset_id, **overrides):
        asset = {
            "assetId": asset_id,
            "type": "image",
            "url": f"/output/{asset_id}.png",
            "localPath": os.path.join(self.tmpdir, "output", f"{asset_id}.png"),
            "objectKey": f"media/{asset_id}.png",
            "storage": {"type": "local", "bucket": ""},
            "size": 100,
            "createdAt": 1000,
            "candidateAt": 2000,
            "lifecycleReason": "retention_orphan_expired",
            "usage": {"usageCount": 0, "references": []},
            "lifecycleStatus": "deleted_candidate",
            "pinned": False,
        }
        asset.update(overrides)
        return asset

    def _install_service(self, assets_file, canvas_dir, storage):
        previous_lifecycle = getattr(server, "ASSET_LIFECYCLE_SERVICE", None)
        previous_cleanup_queue = getattr(server, "ASSET_CLEANUP_QUEUE_SERVICE", None)
        lifecycle_service = AssetLifecycleService(
            assets_file_path=assets_file,
            canvas_dir_getter=lambda: canvas_dir,
            storage_bucket_service=storage,
            local_root_dir=self.tmpdir,
        )
        server.ASSET_LIFECYCLE_SERVICE = lifecycle_service
        server.ASSET_CLEANUP_QUEUE_SERVICE = AssetCleanupQueueService(
            assets_file_path=assets_file,
            canvas_dir_getter=lambda: canvas_dir,
            lifecycle_service=lifecycle_service,
            local_root_dir=self.tmpdir,
        )
        return previous_lifecycle, previous_cleanup_queue

    def _restore_service(self, previous):
        server.ASSET_LIFECYCLE_SERVICE, server.ASSET_CLEANUP_QUEUE_SERVICE = previous

    def test_cleanup_queue_routes_list_dry_run_delete_and_reject(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.tmpdir = tmpdir
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            local_file = os.path.join(tmpdir, "output", "asset_local.png")
            os.makedirs(os.path.dirname(local_file), exist_ok=True)
            with open(local_file, "wb") as file:
                file.write(b"local")
            storage = FakeStorageBucketService()
            self._write_json(
                assets_file,
                {
                    "version": 1,
                    "assets": [
                        self._asset("asset_local", localPath=local_file, size=5),
                        self._asset("asset_s3", type="video", objectKey="videos/asset_s3.mp4", storage={"type": "s3-compatible", "bucket": "safe"}, size=7),
                        self._asset("asset_pinned", pinned=True, size=11),
                        self._asset("asset_orphan", lifecycleStatus="orphan"),
                        self._asset("asset_active", lifecycleStatus="active"),
                    ],
                },
            )
            previous = self._install_service(assets_file, canvas_dir, storage)
            httpd, base_url = self._start_http_server()
            try:
                list_status, list_payload = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-queue?sort=size_desc&page=1&pageSize=10"
                )
                dry_status, dry_payload = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-queue/dry-run",
                    {"assetIds": ["asset_local", "asset_pinned", "asset_missing"]},
                    method="POST",
                )
                before_delete = self._read_json(assets_file)
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    self._json_request(
                        f"{base_url}/api/v2/assets/cleanup-queue/delete",
                        {"assetIds": ["asset_local"], "confirm": False},
                        method="POST",
                    )
                delete_status, delete_payload = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-queue/delete",
                    {"assetIds": ["asset_local", "asset_s3", "asset_pinned"], "confirm": True},
                    method="POST",
                )
                reject_status, reject_payload = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-queue/reject",
                    {"assetIds": ["asset_pinned"], "reason": "keep"},
                    method="POST",
                )
            finally:
                httpd.shutdown()
                httpd.server_close()
                self._restore_service(previous)
            after = self._read_json(assets_file)

        self.assertEqual(list_status, 200)
        self.assertEqual(dry_status, 200)
        self.assertEqual(delete_status, 200)
        self.assertEqual(reject_status, 200)
        self.assertEqual(denied.exception.code, 400)
        self.assertEqual(list_payload["summary"]["totalCount"], 3)
        self.assertEqual([item["assetId"] for item in list_payload["queue"]], ["asset_pinned", "asset_s3", "asset_local"])
        self.assertEqual(before_delete["assets"][0]["lifecycleStatus"], "deleted_candidate")
        dry_by_id = {item["assetId"]: item for item in dry_payload["results"]}
        self.assertTrue(dry_by_id["asset_local"]["canDelete"])
        self.assertEqual(dry_by_id["asset_local"]["releasableBytes"], 5)
        self.assertFalse(dry_by_id["asset_pinned"]["canDelete"])
        self.assertEqual(dry_by_id["asset_pinned"]["reason"], "asset_pinned")
        self.assertEqual(dry_by_id["asset_missing"]["reason"], "asset_not_found")
        delete_by_id = {item["assetId"]: item for item in delete_payload["results"]}
        self.assertTrue(delete_by_id["asset_local"]["deleted"])
        self.assertTrue(delete_by_id["asset_s3"]["deleted"])
        self.assertFalse(delete_by_id["asset_pinned"]["deleted"])
        self.assertFalse(os.path.exists(local_file))
        self.assertEqual(storage.deleted_keys, [{"objectKey": "videos/asset_s3.mp4", "bucket": "safe"}])
        asset_by_id = {item["assetId"]: item for item in after["assets"]}
        self.assertEqual(asset_by_id["asset_local"]["lifecycleStatus"], "deleted")
        self.assertEqual(asset_by_id["asset_s3"]["cleanupQueue"]["reviewStatus"], "deleted")
        self.assertEqual(asset_by_id["asset_pinned"]["lifecycleStatus"], "orphan")
        self.assertEqual(asset_by_id["asset_pinned"]["cleanupQueue"]["reviewStatus"], "rejected")
        self.assertTrue(reject_payload["results"][0]["rejected"])

    def test_cleanup_queue_route_filtering_and_secret_sanitization(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.tmpdir = tmpdir
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            storage = FakeStorageBucketService()
            self._write_json(
                assets_file,
                {
                    "version": 1,
                    "assets": [
                        self._asset(
                            "asset_secret",
                            type="video",
                            storage={"type": "s3-compatible", "bucket": "safe", "secretAccessKey": "must-not-return"},
                            Authorization="AWS4-HMAC-SHA256 Signature=abc",
                            url="https://cdn.example/asset.mp4?Signature=abc",
                        ),
                        self._asset("asset_image", type="image", storage={"type": "local"}),
                    ],
                },
            )
            previous = self._install_service(assets_file, canvas_dir, storage)
            httpd, base_url = self._start_http_server()
            try:
                _, payload = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-queue?type=video&storageType=s3-compatible&bucket=safe"
                )
            finally:
                httpd.shutdown()
                httpd.server_close()
                self._restore_service(previous)

        self.assertEqual([item["assetId"] for item in payload["queue"]], ["asset_secret"])
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature=abc", serialized)


if __name__ == "__main__":
    unittest.main()