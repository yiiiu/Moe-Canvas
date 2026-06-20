import json
import os
import tempfile
import unittest

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


class AssetLifecycleServiceTest(unittest.TestCase):
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

    def _read_assets(self):
        with open(self.assets_file, "r", encoding="utf-8-sig") as file:
            return json.load(file)

    def _service(self):
        return AssetLifecycleService(
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            storage_bucket_service=self.storage,
            local_root_dir=self.temp_dir.name,
        )

    def _seed_assets(self, assets):
        self._write_json(self.assets_file, {"version": 1, "assets": assets})

    def test_cleanup_candidates_include_orphan_assets_only(self):
        self._seed_assets([
            {
                "assetId": "asset_orphan",
                "type": "image",
                "url": "https://cdn.example/o.png",
                "objectKey": "media/o.png",
                "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
                "size": 12,
                "createdAt": 101,
                "lastUsedAt": 0,
            },
            {
                "assetId": "asset_active",
                "type": "image",
                "url": "https://cdn.example/a.png",
                "objectKey": "media/a.png",
                "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                "usage": {"usageCount": 1, "references": [{"nodeId": "node_a"}]},
                "lifecycleStatus": "active",
            },
            {
                "assetId": "asset_deleted",
                "type": "image",
                "url": "https://cdn.example/d.png",
                "objectKey": "media/d.png",
                "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "deleted",
            },
        ])

        candidates = self._service().list_cleanup_candidates()

        self.assertEqual([item["assetId"] for item in candidates], ["asset_orphan"])
        self.assertEqual(candidates[0]["objectKey"], "media/o.png")
        self.assertEqual(candidates[0]["storage"], {"type": "s3-compatible", "bucket": "safe-bucket"})
        self.assertEqual(candidates[0]["size"], 12)
        self.assertEqual(candidates[0]["createdAt"], 101)
        self.assertEqual(candidates[0]["lifecycleStatus"], "orphan")

    def test_dry_run_reports_can_delete_without_deleting_files(self):
        local_file = os.path.join(self.temp_dir.name, "output", "dry.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"dry")
        self._seed_assets([
            {
                "assetId": "asset_local",
                "type": "image",
                "url": "/output/dry.png",
                "localPath": local_file,
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            },
            {
                "assetId": "asset_active",
                "type": "image",
                "url": "/output/active.png",
                "localPath": os.path.join(self.temp_dir.name, "output", "active.png"),
                "storage": {"type": "local"},
                "usage": {"usageCount": 1, "references": [{"nodeId": "node_a"}]},
                "lifecycleStatus": "active",
            },
            {
                "assetId": "asset_deleted",
                "type": "image",
                "url": "/output/deleted.png",
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "deleted",
            },
        ])
        self._write_json(
            os.path.join(self.canvas_dir, "active-project.json"),
            {"nodes": [{"id": "node_a", "type": "source-image", "assetId": "asset_active"}]},
        )

        result = self._service().delete_assets(["asset_local", "asset_active", "asset_missing", "asset_deleted"], dry_run=True)
        by_id = {item["assetId"]: item for item in result["results"]}

        self.assertTrue(by_id["asset_local"]["canDelete"])
        self.assertEqual(by_id["asset_local"]["reason"], "orphan_asset")
        self.assertFalse(by_id["asset_active"]["canDelete"])
        self.assertEqual(by_id["asset_active"]["reason"], "asset_in_use")
        self.assertFalse(by_id["asset_missing"]["canDelete"])
        self.assertEqual(by_id["asset_missing"]["reason"], "asset_not_found")
        self.assertFalse(by_id["asset_deleted"]["canDelete"])
        self.assertEqual(by_id["asset_deleted"]["reason"], "already_deleted")
        self.assertTrue(os.path.exists(local_file))
        self.assertEqual(self.storage.deleted_keys, [])

    def test_dry_run_rechecks_usage_before_reporting_can_delete(self):
        self._seed_assets([
            {
                "assetId": "asset_now_active",
                "type": "image",
                "url": "/output/active-now.png",
                "localPath": os.path.join(self.temp_dir.name, "output", "active-now.png"),
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            }
        ])
        self._write_json(
            os.path.join(self.canvas_dir, "project.json"),
            {"nodes": [{"id": "node", "type": "source-image", "assetId": "asset_now_active"}]},
        )

        result = self._service().delete_assets(["asset_now_active"], dry_run=True)

        self.assertFalse(result["results"][0]["canDelete"])
        self.assertEqual(result["results"][0]["reason"], "asset_in_use")
        self.assertEqual(self._read_assets()["assets"][0]["lifecycleStatus"], "active")

    def test_delete_orphan_s3_asset_marks_record_deleted_and_keeps_audit_fields(self):
        self._seed_assets([
            {
                "assetId": "asset_s3",
                "type": "video",
                "url": "https://cdn.example/video.mp4",
                "objectKey": "videos/video.mp4",
                "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            }
        ])

        result = self._service().delete_assets(["asset_s3"], dry_run=False)
        asset = self._read_assets()["assets"][0]

        self.assertTrue(result["results"][0]["deleted"])
        self.assertEqual(result["results"][0]["reason"], "orphan_asset")
        self.assertEqual(self.storage.deleted_keys, [{"objectKey": "videos/video.mp4", "bucket": "safe-bucket"}])
        self.assertEqual(asset["lifecycleStatus"], "deleted")
        self.assertEqual(asset["deleteMode"], "manual")
        self.assertGreater(asset["deletedAt"], 0)
        self.assertEqual(asset["url"], "https://cdn.example/video.mp4")
        self.assertEqual(asset["objectKey"], "videos/video.mp4")
        self.assertEqual(asset["storage"]["bucket"], "safe-bucket")

    def test_delete_orphan_local_asset_removes_local_file_and_keeps_record(self):
        local_file = os.path.join(self.temp_dir.name, "output", "local.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"local")
        self._seed_assets([
            {
                "assetId": "asset_local",
                "type": "image",
                "url": "/output/local.png",
                "localPath": local_file,
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            }
        ])

        result = self._service().delete_assets(["asset_local"], dry_run=False)
        asset = self._read_assets()["assets"][0]

        self.assertTrue(result["results"][0]["deleted"])
        self.assertFalse(os.path.exists(local_file))
        self.assertEqual(asset["lifecycleStatus"], "deleted")
        self.assertEqual(asset["deleteMode"], "manual")
        self.assertEqual(asset["localPath"], local_file)

    def test_delete_orphan_local_asset_supports_virtual_output_path(self):
        local_file = os.path.join(self.temp_dir.name, "output", "virtual.png")
        os.makedirs(os.path.dirname(local_file), exist_ok=True)
        with open(local_file, "wb") as file:
            file.write(b"virtual")
        self._seed_assets([
            {
                "assetId": "asset_virtual_local",
                "type": "image",
                "url": "/output/virtual.png",
                "localPath": "/output/virtual.png",
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            }
        ])

        result = self._service().delete_assets(["asset_virtual_local"], dry_run=False)

        self.assertTrue(result["results"][0]["deleted"])
        self.assertFalse(os.path.exists(local_file))

    def test_active_asset_delete_is_rejected_after_usage_recheck(self):
        self._seed_assets([
            {
                "assetId": "asset_active",
                "type": "image",
                "url": "/output/active.png",
                "localPath": os.path.join(self.temp_dir.name, "output", "active.png"),
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            }
        ])
        self._write_json(
            os.path.join(self.canvas_dir, "project.json"),
            {"canvases": [{"id": "canvas", "nodes": [{"id": "node", "type": "source-image", "assetId": "asset_active"}]}]},
        )

        result = self._service().delete_assets(["asset_active"], dry_run=False)
        asset = self._read_assets()["assets"][0]

        self.assertFalse(result["results"][0]["deleted"])
        self.assertEqual(result["results"][0]["reason"], "asset_in_use")
        self.assertEqual(asset["lifecycleStatus"], "active")
        self.assertEqual(asset["usage"]["usageCount"], 1)

    def test_delete_failure_marks_delete_failed_and_sanitizes_error(self):
        self.storage.failures["media/fail.png"] = "Authorization: AWS4-HMAC-SHA256 Credential=AKIA_TEST/20260101/auto/s3/aws4_request, Signature=abcdef secretAccessKey=VERY_SECRET"
        self._seed_assets([
            {
                "assetId": "asset_fail",
                "type": "image",
                "url": "https://cdn.example/fail.png",
                "objectKey": "media/fail.png",
                "storage": {
                    "type": "s3-compatible",
                    "bucket": "safe-bucket",
                    "accessKeyId": "AKIA_TEST",
                    "secretAccessKey": "VERY_SECRET",
                },
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            }
        ])

        result = self._service().delete_assets(["asset_fail"], dry_run=False)
        asset = self._read_assets()["assets"][0]
        serialized = json.dumps({"result": result, "asset": asset}, ensure_ascii=False)

        self.assertFalse(result["results"][0]["deleted"])
        self.assertEqual(result["results"][0]["reason"], "delete_failed")
        self.assertEqual(asset["lifecycleStatus"], "delete_failed")
        self.assertIn("deleteError", asset)
        self.assertNotIn("AKIA_TEST", serialized)
        self.assertNotIn("VERY_SECRET", serialized)
        self.assertNotIn("Signature=abcdef", serialized)
        self.assertNotIn("Authorization: AWS4", serialized)

    def test_invalid_status_and_missing_delete_targets_are_rejected(self):
        self._seed_assets([
            {
                "assetId": "asset_missing_object_key",
                "type": "image",
                "url": "https://cdn.example/no-key.png",
                "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            },
            {
                "assetId": "asset_missing_local_path",
                "type": "image",
                "url": "/output/no-path.png",
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "orphan",
            },
            {
                "assetId": "asset_ready",
                "type": "image",
                "url": "/output/ready.png",
                "storage": {"type": "local"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "ready",
            },
        ])

        result = self._service().delete_assets(
            ["asset_missing_object_key", "asset_missing_local_path", "asset_ready"],
            dry_run=True,
        )
        by_id = {item["assetId"]: item for item in result["results"]}

        self.assertFalse(by_id["asset_missing_object_key"]["canDelete"])
        self.assertEqual(by_id["asset_missing_object_key"]["reason"], "invalid_status")
        self.assertFalse(by_id["asset_missing_local_path"]["canDelete"])
        self.assertEqual(by_id["asset_missing_local_path"]["reason"], "invalid_status")
        self.assertFalse(by_id["asset_ready"]["canDelete"])
        self.assertEqual(by_id["asset_ready"]["reason"], "invalid_status")

    def test_deleted_asset_not_in_cleanup_candidates(self):
        self._seed_assets([
            {
                "assetId": "asset_deleted",
                "type": "image",
                "url": "https://cdn.example/deleted.png",
                "objectKey": "media/deleted.png",
                "storage": {"type": "s3-compatible", "bucket": "safe-bucket"},
                "usage": {"usageCount": 0, "references": []},
                "lifecycleStatus": "deleted",
            }
        ])

        self.assertEqual(self._service().list_cleanup_candidates(), [])


if __name__ == "__main__":
    unittest.main()