import json
import os
import tempfile
import unittest
from types import SimpleNamespace

from backend.services.json_file_route_service import JsonFileRouteService


class JsonFileRouteServiceAssetRegistryTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = self.temp_dir.name
        self.assets_dir = os.path.join(root, "data", "assets")
        self.user_dir = os.path.join(root, "user")
        self.output_dir = os.path.join(root, "output")
        self.canvas_dir = os.path.join(root, "canvas")
        self.workflows_dir = os.path.join(root, "workflows")
        self.uploads_dir = os.path.join(root, "uploads")
        for path in (
            self.assets_dir,
            self.user_dir,
            self.output_dir,
            self.canvas_dir,
            self.workflows_dir,
            self.uploads_dir,
        ):
            os.makedirs(path, exist_ok=True)
        self.service = JsonFileRouteService(
            canvas_dir_getter=lambda: self.canvas_dir,
            assets_dir_getter=lambda: self.assets_dir,
            workflows_dir_getter=lambda: self.workflows_dir,
            user_dir_getter=lambda: self.user_dir,
            read_user_settings=lambda: {},
            write_user_settings=lambda settings: None,
            atomic_write_json=lambda path, payload: None,
            output_dir_getter=lambda: self.output_dir,
            uploads_dir_getter=lambda: self.uploads_dir,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_json(self, path, payload):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def test_generation_history_source_image_node_data_includes_matching_asset_record(self):
        self._write_json(
            os.path.join(self.user_dir, "assets.json"),
            {
                "version": 1,
                "assets": [
                    {
                        "assetId": "asset_history_image",
                        "type": "image",
                        "url": "https://oss.example.test/image/gen.png",
                        "localPath": "output/gen.png",
                        "objectKey": "image/gen.png",
                        "storage": {
                            "type": "s3-compatible",
                            "bucket": "safe-bucket",
                            "secretKey": "must-not-leak",
                        },
                        "status": "ready",
                    }
                ],
            },
        )
        self._write_json(
            os.path.join(self.assets_dir, "gen-history-1.json"),
            {
                "id": "gen-history-1",
                "kind": "generation-history",
                "items": [
                    {
                        "type": "source-image",
                        "nodeData": {
                            "id": "source-image-history-1",
                            "type": "source-image",
                            "imageUrl": "/output/gen.png",
                            "localPath": "output/gen.png",
                            "src": "/output/gen.png",
                            "thumbUrl": "/output/gen.png",
                        },
                    }
                ],
            },
        )

        result = self.service.handle_get(SimpleNamespace(path="/api/v2/assets"), "/api/v2/assets")

        node_data = result["data"][0]["items"][0]["nodeData"]
        self.assertEqual(node_data["assetId"], "asset_history_image")
        self.assertEqual(node_data["asset"]["assetId"], "asset_history_image")
        self.assertEqual(node_data["asset"]["url"], "https://oss.example.test/image/gen.png")
        self.assertEqual(node_data["imageUrl"], "/output/gen.png")
        self.assertNotIn("secretKey", node_data["asset"].get("storage", {}))

    def test_generation_history_node_data_without_matching_asset_stays_legacy_only(self):
        self._write_json(
            os.path.join(self.user_dir, "assets.json"),
            {"version": 1, "assets": []},
        )
        self._write_json(
            os.path.join(self.assets_dir, "gen-history-2.json"),
            {
                "id": "gen-history-2",
                "kind": "generation-history",
                "items": [
                    {
                        "type": "source-image",
                        "nodeData": {
                            "id": "source-image-history-2",
                            "type": "source-image",
                            "imageUrl": "/output/legacy.png",
                            "localPath": "output/legacy.png",
                        },
                    }
                ],
            },
        )

        result = self.service.handle_get(SimpleNamespace(path="/api/v2/assets"), "/api/v2/assets")

        node_data = result["data"][0]["items"][0]["nodeData"]
        self.assertNotIn("assetId", node_data)
        self.assertNotIn("asset", node_data)
        self.assertEqual(node_data["imageUrl"], "/output/legacy.png")


if __name__ == "__main__":
    unittest.main()