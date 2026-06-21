import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

import server
from backend.services.asset_retention_policy_service import AssetRetentionPolicyService


DAY_MS = 24 * 60 * 60 * 1000
NOW_MS = 1_800_000_000_000


class AssetRetentionPolicyRouteTest(unittest.TestCase):
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

    def _install_service(self, tmpdir, assets_file, settings_file, canvas_dir):
        previous = getattr(server, "ASSET_RETENTION_POLICY_SERVICE", None)
        server.ASSET_RETENTION_POLICY_SERVICE = AssetRetentionPolicyService(
            assets_file_path=assets_file,
            settings_file_getter=lambda: settings_file,
            canvas_dir_getter=lambda: canvas_dir,
            now_ms_getter=lambda: NOW_MS,
        )
        return previous

    def test_policy_get_put_evaluate_and_apply_routes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            settings_file = os.path.join(user_dir, "settings.json")
            local_file = os.path.join(tmpdir, "output", "old.png")
            os.makedirs(os.path.dirname(local_file), exist_ok=True)
            with open(local_file, "wb") as file:
                file.write(b"old")
            self._write_json(settings_file, {"theme": "dark"})
            self._write_json(
                assets_file,
                {
                    "version": 1,
                    "assets": [
                        self._asset("asset_old", localPath=local_file),
                        self._asset("asset_active", lifecycleStatus="active"),
                        self._asset("asset_pinned", pinned=True),
                    ],
                },
            )
            previous = self._install_service(tmpdir, assets_file, settings_file, canvas_dir)
            httpd, base_url = self._start_http_server()
            try:
                get_status, get_payload = self._json_request(f"{base_url}/api/v2/assets/retention/policy")
                put_status, put_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/policy",
                    {"orphanRetentionDays": 7, "minAssetAgeHours": 1, "autoDelete": True},
                    method="PUT",
                )
                eval_status, eval_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/evaluate",
                    {"dryRun": True},
                    method="POST",
                )
                before_apply = self._read_json(assets_file)
                apply_status, apply_payload = self._json_request(
                    f"{base_url}/api/v2/assets/retention/apply",
                    {},
                    method="POST",
                )
                local_file_exists_after_apply = os.path.exists(local_file)
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.ASSET_RETENTION_POLICY_SERVICE = previous
            after_apply = self._read_json(assets_file)

        self.assertEqual(get_status, 200)
        self.assertEqual(put_status, 200)
        self.assertEqual(eval_status, 200)
        self.assertEqual(apply_status, 200)
        self.assertTrue(get_payload["success"])
        self.assertTrue(put_payload["success"])
        self.assertFalse(put_payload["policy"]["autoDelete"])
        self.assertEqual(put_payload["policy"]["autoDeleteStatus"], "unsupported_auto_delete")
        self.assertEqual([item["assetId"] for item in eval_payload["candidates"]], ["asset_old"])
        self.assertEqual(before_apply["assets"][0]["lifecycleStatus"], "orphan")
        self.assertEqual([item["assetId"] for item in apply_payload["marked"]], ["asset_old"])
        by_id = {item["assetId"]: item for item in after_apply["assets"]}
        self.assertEqual(by_id["asset_old"]["lifecycleStatus"], "deleted_candidate")
        self.assertEqual(by_id["asset_active"]["lifecycleStatus"], "active")
        self.assertEqual(by_id["asset_pinned"]["lifecycleStatus"], "orphan")
        self.assertTrue(local_file_exists_after_apply)

    def test_retention_routes_do_not_leak_secret_like_fields(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            user_dir = os.path.join(tmpdir, "user")
            canvas_dir = os.path.join(user_dir, "Canvas Project")
            assets_file = os.path.join(user_dir, "assets.json")
            settings_file = os.path.join(user_dir, "settings.json")
            self._write_json(
                settings_file,
                {"assetRetentionPolicy": {"enabled": True, "accessKey": "must-not-return", "autoDelete": True}},
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
            previous = self._install_service(tmpdir, assets_file, settings_file, canvas_dir)
            httpd, base_url = self._start_http_server()
            try:
                _, payload = self._json_request(f"{base_url}/api/v2/assets/retention/evaluate", {}, method="POST")
            finally:
                httpd.shutdown()
                httpd.server_close()
                server.ASSET_RETENTION_POLICY_SERVICE = previous

        serialized = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("accessKey", serialized)
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature=abc", serialized)

    def test_apply_route_rejects_invalid_json(self):
        httpd, base_url = self._start_http_server()
        try:
            request = urllib.request.Request(
                f"{base_url}/api/v2/assets/retention/apply",
                data=b"{",
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request, timeout=5)
        finally:
            httpd.shutdown()
            httpd.server_close()

        self.assertEqual(caught.exception.code, 400)


if __name__ == "__main__":
    unittest.main()