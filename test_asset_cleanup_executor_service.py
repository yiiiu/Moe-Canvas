import json
import os
import tempfile
import unittest

from backend.services.asset_cleanup_executor_service import AssetCleanupExecutorService
from backend.services.asset_cleanup_queue_service import AssetCleanupQueueService
from backend.services.asset_lifecycle_service import AssetLifecycleService


class FakeStorageBucketService:
    def __init__(self):
        self.deleted_keys = []
        self.checked_keys = []
        self.failures = {}
        self.existing_keys = set()

    def object_exists(self, object_key, bucket_name=""):
        self.checked_keys.append({"objectKey": object_key, "bucket": bucket_name})
        return object_key in self.existing_keys

    def delete_object(self, object_key, bucket_name=""):
        if object_key in self.failures:
            raise RuntimeError(self.failures[object_key])
        self.deleted_keys.append({"objectKey": object_key, "bucket": bucket_name})
        return {"success": True}


class AssetCleanupExecutorServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.user_dir = os.path.join(root, "user")
        self.canvas_dir = os.path.join(self.user_dir, "Canvas Project")
        os.makedirs(self.canvas_dir, exist_ok=True)
        self.assets_file = os.path.join(self.user_dir, "assets.json")
        self.jobs_file = os.path.join(self.user_dir, "cleanup_jobs.json")
        self.storage = FakeStorageBucketService()
        self.now = 100000

    def tearDown(self):
        self.temp_dir.cleanup()

    def _now_ms(self):
        self.now += 1000
        return self.now

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _read_json(self, path):
        with open(path, "r", encoding="utf-8-sig") as file:
            return json.load(file)

    def _read_assets(self):
        return self._read_json(self.assets_file)

    def _asset(self, asset_id, **overrides):
        asset = {
            "assetId": asset_id,
            "type": "image",
            "url": f"/output/{asset_id}.png",
            "localPath": os.path.join(self.temp_dir.name, "output", f"{asset_id}.png"),
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

    def _seed_assets(self, assets):
        self._write_json(self.assets_file, {"version": 1, "assets": assets})

    def _make_local_file(self, asset_id, content=b"asset"):
        path = os.path.join(self.temp_dir.name, "output", f"{asset_id}.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as file:
            file.write(content)
        return path

    def _service(self, *, auto_start_worker=False, max_jobs=200, heartbeat_timeout_ms=60000):
        lifecycle_service = AssetLifecycleService(
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            storage_bucket_service=self.storage,
            local_root_dir=self.temp_dir.name,
        )
        cleanup_queue_service = AssetCleanupQueueService(
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            lifecycle_service=lifecycle_service,
            local_root_dir=self.temp_dir.name,
            now_ms_getter=self._now_ms,
        )
        return AssetCleanupExecutorService(
            jobs_file_path=self.jobs_file,
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            lifecycle_service=lifecycle_service,
            cleanup_queue_service=cleanup_queue_service,
            local_root_dir=self.temp_dir.name,
            now_ms_getter=self._now_ms,
            auto_start_worker=auto_start_worker,
            max_jobs=max_jobs,
            heartbeat_timeout_ms=heartbeat_timeout_ms,
        )

    def test_create_job_requires_confirm_and_returns_pending_without_deleting_synchronously(self):
        local_file = self._make_local_file("asset_local")
        self._seed_assets([self._asset("asset_local", localPath=local_file, storage={"type": "local"})])
        service = self._service(auto_start_worker=False)

        denied = service.create_job(["asset_local"], confirm=False)
        created = service.create_job(["asset_local"], confirm=True)
        job = service.get_job(created["cleanupJobId"])["job"]
        asset = self._read_assets()["assets"][0]

        self.assertFalse(denied["success"])
        self.assertEqual(denied["error"], "confirm_required")
        self.assertTrue(created["success"])
        self.assertEqual(created["status"], "pending")
        self.assertEqual(job["processedCount"], 0)
        self.assertEqual(job["progressPercent"], 0)
        self.assertEqual(job["currentAssetId"], "")
        self.assertGreater(job["lastHeartbeatAt"], 0)
        self.assertTrue(os.path.exists(local_file))
        self.assertEqual(asset["lifecycleStatus"], "deleted_candidate")

    def test_worker_deletes_candidates_updates_progress_and_writes_audit_fields(self):
        local_file = self._make_local_file("asset_local", b"local")
        self._seed_assets([
            self._asset("asset_local", localPath=local_file, storage={"type": "local"}, size=5),
            self._asset("asset_s3", type="video", objectKey="videos/asset_s3.mp4", storage={"type": "s3-compatible", "bucket": "safe"}, size=7),
        ])
        self.storage.existing_keys.add("videos/asset_s3.mp4")
        service = self._service(auto_start_worker=False)
        created = service.create_job(["asset_local", "asset_s3"], confirm=True)

        service.run_pending_jobs_once()
        job = service.get_job(created["cleanupJobId"])["job"]
        assets = {item["assetId"]: item for item in self._read_assets()["assets"]}
        results = {item["assetId"]: item for item in job["results"]}

        self.assertEqual(job["status"], "success")
        self.assertEqual(job["processedCount"], 2)
        self.assertEqual(job["successCount"], 2)
        self.assertEqual(job["failedCount"], 0)
        self.assertEqual(job["skippedCount"], 0)
        self.assertEqual(job["releasedBytes"], 12)
        self.assertEqual(job["progressPercent"], 100)
        self.assertEqual(job["currentAssetId"], "")
        self.assertFalse(os.path.exists(local_file))
        self.assertEqual(self.storage.deleted_keys, [{"objectKey": "videos/asset_s3.mp4", "bucket": "safe"}])
        self.assertEqual(results["asset_local"]["status"], "success")
        self.assertEqual(results["asset_s3"]["releasedBytes"], 7)
        self.assertEqual(assets["asset_local"]["lifecycleStatus"], "deleted")
        self.assertEqual(assets["asset_local"]["deleteMode"], "manual")
        self.assertEqual(assets["asset_local"]["cleanupJobId"], created["cleanupJobId"])
        self.assertEqual(assets["asset_local"]["cleanupQueue"]["reviewStatus"], "deleted")
        self.assertGreater(assets["asset_local"]["cleanupQueue"]["reviewedAt"], 0)

    def test_worker_preserves_unselected_cleanup_candidates_after_deleting_one_item(self):
        local_selected = self._make_local_file("asset_selected", b"selected")
        local_remaining = self._make_local_file("asset_remaining", b"remaining")
        self._seed_assets([
            self._asset("asset_selected", localPath=local_selected, storage={"type": "local"}),
            self._asset("asset_remaining", localPath=local_remaining, storage={"type": "local"}),
        ])
        service = self._service(auto_start_worker=False)
        created = service.create_job(["asset_selected"], confirm=True)

        service.run_pending_jobs_once()
        assets = {item["assetId"]: item for item in self._read_assets()["assets"]}
        job = service.get_job(created["cleanupJobId"])["job"]

        self.assertEqual(job["status"], "success")
        self.assertEqual(assets["asset_selected"]["lifecycleStatus"], "deleted")
        self.assertEqual(assets["asset_remaining"]["lifecycleStatus"], "deleted_candidate")
        self.assertTrue(os.path.exists(local_remaining))

    def test_worker_skips_unsafe_assets_and_preserves_secret_sanitization(self):
        self._seed_assets([
            self._asset("asset_active", lifecycleStatus="active"),
            self._asset("asset_pinned", pinned=True),
            self._asset("asset_used", usage={"usageCount": 2, "references": [{"nodeId": "node"}]}),
            self._asset(
                "asset_secret_fail",
                objectKey="media/fail.png",
                storage={"type": "s3-compatible", "bucket": "safe", "secretAccessKey": "must-not-return"},
                Authorization="AWS4-HMAC-SHA256 Signature=abc",
            ),
        ])
        self.storage.existing_keys.add("media/fail.png")
        self.storage.failures["media/fail.png"] = "delete failed Authorization: Bearer abc secretAccessKey=raw Signature=abc"
        service = self._service(auto_start_worker=False)
        created = service.create_job(["asset_active", "asset_pinned", "asset_used", "asset_secret_fail"], confirm=True)

        service.run_pending_jobs_once()
        job = service.get_job(created["cleanupJobId"])["job"]
        by_id = {item["assetId"]: item for item in job["results"]}
        serialized = json.dumps(job, ensure_ascii=False)

        self.assertEqual(job["status"], "partial_failed")
        self.assertEqual(by_id["asset_active"]["status"], "skipped")
        self.assertEqual(by_id["asset_active"]["reason"], "asset_in_use")
        self.assertEqual(by_id["asset_pinned"]["reason"], "asset_pinned")
        self.assertEqual(by_id["asset_used"]["reason"], "asset_in_use")
        self.assertEqual(by_id["asset_secret_fail"]["status"], "failed")
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization: Bearer abc", serialized)
        self.assertNotIn("Signature=abc", serialized)

    def test_cancel_pending_and_running_jobs_only_skips_unprocessed_items(self):
        local_a = self._make_local_file("asset_a", b"a")
        local_b = self._make_local_file("asset_b", b"b")
        self._seed_assets([
            self._asset("asset_a", localPath=local_a, storage={"type": "local"}),
            self._asset("asset_b", localPath=local_b, storage={"type": "local"}),
        ])
        service = self._service(auto_start_worker=False)
        pending = service.create_job(["asset_a"], confirm=True)

        canceled = service.cancel_job(pending["cleanupJobId"])["job"]
        running = service.create_job(["asset_a", "asset_b"], confirm=True)
        service.run_pending_jobs_once(max_items=1)
        service.cancel_job(running["cleanupJobId"])
        service.run_pending_jobs_once()
        running_job = service.get_job(running["cleanupJobId"])["job"]
        by_id = {item["assetId"]: item for item in running_job["results"]}

        self.assertEqual(canceled["status"], "canceled")
        self.assertEqual(canceled["results"][0]["reason"], "canceled")
        self.assertEqual(running_job["status"], "canceled")
        self.assertEqual(by_id["asset_a"]["status"], "success")
        self.assertEqual(by_id["asset_b"]["status"], "skipped")
        self.assertEqual(by_id["asset_b"]["reason"], "canceled")
        self.assertFalse(os.path.exists(local_a))
        self.assertTrue(os.path.exists(local_b))

    def test_retry_only_failed_items_and_keeps_previous_errors(self):
        self._seed_assets([
            self._asset("asset_ok", objectKey="media/ok.png", storage={"type": "s3-compatible", "bucket": "safe"}, size=10),
            self._asset("asset_fail", objectKey="media/fail.png", storage={"type": "s3-compatible", "bucket": "safe"}, size=20),
        ])
        self.storage.existing_keys.add("media/ok.png")
        self.storage.existing_keys.add("media/fail.png")
        self.storage.failures["media/fail.png"] = "temporary_error secretAccessKey=raw"
        service = self._service(auto_start_worker=False)
        created = service.create_job(["asset_ok", "asset_fail"], confirm=True)
        service.run_pending_jobs_once()

        self.storage.failures = {}
        retried = service.retry_job(created["cleanupJobId"])["job"]
        by_id = {item["assetId"]: item for item in retried["results"]}

        self.assertEqual(retried["status"], "success")
        self.assertEqual(by_id["asset_ok"]["status"], "success")
        self.assertEqual(by_id["asset_fail"]["status"], "success")
        self.assertEqual(len(by_id["asset_fail"].get("attempts", [])), 2)
        self.assertIn("previousErrors", by_id["asset_fail"])
        self.assertNotIn("secretAccessKey=raw", json.dumps(retried, ensure_ascii=False))
        self.assertEqual(self.storage.deleted_keys, [
            {"objectKey": "media/ok.png", "bucket": "safe"},
            {"objectKey": "media/fail.png", "bucket": "safe"},
        ])

    def test_stale_jobs_are_marked_interrupted_and_history_is_trimmed(self):
        self._seed_assets([self._asset("asset_a")])
        service = self._service(auto_start_worker=False, max_jobs=3, heartbeat_timeout_ms=1000)
        stale_at = self._now_ms() - 100000
        self._write_json(
            self.jobs_file,
            {
                "version": 1,
                "jobs": [
                    {
                        "cleanupJobId": "job_old_running",
                        "status": "running",
                        "assetIds": ["asset_a"],
                        "totalCount": 1,
                        "processedCount": 0,
                        "successCount": 0,
                        "failedCount": 0,
                        "skippedCount": 0,
                        "releasedBytes": 0,
                        "createdAt": stale_at,
                        "startedAt": stale_at,
                        "finishedAt": 0,
                        "lastHeartbeatAt": stale_at,
                        "cancelRequested": False,
                        "results": [],
                    },
                    {"cleanupJobId": "job_1", "status": "success", "assetIds": [], "totalCount": 0, "createdAt": 1, "updatedAt": 1, "results": []},
                    {"cleanupJobId": "job_2", "status": "success", "assetIds": [], "totalCount": 0, "createdAt": 2, "updatedAt": 2, "results": []},
                    {"cleanupJobId": "job_3", "status": "success", "assetIds": [], "totalCount": 0, "createdAt": 3, "updatedAt": 3, "results": []},
                ],
            },
        )

        service.mark_stale_jobs()
        payload = service.list_jobs(limit=10)
        by_id = {item["cleanupJobId"]: item for item in payload["jobs"]}

        self.assertLessEqual(len(payload["jobs"]), 3)
        self.assertIn("job_old_running", by_id)
        self.assertEqual(by_id["job_old_running"]["status"], "failed")
        self.assertEqual(by_id["job_old_running"]["reason"], "server_restarted_or_interrupted")
        self.assertEqual(by_id["job_old_running"]["results"][0]["reason"], "server_restarted_or_interrupted")
        self.assertNotIn("job_1", by_id)

    def test_object_not_found_for_deleted_candidate_is_treated_as_success(self):
        self._seed_assets([
            self._asset("asset_missing_object", objectKey="media/missing.png", storage={"type": "s3-compatible", "bucket": "safe"}, size=99)
        ])
        self.storage.failures["media/missing.png"] = "object_not_found accessKey=raw Signature=abc"
        service = self._service(auto_start_worker=False)
        created = service.create_job(["asset_missing_object"], confirm=True)

        service.run_pending_jobs_once()
        job = service.get_job(created["cleanupJobId"])["job"]
        result = job["results"][0]
        asset = self._read_assets()["assets"][0]

        self.assertEqual(job["status"], "success")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["reason"], "object_already_missing")
        self.assertEqual(result["releasedBytes"], 0)
        self.assertEqual(asset["lifecycleStatus"], "deleted")
        self.assertEqual(asset["cleanupJobId"], created["cleanupJobId"])
        self.assertNotIn("accessKey=raw", json.dumps(job, ensure_ascii=False))
        self.assertNotIn("Signature=abc", json.dumps(job, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()