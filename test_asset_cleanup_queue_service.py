import copy
import json
import os
import tempfile
import unittest

from backend.services.asset_cleanup_queue_service import AssetCleanupQueueService
from backend.services.asset_lifecycle_service import AssetLifecycleService


class FakeStorageBucketService:
    def __init__(self):
        self.deleted_keys = []
        self.failures = {}
        self.existing_keys = set()

    def object_exists(self, object_key, bucket_name=""):
        return object_key in self.existing_keys

    def delete_object(self, object_key, bucket_name=""):
        if object_key in self.failures:
            raise RuntimeError(self.failures[object_key])
        self.deleted_keys.append({"objectKey": object_key, "bucket": bucket_name})
        return {"success": True}


class AssetCleanupQueueServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.user_dir = os.path.join(root, "user")
        self.canvas_dir = os.path.join(self.user_dir, "Canvas Project")
        os.makedirs(self.canvas_dir, exist_ok=True)
        self.assets_file = os.path.join(self.user_dir, "assets.json")
        self.storage = FakeStorageBucketService()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _read_assets_registry(self):
        with open(self.assets_file, "r", encoding="utf-8-sig") as file:
            return json.load(file)

    def _asset(self, asset_id, **overrides):
        asset = {
            "assetId": asset_id,
            "type": "image",
            "url": f"/output/{asset_id}.png",
            "objectKey": f"media/{asset_id}.png",
            "localPath": os.path.join(self.temp_dir.name, "output", f"{asset_id}.png"),
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

    def _service(self):
        lifecycle_service = AssetLifecycleService(
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            storage_bucket_service=self.storage,
            local_root_dir=self.temp_dir.name,
        )
        return AssetCleanupQueueService(
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            lifecycle_service=lifecycle_service,
            local_root_dir=self.temp_dir.name,
        )

    def test_queue_lists_deleted_candidates_only_with_filters_sorting_summary_and_sanitized_fields(self):
        self._seed_assets([
            self._asset("asset_image", size=300, storage={"type": "s3-compatible", "bucket": "safe"}),
            self._asset("asset_video", type="video", size=500, createdAt=3000, storage={"type": "s3-compatible", "bucket": "safe"}),
            self._asset("asset_active", lifecycleStatus="active", usage={"usageCount": 0, "references": []}),
            self._asset("asset_orphan", lifecycleStatus="orphan"),
            self._asset(
                "asset_secret",
                storage={"type": "s3-compatible", "bucket": "secret-bucket", "secretAccessKey": "must-not-return"},
                Authorization="AWS4-HMAC-SHA256 Signature=abc",
                url="https://cdn.example/secret.png?Signature=abc",
            ),
        ])

        payload = self._service().list_queue({"storageType": "s3-compatible", "sort": "size_desc", "page": 1, "pageSize": 2})

        self.assertTrue(payload["success"])
        self.assertEqual([item["assetId"] for item in payload["queue"]], ["asset_video", "asset_image"])
        self.assertEqual(payload["summary"]["totalCount"], 3)
        self.assertEqual(payload["summary"]["totalBytes"], 900)
        self.assertEqual(payload["summary"]["byType"]["image"]["count"], 2)
        self.assertEqual(payload["summary"]["byStorage"]["s3-compatible"]["bytes"], 900)
        self.assertEqual(payload["summary"]["byBucket"]["safe"]["count"], 2)
        first = payload["queue"][0]
        self.assertEqual(set(first.keys()), {
            "assetId",
            "type",
            "url",
            "objectKey",
            "storage",
            "size",
            "createdAt",
            "candidateAt",
            "lifecycleReason",
            "usage",
            "pinned",
            "cleanupQueue",
        })
        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature=abc", serialized)

    def test_dry_run_does_not_modify_registry_or_delete_files_and_blocks_unsafe_assets(self):
        local_file = os.path.join(self.temp_dir.name, "output", "asset_ready.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"ready")
        assets = [
            self._asset("asset_ready", localPath=local_file, size=5),
            self._asset("asset_pinned", pinned=True),
            self._asset("asset_used", usage={"usageCount": 2, "references": [{"nodeId": "node"}]}),
            self._asset("asset_active", lifecycleStatus="active"),
            self._asset("asset_deleted", lifecycleStatus="deleted"),
        ]
        self._seed_assets(copy.deepcopy(assets))
        before = self._read_assets_registry()

        payload = self._service().dry_run(["asset_ready", "asset_pinned", "asset_used", "asset_active", "asset_deleted", "asset_missing"])
        after = self._read_assets_registry()
        by_id = {item["assetId"]: item for item in payload["results"]}

        self.assertEqual(after, before)
        self.assertTrue(os.path.exists(local_file))
        self.assertEqual(self.storage.deleted_keys, [])
        self.assertTrue(by_id["asset_ready"]["canDelete"])
        self.assertEqual(by_id["asset_ready"]["releasableBytes"], 5)
        self.assertFalse(by_id["asset_pinned"]["canDelete"])
        self.assertEqual(by_id["asset_pinned"]["reason"], "asset_pinned")
        self.assertFalse(by_id["asset_used"]["canDelete"])
        self.assertEqual(by_id["asset_used"]["reason"], "asset_in_use")
        self.assertFalse(by_id["asset_active"]["canDelete"])
        self.assertFalse(by_id["asset_deleted"]["canDelete"])
        self.assertEqual(by_id["asset_deleted"]["reason"], "already_deleted")
        self.assertFalse(by_id["asset_missing"]["canDelete"])
        self.assertEqual(by_id["asset_missing"]["reason"], "asset_not_found")

    def test_delete_requires_confirm_uses_phase5_safe_delete_and_records_partial_results(self):
        local_file = os.path.join(self.temp_dir.name, "output", "asset_local.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"local")
        self._seed_assets([
            self._asset("asset_local", localPath=local_file, storage={"type": "local"}, size=5),
            self._asset("asset_s3", type="video", objectKey="videos/asset_s3.mp4", storage={"type": "s3-compatible", "bucket": "safe"}, size=7),
            self._asset("asset_pinned", pinned=True, size=11),
            self._asset("asset_used", usage={"usageCount": 1, "references": [{"nodeId": "node"}]}, size=13),
        ])
        self.storage.existing_keys.add("videos/asset_s3.mp4")
        service = self._service()

        rejected = service.delete(["asset_local"], confirm=False)
        payload = service.delete(["asset_local", "asset_s3", "asset_pinned", "asset_used"], confirm=True)
        registry = self._read_assets_registry()
        by_asset = {item["assetId"]: item for item in registry["assets"]}
        by_result = {item["assetId"]: item for item in payload["results"]}

        self.assertFalse(rejected["success"])
        self.assertEqual(rejected["error"], "confirm_required")
        self.assertTrue(by_result["asset_local"]["deleted"])
        self.assertTrue(by_result["asset_s3"]["deleted"])
        self.assertFalse(by_result["asset_pinned"]["deleted"])
        self.assertEqual(by_result["asset_pinned"]["reason"], "asset_pinned")
        self.assertFalse(by_result["asset_used"]["deleted"])
        self.assertEqual(by_result["asset_used"]["reason"], "asset_in_use")
        self.assertFalse(os.path.exists(local_file))
        self.assertEqual(self.storage.deleted_keys, [{"objectKey": "videos/asset_s3.mp4", "bucket": "safe"}])
        self.assertEqual(by_asset["asset_local"]["lifecycleStatus"], "deleted")
        self.assertEqual(by_asset["asset_s3"]["lifecycleStatus"], "deleted")
        self.assertEqual(by_asset["asset_local"]["cleanupQueue"]["reviewStatus"], "deleted")
        self.assertGreater(by_asset["asset_local"]["cleanupQueue"]["reviewedAt"], 0)
        self.assertEqual(by_asset["asset_pinned"]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(by_asset["asset_used"]["lifecycleStatus"], "deleted_candidate")

    def test_delete_second_usage_check_refuses_asset_that_becomes_active(self):
        local_file = os.path.join(self.temp_dir.name, "output", "asset_race.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"race")
        self._seed_assets([self._asset("asset_race", localPath=local_file, storage={"type": "local"})])
        self._write_json(
            os.path.join(self.canvas_dir, "project.json"),
            {"nodes": [{"id": "node", "type": "source-image", "assetId": "asset_race"}]},
        )

        payload = self._service().delete(["asset_race"], confirm=True)
        registry = self._read_assets_registry()

        self.assertFalse(payload["results"][0]["deleted"])
        self.assertEqual(payload["results"][0]["reason"], "asset_in_use")
        self.assertTrue(os.path.exists(local_file))
        self.assertEqual(registry["assets"][0]["lifecycleStatus"], "deleted_candidate")

    def test_reject_moves_deleted_candidate_back_to_orphan_without_deleting_files(self):
        local_file = os.path.join(self.temp_dir.name, "output", "asset_reject.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"reject")
        self._seed_assets([
            self._asset("asset_reject", localPath=local_file, storage={"type": "local"}),
            self._asset("asset_active", lifecycleStatus="active"),
        ])

        payload = self._service().reject(["asset_reject", "asset_active", "asset_missing"], reason="keep it")
        registry = self._read_assets_registry()
        by_asset = {item["assetId"]: item for item in registry["assets"]}
        by_result = {item["assetId"]: item for item in payload["results"]}

        self.assertTrue(by_result["asset_reject"]["rejected"])
        self.assertEqual(by_asset["asset_reject"]["lifecycleStatus"], "orphan")
        self.assertEqual(by_asset["asset_reject"]["cleanupQueue"]["reviewStatus"], "rejected")
        self.assertEqual(by_asset["asset_reject"]["cleanupQueue"]["reviewNote"], "keep it")
        self.assertFalse(by_result["asset_active"]["rejected"])
        self.assertEqual(by_result["asset_active"]["reason"], "invalid_status")
        self.assertFalse(by_result["asset_missing"]["rejected"])
        self.assertEqual(by_result["asset_missing"]["reason"], "asset_not_found")
        self.assertTrue(os.path.exists(local_file))
        self.assertEqual(self.storage.deleted_keys, [])


if __name__ == "__main__":
    unittest.main()