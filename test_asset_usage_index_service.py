import json
import os
import tempfile
import unittest

from backend.services.asset_usage_index_service import AssetUsageIndexService


class AssetUsageIndexServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.user_dir = os.path.join(root, "user")
        self.canvas_dir = os.path.join(self.user_dir, "Canvas Project")
        os.makedirs(self.canvas_dir, exist_ok=True)
        self.assets_file = os.path.join(self.user_dir, "assets.json")

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
        return AssetUsageIndexService(
            assets_file_path=self.assets_file,
            canvas_dir_getter=lambda: self.canvas_dir,
        )

    def test_rebuild_usage_index_counts_single_image_node_reference(self):
        self._write_json(
            self.assets_file,
            {"version": 1, "assets": [{"assetId": "asset_img", "type": "image", "url": "/output/a.png"}]},
        )
        self._write_json(
            os.path.join(self.canvas_dir, "project-a.json"),
            {
                "canvases": [
                    {
                        "id": "canvas_a",
                        "nodes": [
                            {"id": "node_img", "type": "source-image", "assetId": "asset_img"},
                        ],
                    }
                ]
            },
        )

        summary = self._service().rebuild_usage_index()
        registry = self._read_assets()
        asset = registry["assets"][0]

        self.assertTrue(summary["success"])
        self.assertEqual(summary["scannedProjects"], 1)
        self.assertEqual(summary["scannedNodes"], 1)
        self.assertEqual(summary["usedAssets"], 1)
        self.assertEqual(asset["usage"]["usageCount"], 1)
        self.assertEqual(asset["usage"]["references"][0]["projectId"], "project-a")
        self.assertEqual(asset["usage"]["references"][0]["canvasId"], "canvas_a")
        self.assertEqual(asset["usage"]["references"][0]["nodeId"], "node_img")
        self.assertEqual(asset["usage"]["references"][0]["nodeType"], "source-image")
        self.assertEqual(asset["lifecycleStatus"], "active")
        self.assertGreater(asset["lastScannedAt"], 0)
        self.assertGreater(asset["lastUsedAt"], 0)

    def test_rebuild_usage_index_counts_multiple_node_references(self):
        self._write_json(
            self.assets_file,
            {"version": 1, "assets": [{"assetId": "asset_shared", "type": "video", "url": "/output/v.mp4"}]},
        )
        self._write_json(
            os.path.join(self.canvas_dir, "project-b.json"),
            {
                "nodes": {
                    "node_1": {"id": "node_1", "type": "source-video", "assetId": "asset_shared"},
                    "node_2": {"id": "node_2", "type": "ai-video", "data": {"assetId": "asset_shared"}},
                }
            },
        )

        summary = self._service().rebuild_usage_index()
        asset = self._read_assets()["assets"][0]

        self.assertEqual(summary["scannedNodes"], 2)
        self.assertEqual(asset["usage"]["usageCount"], 2)
        self.assertEqual(len(asset["usage"]["references"]), 2)
        self.assertEqual(summary["orphanAssets"], 0)

    def test_rebuild_usage_index_marks_unreferenced_asset_orphan(self):
        self._write_json(
            self.assets_file,
            {"version": 1, "assets": [{"assetId": "asset_orphan", "type": "audio", "url": "/output/a.mp3"}]},
        )
        self._write_json(os.path.join(self.canvas_dir, "empty.json"), {"canvases": [{"id": "canvas_empty", "nodes": []}]})

        summary = self._service().rebuild_usage_index()
        asset = self._read_assets()["assets"][0]
        orphans = self._service().list_orphans()

        self.assertEqual(summary["orphanAssets"], 1)
        self.assertEqual(asset["usage"]["usageCount"], 0)
        self.assertEqual(asset["lifecycleStatus"], "orphan")
        self.assertEqual(orphans[0]["assetId"], "asset_orphan")

    def test_rebuild_usage_index_reports_missing_asset_reference_and_skips_legacy_url_only_node(self):
        self._write_json(
            self.assets_file,
            {"version": 1, "assets": [{"assetId": "asset_known", "type": "image", "url": "/output/known.png"}]},
        )
        self._write_json(
            os.path.join(self.canvas_dir, "project-missing.json"),
            {
                "canvases": [
                    {
                        "id": "canvas_missing",
                        "nodes": [
                            {"id": "missing_node", "type": "source-image", "assetId": "asset_missing"},
                            {"id": "legacy_node", "type": "source-image", "imageUrl": "/output/legacy.png"},
                        ],
                    }
                ]
            },
        )

        summary = self._service().rebuild_usage_index()
        missing = summary["missingAssetReferences"]

        self.assertEqual(summary["scannedNodes"], 2)
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]["assetId"], "asset_missing")
        self.assertEqual(missing[0]["nodeId"], "missing_node")
        self.assertEqual(self._read_assets()["assets"][0]["lifecycleStatus"], "orphan")

    def test_rebuild_usage_index_skips_broken_project_and_records_warning(self):
        self._write_json(self.assets_file, {"version": 1, "assets": []})
        with open(os.path.join(self.canvas_dir, "broken.json"), "w", encoding="utf-8") as file:
            file.write("{")

        summary = self._service().rebuild_usage_index()

        self.assertEqual(summary["scannedProjects"], 0)
        self.assertEqual(len(summary["warnings"]), 1)
        self.assertIn("broken.json", summary["warnings"][0]["projectFile"])

    def test_usage_and_orphan_queries_return_sanitized_payloads(self):
        self._write_json(
            self.assets_file,
            {
                "version": 1,
                "assets": [
                    {
                        "assetId": "asset_secret",
                        "type": "image",
                        "url": "/output/secret.png",
                        "secretAccessKey": "must-not-return",
                        "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
                        "storage": {"type": "s3-compatible", "bucket": "safe", "signature": "must-not-return"},
                    }
                ],
            },
        )
        self._write_json(os.path.join(self.canvas_dir, "empty.json"), {"nodes": []})

        self._service().rebuild_usage_index()
        usage = self._service().get_usage("asset_secret")
        orphans = self._service().list_orphans()
        serialized = json.dumps({"usage": usage, "orphans": orphans}, ensure_ascii=False)

        self.assertEqual(usage["assetId"], "asset_secret")
        self.assertEqual(usage["usage"]["references"], [])
        self.assertNotIn("secretAccessKey", serialized)
        self.assertNotIn("Authorization", serialized)
        self.assertNotIn("Signature", serialized)
        self.assertNotIn("signature", serialized)
        self.assertEqual(orphans[0]["storage"]["type"], "s3-compatible")
        self.assertNotIn("bucket", orphans[0]["storage"])


if __name__ == "__main__":
    unittest.main()