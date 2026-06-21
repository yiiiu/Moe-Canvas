import json
import os
import tempfile
import threading
import time
import unittest

from backend.services.asset_retention_policy_service import AssetRetentionPolicyService
from backend.services.asset_retention_scheduler_service import AssetRetentionSchedulerService


DAY_MS = 24 * 60 * 60 * 1000
NOW_MS = 1_900_000_000_000


class AssetRetentionSchedulerServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.user_dir = os.path.join(root, "user")
        self.canvas_dir = os.path.join(self.user_dir, "Canvas Project")
        os.makedirs(self.canvas_dir, exist_ok=True)
        self.assets_file = os.path.join(self.user_dir, "assets.json")
        self.settings_file = os.path.join(self.user_dir, "settings.json")
        self.runs_file = os.path.join(self.user_dir, "retention_scheduler_runs.json")
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

    def _asset(self, asset_id, **overrides):
        created_at = NOW_MS - 10 * DAY_MS
        asset = {
            "assetId": asset_id,
            "type": "image",
            "url": f"/output/{asset_id}.png",
            "localPath": self.local_file,
            "objectKey": "media/old.png",
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

    def _seed_policy(self):
        self._write_json(
            self.settings_file,
            {
                "assetRetentionPolicy": {
                    "enabled": True,
                    "orphanRetentionDays": 7,
                    "tempRetentionHours": 24,
                    "deleteCandidateOnly": True,
                    "autoDelete": False,
                    "minAssetAgeHours": 1,
                    "excludePinned": True,
                    "excludeRecentlyUsedHours": 24,
                }
            },
        )

    def _seed_assets(self, assets):
        self._write_json(self.assets_file, {"version": 1, "assets": assets})

    def _service(self, now_ms=NOW_MS, retention_service=None):
        retention = retention_service or AssetRetentionPolicyService(
            assets_file_path=self.assets_file,
            settings_file_getter=lambda: self.settings_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            now_ms_getter=lambda: now_ms,
        )
        return AssetRetentionSchedulerService(
            retention_policy_service=retention,
            settings_file_getter=lambda: self.settings_file,
            runs_file_getter=lambda: self.runs_file,
            now_ms_getter=lambda: now_ms,
        )

    def test_scheduler_defaults_disabled_and_no_auto_delete(self):
        self._write_json(self.settings_file, {})

        result = self._service().get_scheduler()

        self.assertTrue(result["success"])
        self.assertFalse(result["scheduler"]["enabled"])
        self.assertEqual(result["scheduler"]["intervalHours"], 24)
        self.assertFalse(result["scheduler"]["runOnStartup"])
        self.assertTrue(result["scheduler"]["markCandidates"])
        self.assertFalse(result["scheduler"]["autoDelete"])
        self.assertFalse(result["running"])

    def test_update_scheduler_forces_auto_delete_false_and_preserves_other_settings(self):
        self._write_json(
            self.settings_file,
            {
                "theme": "dark",
                "customStorage": {
                    "buckets": [
                        {"id": "bucket", "accessKey": "existing-access", "secretAccessKey": "existing-secret"}
                    ]
                },
            },
        )

        result = self._service().update_scheduler(
            {
                "enabled": True,
                "intervalHours": 0,
                "runOnStartup": True,
                "markCandidates": True,
                "autoDelete": True,
                "maxAssetsPerRun": 10,
            }
        )
        settings = self._read_json(self.settings_file)

        self.assertTrue(result["success"])
        self.assertFalse(result["scheduler"]["autoDelete"])
        self.assertEqual(result["scheduler"]["intervalHours"], 1)
        self.assertTrue(any(warning["code"] == "unsupported_auto_delete" for warning in result["warnings"]))
        self.assertEqual(settings["customStorage"]["buckets"][0]["accessKey"], "existing-access")
        self.assertEqual(settings["customStorage"]["buckets"][0]["secretAccessKey"], "existing-secret")

    def test_manual_dry_run_writes_history_without_modifying_assets(self):
        self._seed_policy()
        self._seed_assets([self._asset("asset_old")])
        before = self._read_json(self.assets_file)

        result = self._service().run_once({"mode": "manual", "dryRun": True})
        after = self._read_json(self.assets_file)
        runs = self._read_json(self.runs_file)["runs"]

        self.assertEqual(before, after)
        self.assertTrue(result["success"])
        self.assertTrue(result["dryRun"])
        self.assertEqual(result["run"]["status"], "success")
        self.assertEqual(result["run"]["candidateCount"], 1)
        self.assertEqual(result["run"]["markedCount"], 0)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["mode"], "manual")

    def test_manual_run_marks_candidates_without_deleting_files_or_s3_objects(self):
        self._seed_policy()
        self._seed_assets(
            [
                self._asset("asset_local", localPath=self.local_file, storage={"type": "local"}),
                self._asset("asset_s3", localPath="", storage={"type": "s3-compatible", "bucket": "safe"}),
                self._asset("asset_active", lifecycleStatus="active"),
                self._asset("asset_pinned", pinned=True),
                self._asset("asset_new", createdAt=NOW_MS - 10 * 60 * 1000, lastScannedAt=NOW_MS - 10 * 60 * 1000),
            ]
        )

        result = self._service().run_once({"mode": "manual", "dryRun": False})
        registry = self._read_json(self.assets_file)
        by_id = {asset["assetId"]: asset for asset in registry["assets"]}

        self.assertTrue(result["success"])
        self.assertEqual(result["run"]["status"], "success")
        self.assertEqual(result["run"]["markedCount"], 2)
        self.assertEqual(result["run"]["skippedActive"], 1)
        self.assertEqual(result["run"]["skippedPinned"], 1)
        self.assertEqual(result["run"]["skippedTooNew"], 1)
        self.assertTrue(os.path.exists(self.local_file))
        self.assertEqual(by_id["asset_local"]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(by_id["asset_s3"]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(by_id["asset_s3"]["objectKey"], "media/old.png")
        self.assertEqual(by_id["asset_active"]["lifecycleStatus"], "active")
        self.assertEqual(by_id["asset_pinned"]["lifecycleStatus"], "orphan")
        self.assertEqual(by_id["asset_new"]["lifecycleStatus"], "orphan")

    def test_manual_run_respects_max_assets_per_run(self):
        self._seed_policy()
        self._seed_assets([self._asset(f"asset_{index}") for index in range(3)])
        service = self._service()
        service.update_scheduler({"enabled": True, "maxAssetsPerRun": 1})

        result = service.run_once({"mode": "manual", "dryRun": False})
        registry = self._read_json(self.assets_file)
        marked = [asset for asset in registry["assets"] if asset.get("lifecycleStatus") == "deleted_candidate"]
        orphan = [asset for asset in registry["assets"] if asset.get("lifecycleStatus") == "orphan"]

        self.assertEqual(result["run"]["candidateCount"], 1)
        self.assertEqual(result["run"]["markedCount"], 1)
        self.assertEqual(len(marked), 1)
        self.assertEqual(len(orphan), 2)

    def test_run_updates_last_and_next_run_at(self):
        self._seed_policy()
        self._seed_assets([self._asset("asset_old")])
        self._service().update_scheduler({"enabled": True, "intervalHours": 6})

        result = self._service().run_once({"mode": "manual", "dryRun": True})
        settings = self._read_json(self.settings_file)
        scheduler = settings["retentionScheduler"]

        self.assertEqual(result["scheduler"]["lastRunAt"], NOW_MS)
        self.assertEqual(result["scheduler"]["nextRunAt"], NOW_MS + 6 * 60 * 60 * 1000)
        self.assertEqual(scheduler["lastRunAt"], NOW_MS)
        self.assertEqual(scheduler["nextRunAt"], NOW_MS + 6 * 60 * 60 * 1000)

    def test_already_running_returns_skipped_without_second_apply(self):
        class SlowRetentionService(AssetRetentionPolicyService):
            def evaluate(inner_self, request=None):
                time.sleep(0.15)
                return super().evaluate(request)

        self._seed_policy()
        self._seed_assets([self._asset("asset_old")])
        retention = SlowRetentionService(
            assets_file_path=self.assets_file,
            settings_file_getter=lambda: self.settings_file,
            canvas_dir_getter=lambda: self.canvas_dir,
            now_ms_getter=lambda: NOW_MS,
        )
        service = self._service(retention_service=retention)
        first_result = {}
        thread = threading.Thread(target=lambda: first_result.update(service.run_once({"mode": "manual", "dryRun": True})))
        thread.start()
        time.sleep(0.03)

        second = service.run_once({"mode": "manual", "dryRun": True})
        thread.join(timeout=2)

        self.assertEqual(second["run"]["status"], "skipped")
        self.assertEqual(second["run"]["errors"][0], "already_running")
        self.assertEqual(first_result["run"]["status"], "success")

    def test_enabled_false_does_not_auto_run_and_startup_can_trigger_once(self):
        self._seed_policy()
        self._seed_assets([self._asset("asset_old")])
        service = self._service()
        service.update_scheduler({"enabled": False, "runOnStartup": True, "intervalHours": 1})

        skipped = service.maybe_run_scheduled(mode="scheduled")
        self.assertEqual(skipped["run"]["status"], "skipped")
        self.assertEqual(skipped["run"]["errors"][0], "scheduler_disabled")

        service.update_scheduler({"enabled": True, "runOnStartup": True, "intervalHours": 1, "markCandidates": True})
        startup = service.maybe_run_scheduled(mode="startup")
        self.assertEqual(startup["run"]["status"], "success")
        self.assertEqual(startup["run"]["mode"], "startup")

    def test_background_scheduler_runs_due_job_without_blocking(self):
        self._seed_policy()
        self._seed_assets([self._asset("asset_old")])
        service = self._service()
        service.update_scheduler({"enabled": True, "intervalHours": 1, "runOnStartup": False, "markCandidates": True})
        stop_event = threading.Event()

        thread = service.start_background_scheduler(stop_event=stop_event, poll_interval_seconds=0.01)
        deadline = time.time() + 1
        while time.time() < deadline:
            if os.path.exists(self.runs_file):
                break
            time.sleep(0.02)
        stop_event.set()
        thread.join(timeout=1)
        registry = self._read_json(self.assets_file)
        runs = self._read_json(self.runs_file)["runs"]

        self.assertFalse(thread.is_alive())
        self.assertEqual(registry["assets"][0]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(runs[0]["status"], "success")
        self.assertIn(runs[0]["mode"], ("startup", "scheduled"))

    def test_responses_do_not_leak_secret_like_fields(self):
        self._write_json(
            self.settings_file,
            {"retentionScheduler": {"enabled": True, "autoDelete": True, "accessKey": "must-not-return"}},
        )
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    self._asset(
                        "asset_secret",
                        storage={"type": "s3-compatible", "bucket": "safe", "secretAccessKey": "must-not-return"},
                        Authorization="AWS4-HMAC-SHA256 Signature=abc",
                        url="https://cdn.example/file.png?Signature=abc",
                    )
                ],
            },
        )

        result = self._service().run_once({"mode": "manual", "dryRun": True})
        serialized = json.dumps(result, ensure_ascii=False)

        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature=abc", serialized)


if __name__ == "__main__":
    unittest.main()