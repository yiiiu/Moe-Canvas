import json
import os
import tempfile
import unittest

from backend.services.storage_usage_service import StorageUsageService


class StorageUsageServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.user_dir = os.path.join(root, "user")
        os.makedirs(self.user_dir, exist_ok=True)
        self.assets_file = os.path.join(self.user_dir, "assets.json")
        self.settings_file = os.path.join(self.user_dir, "settings.json")

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _service(self):
        return StorageUsageService(
            assets_file_path=self.assets_file,
            settings_file_getter=lambda: self.settings_file,
        )

    def test_lifecycle_statuses_determine_current_and_deleted_bytes(self):
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    {"assetId": "asset_active", "status": "ready", "type": "image", "size": 100, "lifecycleStatus": "active"},
                    {"assetId": "asset_orphan", "status": "ready", "type": "video", "size": 200, "lifecycleStatus": "orphan"},
                    {"assetId": "asset_candidate", "status": "ready", "type": "audio", "size": 300, "lifecycleStatus": "deleted_candidate"},
                    {"assetId": "asset_failed", "status": "ready", "type": "file", "size": 400, "lifecycleStatus": "delete_failed"},
                    {"assetId": "asset_deleted", "status": "ready", "type": "image", "size": 500, "lifecycleStatus": "deleted"},
                ],
            },
        )

        payload = self._service().get_storage_usage()
        usage = payload["usage"]

        self.assertTrue(payload["success"])
        self.assertEqual(usage["totalBytes"], 1000)
        self.assertEqual(usage["activeBytes"], 100)
        self.assertEqual(usage["orphanBytes"], 200)
        self.assertEqual(usage["deletedBytes"], 500)
        self.assertEqual(usage["assetCount"], 4)
        self.assertEqual(usage["orphanCount"], 1)
        self.assertEqual(usage["deletedCount"], 1)

    def test_missing_lifecycle_ready_asset_defaults_to_active_and_missing_size_is_counted(self):
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    {"assetId": "asset_ready", "status": "ready", "type": "image"},
                    {"assetId": "asset_failed", "status": "failed", "type": "image", "size": 999},
                ],
            },
        )

        usage = self._service().get_storage_usage()["usage"]

        self.assertEqual(usage["totalBytes"], 0)
        self.assertEqual(usage["activeBytes"], 0)
        self.assertEqual(usage["assetCount"], 1)
        self.assertEqual(usage["missingSizeCount"], 1)

    def test_aggregates_by_type_storage_bucket_and_project(self):
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    {
                        "assetId": "asset_img",
                        "status": "ready",
                        "type": "image",
                        "size": 100,
                        "lifecycleStatus": "active",
                        "storage": {"type": "local", "bucket": ""},
                        "usage": {"usageCount": 1, "references": [{"projectId": "project-a", "nodeId": "node-a"}]},
                    },
                    {
                        "assetId": "asset_video",
                        "status": "ready",
                        "type": "video",
                        "size": 250,
                        "lifecycleStatus": "orphan",
                        "storage": {"type": "s3-compatible", "bucket": "media-bucket", "endpoint": "https://AKIA:secret@example.invalid"},
                        "usage": {"usageCount": 0, "references": []},
                    },
                    {
                        "assetId": "asset_audio",
                        "status": "ready",
                        "type": "audio",
                        "size": 50,
                        "lifecycleStatus": "active",
                        "storage": {"type": "s3-compatible", "bucket": "media-bucket"},
                        "usage": {"usageCount": 2, "references": [{"projectId": "project-b"}, {"projectId": "project-a"}]},
                    },
                    {
                        "assetId": "asset_file",
                        "status": "ready",
                        "type": "archive",
                        "size": 25,
                        "lifecycleStatus": "active",
                        "storage": {"type": "local"},
                    },
                ],
            },
        )

        usage = self._service().get_storage_usage()["usage"]

        self.assertEqual(usage["byType"]["image"]["bytes"], 100)
        self.assertEqual(usage["byType"]["video"]["bytes"], 250)
        self.assertEqual(usage["byType"]["audio"]["bytes"], 50)
        self.assertEqual(usage["byType"]["file"]["bytes"], 25)
        self.assertEqual(usage["byStorage"]["local"]["bytes"], 125)
        self.assertEqual(usage["byStorage"]["s3-compatible"]["bytes"], 300)
        self.assertEqual(usage["byBucket"], [{"bucket": "media-bucket", "storageType": "s3-compatible", "bytes": 300, "assetCount": 2}])
        self.assertEqual(
            usage["byProject"],
            [
                {"projectId": "project-a", "bytes": 150, "assetCount": 2},
                {"projectId": "project-b", "bytes": 50, "assetCount": 1},
            ],
        )

    def test_quota_warning_and_exceeded_state(self):
        self._write_json(
            self.assets_file,
            {"version": 1, "assets": [{"assetId": "asset", "status": "ready", "size": 90, "lifecycleStatus": "active"}]},
        )
        self._write_json(
            self.settings_file,
            {"storageQuota": {"enabled": True, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": True}},
        )

        quota = self._service().get_storage_usage()["quota"]

        self.assertEqual(quota["enabled"], True)
        self.assertEqual(quota["limitBytes"], 100)
        self.assertEqual(quota["usedPercent"], 90)
        self.assertEqual(quota["warningPercent"], 80)
        self.assertEqual(quota["isWarning"], True)
        self.assertEqual(quota["isExceeded"], False)
        self.assertEqual(quota["blockWhenExceeded"], True)

        self._write_json(
            self.assets_file,
            {"version": 1, "assets": [{"assetId": "asset", "status": "ready", "size": 110, "lifecycleStatus": "active"}]},
        )
        quota = self._service().get_storage_usage()["quota"]
        self.assertEqual(quota["usedPercent"], 110)
        self.assertEqual(quota["isWarning"], True)
        self.assertEqual(quota["isExceeded"], True)

    def test_response_does_not_leak_secrets(self):
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    {
                        "assetId": "asset_secret",
                        "status": "ready",
                        "type": "image",
                        "size": 10,
                        "lifecycleStatus": "active",
                        "accessKey": "must-not-return",
                        "secretAccessKey": "must-not-return",
                        "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
                        "storage": {
                            "type": "s3-compatible",
                            "bucket": "safe-bucket",
                            "endpoint": "https://user:password@example.invalid",
                            "signature": "must-not-return",
                        },
                    }
                ],
            },
        )

        serialized = json.dumps(self._service().get_storage_usage(), ensure_ascii=False)

        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)
        self.assertNotIn("signature", serialized)
        self.assertNotIn("password", serialized)


if __name__ == "__main__":
    unittest.main()