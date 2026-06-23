import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

import server
from backend.services.asset_cleanup_executor_service import AssetCleanupExecutorService
from backend.services.asset_cleanup_queue_service import AssetCleanupQueueService
from backend.services.asset_lifecycle_service import AssetLifecycleService


class FakeStorageBucketService:
    def __init__(self):
        self.deleted_keys = []
        self.failures = {}

    def delete_object(self, object_key, bucket_name=""):
        if object_key in self.failures:
            raise RuntimeError(self.failures[object_key])
        self.deleted_keys.append({"objectKey": object_key, "bucket": bucket_name})
        return {"success": True}


class AssetCleanupExecutorRouteTest(unittest.TestCase):
    def setUp(self):
        self.now = 200000

    def _now_ms(self):
        self.now += 1000
        return self.now

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

    def _install_service(self, assets_file, jobs_file, canvas_dir, storage):
        previous = (
            getattr(server, "ASSET_LIFECYCLE_SERVICE", None),
            getattr(server, "ASSET_CLEANUP_QUEUE_SERVICE", None),
            getattr(server, "ASSET_CLEANUP_EXECUTOR_SERVICE", None),
        )
        lifecycle_service = AssetLifecycleService(
            assets_file_path=assets_file,
            canvas_dir_getter=lambda: canvas_dir,
            storage_bucket_service=storage,
            local_root_dir=self.tmpdir,
        )
        cleanup_queue_service = AssetCleanupQueueService(
            assets_file_path=assets_file,
            canvas_dir_getter=lambda: canvas_dir,
            lifecycle_service=lifecycle_service,
            local_root_dir=self.tmpdir,
            now_ms_getter=self._now_ms,
        )
        cleanup_executor_service = AssetCleanupExecutorService(
            jobs_file_path=jobs_file,
            assets_file_path=assets_file,
            canvas_dir_getter=lambda: canvas_dir,
            lifecycle_service=lifecycle_service,
            cleanup_queue_service=cleanup_queue_service,
            local_root_dir=self.tmpdir,
            now_ms_getter=self._now_ms,
            auto_start_worker=False,
        )
        server.ASSET_LIFECYCLE_SERVICE = lifecycle_service
        server.ASSET_CLEANUP_QUEUE_SERVICE = cleanup_queue_service
        server.ASSET_CLEANUP_EXECUTOR_SERVICE = cleanup_executor_service
        return previous

    def _restore_service(self, previous):
        server.ASSET_LIFECYCLE_SERVICE, server.ASSET_CLEANUP_QUEUE_SERVICE, server.ASSET_CLEANUP_EXECUTOR_SERVICE = previous

    def test_cleanup_job_routes_create_poll_list_cancel_and_retry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.tmpdir = tmpdir
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            jobs_file = os.path.join(user_dir, "cleanup_jobs.json")
            os.makedirs(os.path.join(tmpdir, "output"), exist_ok=True)
            local_file = os.path.join(tmpdir, "output", "asset_local.png")
            with open(local_file, "wb") as file:
                file.write(b"local")
            storage = FakeStorageBucketService()
            storage.failures["media/asset_retry.png"] = "temporary_error secretAccessKey=raw Signature=abc"
            self._write_json(
                assets_file,
                {
                    "version": 1,
                    "assets": [
                        self._asset("asset_local", localPath=local_file, storage={"type": "local"}, size=5),
                        self._asset("asset_retry", objectKey="media/asset_retry.png", storage={"type": "s3-compatible", "bucket": "safe"}, size=9),
                    ],
                },
            )
            previous = self._install_service(assets_file, jobs_file, canvas_dir, storage)
            httpd, base_url = self._start_http_server()
            try:
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    self._json_request(
                        f"{base_url}/api/v2/assets/cleanup-jobs",
                        {"assetIds": ["asset_local"], "confirm": False},
                        method="POST",
                    )
                create_status, created = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-jobs",
                    {"assetIds": ["asset_local", "asset_retry"], "confirm": True},
                    method="POST",
                )
                job_id = created["cleanupJobId"]
                queued_status, queued = self._json_request(f"{base_url}/api/v2/assets/cleanup-jobs/{urllib.parse.quote(job_id)}")
                server.ASSET_CLEANUP_EXECUTOR_SERVICE.run_pending_jobs_once()
                done_status, done = self._json_request(f"{base_url}/api/v2/assets/cleanup-jobs/{urllib.parse.quote(job_id)}")
                list_status, listed = self._json_request(f"{base_url}/api/v2/assets/cleanup-jobs?limit=5")
                storage.failures = {}
                retry_status, retried = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-jobs/{urllib.parse.quote(job_id)}/retry",
                    {},
                    method="POST",
                )
                cancel_create = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-jobs",
                    {"assetIds": ["asset_retry"], "confirm": True},
                    method="POST",
                )[1]
                cancel_status, canceled = self._json_request(
                    f"{base_url}/api/v2/assets/cleanup-jobs/{urllib.parse.quote(cancel_create['cleanupJobId'])}/cancel",
                    {},
                    method="POST",
                )
            finally:
                httpd.shutdown()
                httpd.server_close()
                self._restore_service(previous)
            registry = self._read_json(assets_file)

        self.assertEqual(denied.exception.code, 400)
        self.assertEqual(create_status, 200)
        self.assertEqual(queued_status, 200)
        self.assertEqual(done_status, 200)
        self.assertEqual(list_status, 200)
        self.assertEqual(retry_status, 200)
        self.assertEqual(cancel_status, 200)
        self.assertEqual(created["status"], "pending")
        self.assertEqual(queued["job"]["processedCount"], 0)
        self.assertEqual(done["job"]["status"], "partial_failed")
        self.assertEqual(done["job"]["processedCount"], 2)
        self.assertGreater(done["job"]["lastHeartbeatAt"], 0)
        self.assertEqual(retried["job"]["status"], "success")
        self.assertEqual(canceled["job"]["status"], "canceled")
        self.assertEqual(listed["jobs"][0]["cleanupJobId"], job_id)
        serialized = json.dumps(done, ensure_ascii=False) + json.dumps(retried, ensure_ascii=False)
        self.assertNotIn("secretAccessKey=raw", serialized)
        self.assertNotIn("Signature=abc", serialized)
        asset_by_id = {item["assetId"]: item for item in registry["assets"]}
        self.assertEqual(asset_by_id["asset_local"]["lifecycleStatus"], "deleted")
        self.assertEqual(asset_by_id["asset_local"]["cleanupJobId"], job_id)
        self.assertFalse(os.path.exists(local_file))

    def test_cleanup_job_routes_are_before_generic_asset_route(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.tmpdir = tmpdir
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            jobs_file = os.path.join(user_dir, "cleanup_jobs.json")
            storage = FakeStorageBucketService()
            self._write_json(assets_file, {"version": 1, "assets": []})
            previous = self._install_service(assets_file, jobs_file, canvas_dir, storage)
            httpd, base_url = self._start_http_server()
            try:
                status, payload = self._json_request(f"{base_url}/api/v2/assets/cleanup-jobs")
            finally:
                httpd.shutdown()
                httpd.server_close()
                self._restore_service(previous)

        self.assertEqual(status, 200)
        self.assertTrue(payload["success"])
        self.assertEqual(payload["jobs"], [])


if __name__ == "__main__":
    unittest.main()