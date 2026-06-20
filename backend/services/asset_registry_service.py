import json
import os
import time
import uuid


ASSET_REGISTRY_VERSION = 1
SENSITIVE_ASSET_KEYS = frozenset(
    (
        "accessKey",
        "accessKeyId",
        "secret",
        "secretKey",
        "secretAccessKey",
        "authorization",
        "Authorization",
        "token",
        "apiKey",
        "password",
        "signature",
        "credential",
    )
)


class AssetRegistryService:
    def __init__(self, *, assets_file_path):
        self.assets_file_path = os.path.abspath(assets_file_path)

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    @staticmethod
    def _now_ms():
        return int(time.time() * 1000)

    @staticmethod
    def _safe_int(value):
        try:
            return int(value or 0)
        except Exception:
            return 0

    @staticmethod
    def _sanitize_mapping(value):
        source = value if isinstance(value, dict) else {}
        result = {}
        for key, item in source.items():
            key_text = str(key or "")
            if key_text in SENSITIVE_ASSET_KEYS or key_text.lower() in SENSITIVE_ASSET_KEYS:
                continue
            if isinstance(item, dict):
                result[key_text] = AssetRegistryService._sanitize_mapping(item)
            elif isinstance(item, (str, int, float, bool)) or item is None:
                result[key_text] = item
        return result

    def _load(self):
        try:
            with open(self.assets_file_path, "r", encoding="utf-8-sig") as file:
                data = json.load(file)
        except Exception:
            data = {}
        if not isinstance(data, dict):
            data = {}
        if data.get("version") != ASSET_REGISTRY_VERSION:
            assets = data.get("assets") if isinstance(data.get("assets"), list) else []
            return {"version": ASSET_REGISTRY_VERSION, "assets": assets}
        if not isinstance(data.get("assets"), list):
            data["assets"] = []
        return data

    def _save(self, data):
        payload = data if isinstance(data, dict) else {}
        payload["version"] = ASSET_REGISTRY_VERSION
        if not isinstance(payload.get("assets"), list):
            payload["assets"] = []
        parent = os.path.dirname(self.assets_file_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = self.assets_file_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(tmp, self.assets_file_path)

    def create_ready_asset(self, payload):
        data = payload if isinstance(payload, dict) else {}
        now = self._now_ms()
        storage = data.get("storage") if isinstance(data.get("storage"), dict) else {}
        record = {
            "assetId": self._text(data.get("assetId")) or f"asset_{uuid.uuid4().hex}",
            "type": self._text(data.get("type")) or "file",
            "url": self._text(data.get("url")),
            "localPath": self._text(data.get("localPath")),
            "objectKey": self._text(data.get("objectKey")),
            "storage": {
                "type": self._text(storage.get("type")) or "local",
                "bucket": self._text(storage.get("bucket")),
                "endpoint": self._text(storage.get("endpoint")),
            },
            "runtimeTaskId": self._text(data.get("runtimeTaskId")),
            "nodeId": self._text(data.get("nodeId")),
            "canvasId": self._text(data.get("canvasId")),
            "provider": self._text(data.get("provider")),
            "mimeType": self._text(data.get("mimeType")),
            "size": self._safe_int(data.get("size")),
            "status": "ready",
            "createdAt": now,
            "updatedAt": now,
        }
        record = self._sanitize_mapping(record)
        registry = self._load()
        registry["assets"].append(record)
        self._save(registry)
        return record