import json
import os
import tempfile
import threading
import unittest
import urllib.request

import server
from backend.services.asset_retention_policy_service import AssetRetentionPolicyService
from backend.services.asset_retention_scheduler_service import AssetRetentionSchedulerService


DAY_MS = 24 * 60 * 60 * 1000
NOW_MS = 1_910_000_000_000


class AssetRetentionSchedulerRouteTest(unittest.TestCase):
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
        created_at = NOW_MS - 10 * DAY_MS
        asset = {
            "assetId": asset_id,
            "type": "image",
            "url": f"/output/{asset_id}.png",
            "localPath": "/output/old.png",
            "storage": {"type": "local"},
            "size": 50,
            "status": "ready",
            "createdAt": created_at,
            "lastScannedAt": NOW_MS - 8 * DAY_MS,
            "usage": {"usageCount": 0, "references": []},
            "lifecycleStatus": "orphan",
        }
        asset.update(overrides)
        return asset

    def _install_service(self, assets_file, settings_file, runs_file, canvas_dir):
        previous_policy = getattr(server, "ASSET_RETENTION_POLICY_SERVICE", None)
        previous_scheduler = getattr(server, "ASSET_RETENTION_SCHEDULER_SERVICE", None)
        policy_service = AssetRetentionPolicyService(
            assets_file_path=assets_file,
            settings_file_getter=lambda: settings_file,
            canvas_dir_getter=lambda: canvas_dir,
            now_ms_getter=lambda: NOW_MS,
        )
        scheduler_service = AssetRetentionSchedulerService(
            retention_policy_service=policy_service,
            settings_file_getter=lambda: settings_file,
            runs_file_getter=lambda: runs_file,
            now_ms_getter=lambda: NOW_MS,
        )
        server.ASSET_RETENTION_POLICY_SERVICE = policy_service
        server.ASSET_RETENTION_SCHEDULER_SERVICE = scheduler_service
        return previous_policy, previous_scheduler

    def _restore_service(self, previous):
        server.ASSET_RETENTION_POLICY_SERVICE, server.ASSET_RETENTION_SCHEDULER_SERVICE = previous

    def test_scheduler_routes_config_run_and_history(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            settings_file = os.path.join(user_dir, "settings.json")
            runs_file = os.path.join(user_dir, "retention_scheduler_runs.json")
            self._write_json(
                settings_file,
                {
                    "assetRetentionPolicy": {
                        "enabled": True,
                        "orphanRetentionDays": 7,
                        "minAssetAgeHours": 1,
                        "autoDelete": False,
                    },
                    "customStorage": {"buckets": [{"accessKey": "keep", "secretAccessKey": "keep-secret"}]},
                },
            )
            self._write_json(assets_file, {"version": 1, "assets": [self._asset("asset_old")]})
            previous = self._install_service(assets_file, settings_file, runs_file, canvas_dir)
            httpd, base_url = self._start_http_server()
            try:
                get_status, get_payload = self._json_request(f"{base_url}/api/v2/assets/retention/scheduler")
                put_status, put_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/scheduler",
                    {
                        "enabled": True,
                        "intervalHours": 0,
                        "runOnStartup": True,
                        "markCandidates": True,
                        "autoDelete": True,
                        "maxAssetsPerRun": 20,
                    },
                    method="PUT",
                )
                dry_status, dry_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/scheduler/run",
                    {"mode": "manual", "dryRun": True},
                    method="POST",
                )
                before_apply = self._read_json(assets_file)
                run_status, run_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/scheduler/run",
                    {"mode": "manual", "dryRun": False},
                    method="POST",
                )
                runs_status, runs_payload = self._json_request(f"{base_url}/api/v2/assets/retention/scheduler/runs")
            finally:
                httpd.shutdown()
                httpd.server_close()
                self._restore_service(previous)
            after_apply = self._read_json(assets_file)

        self.assertEqual(get_status, 200)
        self.assertEqual(put_status, 200)
        self.assertEqual(dry_status, 200)
        self.assertEqual(run_status, 200)
        self.assertEqual(runs_status, 200)
        self.assertFalse(get_payload["scheduler"]["enabled"])
        self.assertTrue(put_payload["scheduler"]["enabled"])
        self.assertEqual(put_payload["scheduler"]["intervalHours"], 1)
        self.assertFalse(put_payload["scheduler"]["autoDelete"])
        self.assertTrue(any(warning["code"] == "unsupported_auto_delete" for warning in put_payload["warnings"]))
        self.assertEqual(before_apply["assets"][0]["lifecycleStatus"], "orphan")
        self.assertEqual(dry_payload["run"]["candidateCount"], 1)
        self.assertEqual(dry_payload["run"]["markedCount"], 0)
        self.assertEqual(run_payload["run"]["markedCount"], 1)
        self.assertEqual(after_apply["assets"][0]["lifecycleStatus"], "deleted_candidate")
        self.assertGreaterEqual(len(runs_payload["runs"]), 2)
        self.assertEqual(runs_payload["runs"][-1]["status"], "success")
        self.assertEqual(run_payload["scheduler"]["lastRunAt"], NOW_MS)
        self.assertGreater(run_payload["scheduler"]["nextRunAt"], NOW_MS)

    def test_scheduler_route_responses_do_not_leak_secret_like_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            settings_file = os.path.join(user_dir, "settings.json")
            runs_file = os.path.join(user_dir, "retention_scheduler_runs.json")
            self._write_json(
                settings_file,
                {"retentionScheduler": {"enabled": True, "autoDelete": True, "accessKey": "must-not-return"}},
            )
            self._write_json(
                assets_file,
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
            previous = self._install_service(assets_file, settings_file, runs_file, canvas_dir)
            httpd, base_url = self._start_http_server()
            try:
                _, get_payload = self._json_request(f"{base_url}/api/v2/assets/retention/scheduler")
                _, run_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/scheduler/run",
                    {"mode": "manual", "dryRun": True},
                    method="POST",
                )
                _, runs_payload = self._json_request(f"{base_url}/api/v2/assets/retention/scheduler/runs")
            finally:
                httpd.shutdown()
                httpd.server_close()
                self._restore_service(previous)

        serialized = json.dumps({"get": get_payload, "run": run_payload, "runs": runs_payload}, ensure_ascii=False)
        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature=abc", serialized)


if __name__ == "__main__":
    unittest.main()