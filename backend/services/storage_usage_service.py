import json
import os

from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION, AssetRegistryService


CURRENT_LIFECYCLE_STATUSES = frozenset(("active", "orphan", "deleted_candidate", "delete_failed"))
DELETED_LIFECYCLE_STATUS = "deleted"
ORPHAN_LIFECYCLE_STATUS = "orphan"
TYPE_BUCKETS = frozenset(("image", "video", "audio", "file"))
STORAGE_BUCKETS = frozenset(("local", "s3-compatible"))


class StorageUsageService:
    def __init__(self, *, assets_file_path, settings_file_getter):
        self.assets_file_path = os.path.abspath(assets_file_path)
        self._get_settings_file = settings_file_getter

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    @staticmethod
    def _safe_int(value):
        try:
            number = int(value)
        except Exception:
            return 0
        return number if number > 0 else 0

    @staticmethod
    def _load_json(path, default=None):
        try:
            with open(path, "r", encoding="utf-8-sig") as file:
                data = json.load(file)
        except Exception:
            return default
        return data if isinstance(data, dict) else default

    def _load_registry(self):
        registry = AssetRegistryService(assets_file_path=self.assets_file_path)._load()
        if not isinstance(registry.get("assets"), list):
            registry["assets"] = []
        registry["version"] = ASSET_REGISTRY_VERSION
        return registry

    def _load_settings(self):
        path = os.path.abspath(self._get_settings_file())
        return self._load_json(path, {}) or {}

    @classmethod
    def _asset_type(cls, asset):
        value = cls._text(asset.get("type")).lower()
        return value if value in TYPE_BUCKETS else "file"

    @classmethod
    def _storage(cls, asset):
        storage = asset.get("storage") if isinstance(asset.get("storage"), dict) else {}
        storage_type = cls._text(storage.get("type")).lower() or "local"
        if storage_type not in STORAGE_BUCKETS:
            storage_type = "local"
        return {
            "type": storage_type,
            "bucket": cls._text(storage.get("bucket")),
        }

    @classmethod
    def _lifecycle_status(cls, asset):
        status = cls._text(asset.get("lifecycleStatus"))
        if status:
            return status
        return "active" if cls._text(asset.get("status")) == "ready" else ""

    @classmethod
    def _is_missing_size(cls, asset):
        return "size" not in asset or asset.get("size") in (None, "")

    @staticmethod
    def _add_bytes(bucket, key, size):
        item = bucket.setdefault(key, {"bytes": 0, "assetCount": 0})
        item["bytes"] += size
        item["assetCount"] += 1

    @staticmethod
    def _references(asset):
        usage = asset.get("usage") if isinstance(asset.get("usage"), dict) else {}
        references = usage.get("references") if isinstance(usage.get("references"), list) else []
        return [item for item in references if isinstance(item, dict)]

    def _build_quota(self, total_bytes):
        settings = self._load_settings()
        quota_settings = settings.get("storageQuota") if isinstance(settings.get("storageQuota"), dict) else {}
        enabled = bool(quota_settings.get("enabled"))
        limit_bytes = self._safe_int(quota_settings.get("limitBytes"))
        warning_percent = self._safe_int(quota_settings.get("warningPercent")) or 80
        warning_percent = max(1, min(100, warning_percent))
        used_percent = 0
        if enabled and limit_bytes > 0:
            used_percent = round((int(total_bytes or 0) / limit_bytes) * 100, 2)
            if float(used_percent).is_integer():
                used_percent = int(used_percent)
        return {
            "enabled": enabled,
            "limitBytes": limit_bytes if enabled else 0,
            "usedPercent": used_percent,
            "warningPercent": warning_percent,
            "isWarning": enabled and limit_bytes > 0 and used_percent >= warning_percent,
            "isExceeded": enabled and limit_bytes > 0 and used_percent >= 100,
            "blockWhenExceeded": bool(quota_settings.get("blockWhenExceeded")),
        }

    def get_storage_usage(self):
        registry = self._load_registry()
        usage = {
            "totalBytes": 0,
            "activeBytes": 0,
            "orphanBytes": 0,
            "deletedBytes": 0,
            "assetCount": 0,
            "orphanCount": 0,
            "deletedCount": 0,
            "missingSizeCount": 0,
            "byType": {},
            "byStorage": {},
            "byBucket": [],
            "byProject": [],
        }
        by_bucket = {}
        by_project = {}

        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            lifecycle_status = self._lifecycle_status(asset)
            if lifecycle_status not in CURRENT_LIFECYCLE_STATUSES and lifecycle_status != DELETED_LIFECYCLE_STATUS:
                continue

            size = self._safe_int(asset.get("size"))
            if self._is_missing_size(asset):
                usage["missingSizeCount"] += 1

            if lifecycle_status == DELETED_LIFECYCLE_STATUS:
                usage["deletedBytes"] += size
                usage["deletedCount"] += 1
                continue

            usage["totalBytes"] += size
            usage["assetCount"] += 1
            if lifecycle_status == ORPHAN_LIFECYCLE_STATUS:
                usage["orphanBytes"] += size
                usage["orphanCount"] += 1
            elif lifecycle_status == "active":
                usage["activeBytes"] += size

            asset_type = self._asset_type(asset)
            storage = self._storage(asset)
            self._add_bytes(usage["byType"], asset_type, size)
            self._add_bytes(usage["byStorage"], storage["type"], size)
            if storage["type"] == "s3-compatible" and storage["bucket"]:
                bucket_key = (storage["type"], storage["bucket"])
                bucket_item = by_bucket.setdefault(
                    bucket_key,
                    {"bucket": storage["bucket"], "storageType": storage["type"], "bytes": 0, "assetCount": 0},
                )
                bucket_item["bytes"] += size
                bucket_item["assetCount"] += 1

            project_ids = set()
            for reference in self._references(asset):
                project_id = self._text(reference.get("projectId"))
                if project_id:
                    project_ids.add(project_id)
            for project_id in project_ids:
                project_item = by_project.setdefault(project_id, {"projectId": project_id, "bytes": 0, "assetCount": 0})
                project_item["bytes"] += size
                project_item["assetCount"] += 1

        usage["byBucket"] = sorted(by_bucket.values(), key=lambda item: (item["storageType"], item["bucket"]))
        usage["byProject"] = sorted(by_project.values(), key=lambda item: item["projectId"])
        return {
            "success": True,
            "usage": usage,
            "quota": self._build_quota(usage["totalBytes"]),
        }