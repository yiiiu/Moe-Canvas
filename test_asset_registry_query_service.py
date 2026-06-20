import json
import os
import tempfile
import unittest

from backend.services.asset_registry_service import AssetRegistryService


class AssetRegistryQueryServiceTest(unittest.TestCase):
    def test_get_asset_returns_sanitized_record_by_id(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            assets_file = os.path.join(tmpdir, "user", "assets.json")
            os.makedirs(os.path.dirname(assets_file), exist_ok=True)
            with open(assets_file, "w", encoding="utf-8") as file:
                json.dump(
                    {
                        "version": 1,
                        "assets": [
                            {
                                "assetId": "asset_image_1",
                                "type": "image",
                                "url": "https://cdn.example.com/image.png",
                                "localPath": "output/image.png",
                                "status": "ready",
                                "accessKey": "should-not-return",
                                "secretAccessKey": "should-not-return",
                                "Authorization": "AWS4-HMAC-SHA256 Signature=abc",
                                "storage": {
                                    "type": "s3-compatible",
                                    "bucket": "canvas-assets",
                                    "endpoint": "http://127.0.0.1:9000",
                                    "signature": "should-not-return",
                                },
                            }
                        ],
                    },
                    file,
                    ensure_ascii=False,
                )
            service = AssetRegistryService(assets_file_path=assets_file)

            asset = service.get_asset("asset_image_1")

            self.assertEqual(asset["assetId"], "asset_image_1")
            self.assertEqual(asset["url"], "https://cdn.example.com/image.png")
            serialized = json.dumps(asset, ensure_ascii=False)
            self.assertNotIn("accessKey", serialized)
            self.assertNotIn("secretAccessKey", serialized)
            self.assertNotIn("Authorization", serialized)
            self.assertNotIn("Signature", serialized)
            self.assertNotIn("signature", serialized)

    def test_get_assets_batch_returns_only_existing_sanitized_records(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            assets_file = os.path.join(tmpdir, "user", "assets.json")
            registry = AssetRegistryService(assets_file_path=assets_file)
            first = registry.create_ready_asset({"assetId": "asset_a", "type": "image", "url": "/output/a.png"})
            second = registry.create_ready_asset({"assetId": "asset_b", "type": "video", "url": "/output/b.mp4"})

            assets = registry.get_assets(["asset_b", "missing", "asset_a", "asset_b"])

            self.assertEqual([asset["assetId"] for asset in assets], ["asset_b", "asset_a"])
            self.assertEqual(assets[0]["url"], second["url"])
            self.assertEqual(assets[1]["url"], first["url"])


if __name__ == "__main__":
    unittest.main()