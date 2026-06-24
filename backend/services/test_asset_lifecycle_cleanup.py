import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.services.asset_cleanup_executor_service import AssetCleanupExecutorService
from backend.services.asset_cleanup_queue_service import AssetCleanupQueueService
from backend.services.asset_lifecycle_service import AssetLifecycleService
from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION


class SpyLifecycleService:
    def __init__(self, *, local_root_dir):
        self.local_root_dir = local_root_dir
        self.storage_bucket_service = None
        self.delete_calls = []

    def delete_assets(self, asset_ids, dry_run=True):
        self.delete_calls.append({"assetIds": list(asset_ids), "dryRun": dry_run})
        return {
            "success": True,
            "dryRun": dry_run,
            "results": [
                {
                    "assetId": asset_id,
                    "deleted": False,
                    "reason": "unexpected_delete_call",
                }
                for asset_id in asset_ids
            ],
        }


class MissingObjectStorageBucketService:
    def __init__(self):
        self.exists_calls = []
        self.delete_calls = []

    def object_exists(self, object_key, bucket_name=""):
        self.exists_calls.append({"objectKey": object_key, "bucketName": bucket_name})
        return False

    def delete_object(self, object_key, bucket_name=""):
        self.delete_calls.append({"objectKey": object_key, "bucketName": bucket_name})


