import json
import os
import tempfile
import unittest

from backend.services.storage_quota_service import StorageQuotaService


class StorageQuotaServiceTest(unittest.TestCase):
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
        return StorageQuotaService(
            assets_file_path=self.assets_file,
            settings_file_getter=lambda: self.settings_file,
        )

    def _write_usage(self, total_bytes):
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    {
                        "assetId": "asset_current",
                        "status": "ready",
                        "type": "image",
                        "size": int(total_bytes),
                        "lifecycleStatus": "active",
                    }
                ],
            },
        )

    def test_quota_disabled_is_always_allowed(self):
        self._write_usage(100)
        self._write_json(
            self.settings_file,
            {"storageQuota": {"enabled": False, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": True}},
        )

        result = self._service().preflight({"operation": "upload", "assetType": "image", "incomingBytes": 999999})

        self.assertTrue(result["success"])
        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "quota_disabled")
        self.assertEqual(result["projectedBytes"], 1000099)

    def test_unknown_size_is_allowed_with_unknown_size_reason(self):
        self._write_usage(100)
        self._write_json(
            self.settings_file,
            {"storageQuota": {"enabled": True, "limitBytes": 200, "warningPercent": 80, "blockWhenExceeded": True}},
        )

        result = self._service().preflight({"operation": "save_output", "assetType": "image"})

        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "unknown_size")
        self.assertEqual(result["incomingBytes"], 0)
        self.assertEqual(result["projectedBytes"], 100)

    def test_block_disabled_exceeded_is_allowed_as_warning(self):
        self._write_usage(90)
        self._write_json(
            self.settings_file,
            {"storageQuota": {"enabled": True, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": False}},
        )

        result = self._service().preflight({"operation": "upload", "assetType": "video", "incomingBytes": 20})

        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "quota_exceeded_warning")
        self.assertEqual(result["projectedBytes"], 110)
        self.assertEqual(result["projectedPercent"], 110)
        self.assertEqual(result["quota"]["blockWhenExceeded"], False)

    def test_block_enabled_exceeded_is_rejected(self):
        self._write_usage(90)
        self._write_json(
            self.settings_file,
            {"storageQuota": {"enabled": True, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": True}},
        )

        result = self._service().preflight({"operation": "generation_result", "assetType": "audio", "incomingBytes": 20})

        self.assertFalse(result["allowed"])
        self.assertEqual(result["reason"], "quota_exceeded")
        self.assertEqual(result["error"], "storage_quota_exceeded")
        self.assertEqual(result["currentBytes"], 90)
        self.assertEqual(result["incomingBytes"], 20)
        self.assertEqual(result["limitBytes"], 100)

    def test_warning_threshold_is_reported_without_blocking(self):
        self._write_usage(70)
        self._write_json(
            self.settings_file,
            {"storageQuota": {"enabled": True, "limitBytes": 100, "warningPercent": 80, "blockWhenExceeded": True}},
        )

        result = self._service().preflight({"operation": "save_output_from_url", "assetType": "file", "incomingBytes": 10})

        self.assertTrue(result["allowed"])
        self.assertEqual(result["reason"], "quota_warning")
        self.assertEqual(result["projectedPercent"], 80)

    def test_response_does_not_leak_secret_like_input_fields(self):
        self._write_usage(90)
        self._write_json(
            self.settings_file,
            {
                "storageQuota": {
                    "enabled": True,
                    "limitBytes": 100,
                    "warningPercent": 80,
                    "blockWhenExceeded": True,
                    "accessKey": "must-not-return",
                    "secretAccessKey": "must-not-return",
                    "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
                }
            },
        )

        result = self._service().preflight(
            {
                "operation": "upload",
                "assetType": "image",
                "incomingBytes": 20,
                "sourceUrl": "https://user:password@example.invalid/private.png?Signature=abc",
            }
        )
        serialized = json.dumps(result, ensure_ascii=False)

        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)
        self.assertNotIn("password", serialized)


if __name__ == "__main__":
    unittest.main()