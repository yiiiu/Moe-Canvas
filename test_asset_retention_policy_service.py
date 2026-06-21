import json
import os
import tempfile
import unittest

from backend.services.asset_retention_policy_service import AssetRetentionPolicyService


DAY_MS = 24 * 60 * 60 * 1000
HOUR_MS = 60 * 60 * 1000
NOW_MS = 1_800_000_000_000


class AssetRetentionPolicyServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.user_dir = os.path.join(root, "user")
        self.canvas_dir = os.path.join(self.user_dir, "Canvas Project")
        os.makedirs(self.canvas_dir, exist_ok=True)
        self.assets_file = os.path.join(self.user_dir, "assets.json")
        self.settings_file = os.path.join(self.user_dir, "settings.json")
        self.local_file = os.path.join(root, "output", "old.png")
        os.makedirs(os.path.dirname(self.local_file), exist_ok=True)
        with open(self.local_file, "wb") as file:
            file.write(b"old")

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _read_json(self, path):
        with open(path, "r", encoding="utf-8-sig") as file:
            return json.load(file)

    def _service(self):
        return AssetRetentionPolicyService(
            assets_file_path=self.assets_file,
            settings_file_getter=lambda: self.settings_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            now_ms_getter=lambda: NOW_MS,
        )

    def _seed_policy(self, **overrides):
        policy = {
            "enabled": True,
            "orphanRetentionDays": 7,
            "tempRetentionHours": 24,
            "deleteCandidateOnly": True,
            "autoDelete": False,
            "minAssetAgeHours": 1,
            "excludePinned": True,
            "excludeRecentlyUsedHours": 24,
        }
        policy.update(overrides)
        self._write_json(self.settings_file, {"assetRetentionPolicy": policy, "theme": "dark"})
        return policy

    def _asset(self, asset_id, **overrides):
        created_at = NOW_MS - 10 * DAY_MS
        asset = {
            "assetId": asset_id,
            "type": "image",
            "url": f"/output/{asset_id}.png",
            "localPath": self.local_file,
            "storage": {"type": "local"},
            "size": 123,
            "status": "ready",
            "createdAt": created_at,
            "updatedAt": created_at,
            "lastScannedAt": NOW_MS - 8 * DAY_MS,
            "lastUsedAt": 0,
            "usage": {"usageCount": 0, "references": []},
            "lifecycleStatus": "orphan",
        }
        asset.update(overrides)
        return asset

    def _seed_assets(self, assets):
        self._write_json(self.assets_file, {"version": 1, "assets": assets})

    def test_policy_defaults_force_candidate_only_and_no_auto_delete(self):
        self._write_json(
            self.settings_file,
            {"assetRetentionPolicy": {"autoDelete": True, "deleteCandidateOnly": False, "accessKey": "must-not-return"}},
        )

        policy = self._service().get_policy()["policy"]
        serialized = json.dumps(policy, ensure_ascii=False)

        self.assertTrue(policy["deleteCandidateOnly"])
        self.assertFalse(policy["autoDelete"])
        self.assertEqual(policy["autoDeleteStatus"], "unsupported_auto_delete")
        self.assertNotIn("accessKey", serialized)

    def test_update_policy_persists_sanitized_policy_and_keeps_existing_settings(self):
        self._write_json(
            self.settings_file,
            {
                "theme": "dark",
                "customStorage": {
                    "buckets": [
                        {
                            "id": "bucket_existing",
                            "accessKey": "existing-access-key-placeholder",
                            "secretAccessKey": "existing-secret-key-placeholder",
                        }
                    ]
                },
            },
        )

        result = self._service().update_policy(
            {
                "enabled": True,
                "orphanRetentionDays": 14,
                "minAssetAgeHours": 2,
                "autoDelete": True,
                "secretAccessKey": "must-not-return",
            }
        )
        settings = self._read_json(self.settings_file)

        self.assertTrue(result["success"])
        self.assertEqual(settings["theme"], "dark")
        self.assertEqual(settings["customStorage"]["buckets"][0]["accessKey"], "existing-access-key-placeholder")
        self.assertEqual(settings["customStorage"]["buckets"][0]["secretAccessKey"], "existing-secret-key-placeholder")
        self.assertEqual(settings["assetRetentionPolicy"]["orphanRetentionDays"], 14)
        self.assertEqual(settings["assetRetentionPolicy"]["minAssetAgeHours"], 2)
        self.assertFalse(settings["assetRetentionPolicy"]["autoDelete"])
        self.assertNotIn("must-not-return", json.dumps(result, ensure_ascii=False))

    def test_evaluate_is_read_only_and_returns_only_eligible_orphan_candidates(self):
        self._seed_policy()
        self._seed_assets(
            [
                self._asset("asset_old_orphan"),
                self._asset("asset_active", lifecycleStatus="active"),
                self._asset("asset_used", usage={"usageCount": 1, "references": [{"nodeId": "node"}]}),
                self._asset("asset_new", createdAt=NOW_MS - 30 * 60 * 1000, lastScannedAt=NOW_MS - 30 * 60 * 1000),
                self._asset("asset_pinned", pinned=True),
                self._asset("asset_deleted", lifecycleStatus="deleted"),
                self._asset("asset_delete_failed", lifecycleStatus="delete_failed"),
                self._asset("asset_missing_created", createdAt=0),
            ]
        )
        before = self._read_json(self.assets_file)

        result = self._service().evaluate({"dryRun": True})
        after = self._read_json(self.assets_file)

        self.assertEqual(before, after)
        self.assertTrue(result["success"])
        self.assertTrue(result["dryRun"])
        self.assertEqual([item["assetId"] for item in result["candidates"]], ["asset_old_orphan"])
        self.assertEqual(result["reclaimableBytes"], 123)
        skipped = {item["assetId"]: item["reason"] for item in result["skipped"]}
        self.assertEqual(skipped["asset_active"], "active_asset")
        self.assertEqual(skipped["asset_used"], "asset_in_use")
        self.assertEqual(skipped["asset_new"], "asset_too_new")
        self.assertEqual(skipped["asset_pinned"], "pinned_asset")
        self.assertEqual(skipped["asset_deleted"], "already_deleted")
        self.assertEqual(skipped["asset_delete_failed"], "delete_failed")
        self.assertEqual(skipped["asset_missing_created"], "missing_created_at")
        self.assertTrue(any(warning["assetId"] == "asset_missing_created" for warning in result["warnings"]))

    def test_apply_marks_candidates_without_deleting_local_or_s3_objects(self):
        self._seed_policy(autoDelete=True)
        self._seed_assets(
            [
                self._asset("asset_local_old", localPath=self.local_file, storage={"type": "local"}),
                self._asset(
                    "asset_s3_old",
                    localPath="",
                    objectKey="media/old.png",
                    storage={"type": "s3-compatible", "bucket": "safe-bucket", "endpoint": "https://storage.example"},
                ),
                self._asset("asset_active", lifecycleStatus="active"),
            ]
        )

        result = self._service().apply({})
        registry = self._read_json(self.assets_file)
        by_id = {asset["assetId"]: asset for asset in registry["assets"]}

        self.assertTrue(result["success"])
        self.assertEqual(result["mode"], "candidate_only")
        self.assertEqual(result["autoDeleteStatus"], "unsupported_auto_delete")
        self.assertTrue(os.path.exists(self.local_file))
        self.assertEqual([item["assetId"] for item in result["marked"]], ["asset_local_old", "asset_s3_old"])
        self.assertEqual(by_id["asset_local_old"]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(by_id["asset_local_old"]["lifecycleReason"], "retention_orphan_expired")
        self.assertEqual(by_id["asset_local_old"]["candidateAt"], NOW_MS)
        self.assertEqual(by_id["asset_local_old"]["retentionCheckedAt"], NOW_MS)
        self.assertEqual(by_id["asset_local_old"]["retentionPolicySnapshot"]["orphanRetentionDays"], 7)
        self.assertEqual(by_id["asset_s3_old"]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(by_id["asset_s3_old"]["objectKey"], "media/old.png")
        self.assertEqual(by_id["asset_active"]["lifecycleStatus"], "active")

    def test_missing_reference_risk_asset_is_skipped(self):
        self._seed_policy()
        self._seed_assets([self._asset("asset_risk")])

        result = self._service().evaluate({"missingAssetReferences": [{"assetId": "asset_risk", "nodeId": "node-a"}]})

        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["skipped"][0]["reason"], "missing_reference_risk")

    def test_responses_do_not_leak_secret_like_fields(self):
        self._seed_policy()
        self._seed_assets(
            [
                self._asset(
                    "asset_secret",
                    storage={
                        "type": "s3-compatible",
                        "bucket": "safe-bucket",
                        "accessKey": "must-not-return",
                        "secretAccessKey": "must-not-return",
                    },
                    Authorization="AWS4-HMAC-SHA256 Signature=abc",
                    url="https://cdn.example/old.png?Signature=abc",
                )
            ]
        )

        result = self._service().evaluate({})
        serialized = json.dumps(result, ensure_ascii=False)

        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature=abc", serialized)


if __name__ == "__main__":
    unittest.main()