class AssetLifecycleCleanupSafetyTest(unittest.TestCase):
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
            "url": f"/data/assets/{asset_id}.png",
            "localPath": f"data/assets/{asset_id}.png",
            "objectKey": "",
            "storage": {"type": "local", "bucket": ""},
            "size": 1234,
            "status": "ready",
            "lifecycleStatus": "deleted_candidate",
            "pinned": False,
            "usage": {"usageCount": 0, "references": []},
            "createdAt": 1000,
            "updatedAt": 1000,
        }
        asset.update(overrides)
        return asset

    def _write_registry(self, tmpdir, assets):
        assets_file = os.path.join(tmpdir, "assets.json")
        self._write_json(assets_file, {"version": ASSET_REGISTRY_VERSION, "assets": assets})
        return assets_file

    def _touch_local_asset(self, tmpdir, relative_path, content=b"asset"):
        path = os.path.join(tmpdir, relative_path.replace("/", os.sep))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as file:
            file.write(content)
        return path

    def _canvas_dir(self, tmpdir):
        path = os.path.join(tmpdir, "projects")
        os.makedirs(path, exist_ok=True)
        return path

    def _queue_service(self, *, assets_file, canvas_dir, lifecycle_service, tmpdir):
        return AssetCleanupQueueService(
            assets_file_path=assets_file,
            canvas_dir_getter=lambda: canvas_dir,
            lifecycle_service=lifecycle_service,
            local_root_dir=tmpdir,
            now_ms_getter=lambda: 2000,
        )

    def test_pinned_candidate_is_blocked_before_real_delete(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = "data/assets/pinned.png"
            file_path = self._touch_local_asset(tmpdir, local_path)
            assets_file = self._write_registry(
                tmpdir,
                [self._asset("asset-pinned", localPath=local_path, pinned=True)],
            )
            lifecycle = SpyLifecycleService(local_root_dir=tmpdir)
            queue = self._queue_service(
                assets_file=assets_file,
                canvas_dir=self._canvas_dir(tmpdir),
                lifecycle_service=lifecycle,
                tmpdir=tmpdir,
            )

            result = queue.delete(["asset-pinned"], confirm=True)

            self.assertTrue(result["success"])
            self.assertEqual(result["results"][0]["deleted"], False)
            self.assertEqual(result["results"][0]["reason"], "asset_pinned")
            self.assertEqual(lifecycle.delete_calls, [])
            self.assertTrue(os.path.exists(file_path))

    def test_usage_count_candidate_is_blocked_before_real_delete(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = "data/assets/used.png"
            file_path = self._touch_local_asset(tmpdir, local_path)
            assets_file = self._write_registry(
                tmpdir,
                [self._asset("asset-used", localPath=local_path, usage={"usageCount": 2, "references": []})],
            )
            lifecycle = SpyLifecycleService(local_root_dir=tmpdir)
            queue = self._queue_service(
                assets_file=assets_file,
                canvas_dir=self._canvas_dir(tmpdir),
                lifecycle_service=lifecycle,
                tmpdir=tmpdir,
            )

            result = queue.delete(["asset-used"], confirm=True)

            self.assertTrue(result["success"])
            self.assertEqual(result["results"][0]["deleted"], False)
            self.assertEqual(result["results"][0]["reason"], "asset_in_use")
            self.assertEqual(lifecycle.delete_calls, [])
            self.assertTrue(os.path.exists(file_path))

    def test_deleted_candidate_rechecks_project_node_references_before_delete(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = "data/assets/referenced.png"
            file_path = self._touch_local_asset(tmpdir, local_path)
            assets_file = self._write_registry(
                tmpdir,
                [self._asset("asset-referenced", localPath=local_path)],
            )
            canvas_dir = self._canvas_dir(tmpdir)
            self._write_json(
                os.path.join(canvas_dir, "project.json"),
                {
                    "id": "project-1",
                    "canvases": [
                        {
                            "id": "canvas-1",
                            "nodes": [
                                {"id": "node-1", "type": "image", "assetId": "asset-referenced"},
                            ],
                        }
                    ],
                },
            )
            lifecycle = SpyLifecycleService(local_root_dir=tmpdir)
            queue = self._queue_service(
                assets_file=assets_file,
                canvas_dir=canvas_dir,
                lifecycle_service=lifecycle,
                tmpdir=tmpdir,
            )

            result = queue.delete(["asset-referenced"], confirm=True)

            self.assertTrue(result["success"])
            self.assertEqual(result["results"][0]["deleted"], False)
            self.assertEqual(result["results"][0]["reason"], "asset_in_use")
            self.assertEqual(lifecycle.delete_calls, [])
            self.assertTrue(os.path.exists(file_path))

    def test_lifecycle_dry_run_reports_preflight_without_deleting_local_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = "data/assets/dry-run.png"
            file_path = self._touch_local_asset(tmpdir, local_path)
            assets_file = self._write_registry(
                tmpdir,
                [self._asset("asset-dry-run", localPath=local_path, lifecycleStatus="orphan")],
            )
            lifecycle = AssetLifecycleService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: self._canvas_dir(tmpdir),
                local_root_dir=tmpdir,
            )

            result = lifecycle.delete_assets(["asset-dry-run"], dry_run=True)
            registry = self._read_json(assets_file)

            self.assertTrue(result["success"])
            self.assertTrue(result["dryRun"])
            self.assertEqual(result["results"][0]["canDelete"], True)
            self.assertEqual(result["results"][0]["reason"], "orphan_asset")
            self.assertTrue(os.path.exists(file_path))
            self.assertEqual(registry["assets"][0]["lifecycleStatus"], "orphan")

    def test_executor_does_not_release_bytes_when_cloud_object_is_already_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            storage = MissingObjectStorageBucketService()
            assets_file = self._write_registry(
                tmpdir,
                [
                    self._asset(
                        "asset-cloud-missing",
                        localPath="",
                        objectKey="generated/missing.png",
                        storage={"type": "s3-compatible", "bucket": "bucket-a"},
                        size=4096,
                    )
                ],
            )
            canvas_dir = self._canvas_dir(tmpdir)
            lifecycle = AssetLifecycleService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: canvas_dir,
                storage_bucket_service=storage,
                local_root_dir=tmpdir,
            )
            queue = AssetCleanupQueueService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: canvas_dir,
                lifecycle_service=lifecycle,
                local_root_dir=tmpdir,
                now_ms_getter=lambda: 3000,
            )
            executor = AssetCleanupExecutorService(
                jobs_file_path=os.path.join(tmpdir, "cleanup-jobs.json"),
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: canvas_dir,
                lifecycle_service=lifecycle,
                cleanup_queue_service=queue,
                local_root_dir=tmpdir,
                now_ms_getter=lambda: 3000,
                auto_start_worker=False,
            )

            job = executor.create_job(["asset-cloud-missing"], confirm=True)
            processed = executor.run_pending_jobs_once()
            finished = executor.get_job(job["cleanupJobId"])["job"]

            self.assertEqual(processed, 1)
            self.assertEqual(finished["status"], "success")
            self.assertEqual(finished["releasedBytes"], 0)
            self.assertEqual(finished["results"][0]["status"], "success")
            self.assertEqual(finished["results"][0]["reason"], "object_already_missing")
            self.assertEqual(finished["results"][0]["releasedBytes"], 0)
            self.assertEqual(storage.delete_calls, [])

    def test_missing_local_file_delete_returns_safe_result_without_unhandled_exception(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            missing_local_path = "data/assets/missing-local.png"
            assets_file = self._write_registry(
                tmpdir,
                [self._asset("asset-local-missing", localPath=missing_local_path, lifecycleStatus="orphan")],
            )
            lifecycle = AssetLifecycleService(
                assets_file_path=assets_file,
                canvas_dir_getter=lambda: self._canvas_dir(tmpdir),
                local_root_dir=tmpdir,
            )

            result = lifecycle.delete_assets(["asset-local-missing"], dry_run=False)
            registry = self._read_json(assets_file)

            self.assertTrue(result["success"])
            self.assertEqual(result["results"][0]["deleted"], True)
            self.assertEqual(result["results"][0]["reason"], "orphan_asset")
            self.assertEqual(registry["assets"][0]["lifecycleStatus"], "deleted")


if __name__ == "__main__":
    unittest.main()