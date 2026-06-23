import os
import re
import time

from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION, SENSITIVE_ASSET_KEYS, AssetRegistryService
from backend.services.asset_usage_index_service import AssetUsageIndexService


DELETABLE_LIFECYCLE_STATUSES = frozenset(("orphan", "deleted_candidate", "delete_failed"))
TERMINAL_DELETED_STATUS = "deleted"
ACTIVE_LIFECYCLE_STATUS = "active"


class AssetLifecycleService:
    def __init__(self, *, assets_file_path, canvas_dir_getter, storage_bucket_service=None, local_root_dir=None):
        self.assets_file_path = os.path.abspath(assets_file_path)
        self._get_canvas_dir = canvas_dir_getter
        self.storage_bucket_service = storage_bucket_service
        self.local_root_dir = os.path.abspath(local_root_dir or os.getcwd())

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
    def _usage_count(asset):
        usage = asset.get("usage") if isinstance(asset.get("usage"), dict) else {}
        return AssetLifecycleService._safe_int(usage.get("usageCount"))

    @staticmethod
    def _storage(asset):
        storage = asset.get("storage") if isinstance(asset.get("storage"), dict) else {}
        return storage if isinstance(storage, dict) else {}

    @staticmethod
    def _sanitize_error(error):
        message = str(error or "删除失败")
        message = re.sub(r"Authorization\s*[:=][^\n\r]*", "Authorization=***", message, flags=re.I)
        message = re.sub(r"AWS4-HMAC-SHA256[^\n\r]*", "AWS4-HMAC-SHA256 ***", message, flags=re.I)
        message = re.sub(r"Signature\s*=\s*[^\s,;]+", "Signature=***", message, flags=re.I)
        message = re.sub(r"Credential\s*=\s*[^\s,;]+", "Credential=***", message, flags=re.I)
        message = re.sub(r"(accessKeyId|accessKey|secretAccessKey|secretKey|apiKey|token|password)\s*[:=]\s*[^\s,;]+", r"\1=***", message, flags=re.I)
        return message

    def _load_registry(self):
        registry = AssetRegistryService(assets_file_path=self.assets_file_path)._load()
        if not isinstance(registry.get("assets"), list):
            registry["assets"] = []
        registry["version"] = ASSET_REGISTRY_VERSION
        return registry

    def _save_registry(self, registry):
        AssetRegistryService(assets_file_path=self.assets_file_path)._save(registry)

    def _sanitize_asset_for_persistence(self, value):
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                key_text = str(key or "")
                if key_text in SENSITIVE_ASSET_KEYS or key_text.lower() in SENSITIVE_ASSET_KEYS:
                    continue
                result[key_text] = self._sanitize_asset_for_persistence(item)
            return result
        if isinstance(value, list):
            return [self._sanitize_asset_for_persistence(item) for item in value]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return ""

    def _save_sanitized_registry(self, registry):
        payload = registry if isinstance(registry, dict) else {}
        payload["assets"] = [self._sanitize_asset_for_persistence(asset) for asset in payload.get("assets", []) if isinstance(asset, dict)]
        self._save_registry(payload)

    def _usage_service(self):
        return AssetUsageIndexService(assets_file_path=self.assets_file_path, canvas_dir_getter=self._get_canvas_dir)

    def _rebuild_usage_index(self):
        return self._usage_service().rebuild_usage_index()

    def _find_asset(self, assets, asset_id):
        target = self._text(asset_id)
        for asset in assets:
            if isinstance(asset, dict) and self._text(asset.get("assetId")) == target:
                return asset
        return None

    def _candidate_from_asset(self, asset):
        sanitized = AssetRegistryService._sanitize_mapping(asset)
        storage = sanitized.get("storage") if isinstance(sanitized.get("storage"), dict) else {}
        return {
            "assetId": self._text(sanitized.get("assetId")),
            "type": self._text(sanitized.get("type")),
            "url": self._text(sanitized.get("url")),
            "objectKey": self._text(sanitized.get("objectKey")),
            "storage": {
                "type": self._text(storage.get("type")),
                "bucket": self._text(storage.get("bucket")),
            },
            "size": self._safe_int(sanitized.get("size")),
            "createdAt": self._safe_int(sanitized.get("createdAt")),
            "lastUsedAt": self._safe_int(sanitized.get("lastUsedAt")),
            "lifecycleStatus": self._text(sanitized.get("lifecycleStatus")),
        }

    def list_cleanup_candidates(self):
        registry = self._load_registry()
        result = []
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            if self._text(asset.get("lifecycleStatus")) != "orphan":
                continue
            if self._usage_count(asset) != 0:
                continue
            result.append(self._candidate_from_asset(asset))
        return result

    def _check_deletable(self, asset):
        if asset is None:
            return False, "asset_not_found"
        status = self._text(asset.get("lifecycleStatus"))
        usage_count = self._usage_count(asset)
        if status == TERMINAL_DELETED_STATUS:
            return False, "already_deleted"
        if status == ACTIVE_LIFECYCLE_STATUS or usage_count > 0:
            return False, "asset_in_use"
        if status not in DELETABLE_LIFECYCLE_STATUSES:
            return False, "invalid_status"
        storage = self._storage(asset)
        storage_type = self._text(storage.get("type")) or "local"
        if storage_type == "s3-compatible" and not self._text(asset.get("objectKey")):
            return False, "invalid_status"
        if storage_type == "local" and not self._text(asset.get("localPath")):
            return False, "invalid_status"
        if storage_type not in ("local", "s3-compatible"):
            return False, "invalid_status"
        return True, "orphan_asset"

    def _safe_local_path(self, local_path):
        path = self._text(local_path)
        if not path:
            return ""
        normalized = path.replace("\\", "/")
        if normalized.startswith("/output/") or normalized.startswith("/data/") or normalized.startswith("/user/"):
            path = os.path.join(self.local_root_dir, normalized.lstrip("/").replace("/", os.sep))
        elif not os.path.isabs(path):
            path = os.path.join(self.local_root_dir, normalized.replace("/", os.sep))
        abs_path = os.path.abspath(path)
        root = self.local_root_dir
        if abs_path != root and not abs_path.startswith(root + os.sep):
            raise RuntimeError("本地文件路径超出允许范围")
        return abs_path

    def _delete_storage_object(self, asset):
        storage = self._storage(asset)
        storage_type = self._text(storage.get("type")) or "local"
        if storage_type == "s3-compatible":
            if not self.storage_bucket_service:
                raise RuntimeError("存储桶服务不可用")
            object_key = self._text(asset.get("objectKey"))
            bucket_name = self._text(storage.get("bucket"))
            if not self.storage_bucket_service.object_exists(object_key, bucket_name=bucket_name):
                return "object_already_missing"
            self.storage_bucket_service.delete_object(object_key, bucket_name=bucket_name)
            return "orphan_asset"
        if storage_type == "local":
            path = self._safe_local_path(asset.get("localPath"))
            if not path:
                raise RuntimeError("缺少 localPath")
            if os.path.exists(path):
                os.remove(path)
            return "orphan_asset"
        raise RuntimeError("不支持的 storage.type")

    def _result_base(self, asset_id, asset=None):
        payload = {"assetId": self._text(asset_id)}
        if isinstance(asset, dict):
            payload["lifecycleStatus"] = self._text(asset.get("lifecycleStatus"))
        return payload

    def _dry_run_result(self, asset_id, asset):
        can_delete, reason = self._check_deletable(asset)
        return {**self._result_base(asset_id, asset), "canDelete": can_delete, "reason": reason}

    def delete_assets(self, asset_ids, dry_run=True):
        ids = []
        seen = set()
        for value in asset_ids if isinstance(asset_ids, list) else []:
            asset_id = self._text(value)
            if not asset_id or asset_id in seen:
                continue
            ids.append(asset_id)
            seen.add(asset_id)
        self._rebuild_usage_index()
        registry = self._load_registry()
        assets = [asset for asset in registry.get("assets", []) if isinstance(asset, dict)]
        results = []
        now = self._now_ms()
        for asset_id in ids:
            asset = self._find_asset(assets, asset_id)
            if dry_run:
                results.append(self._dry_run_result(asset_id, asset))
                continue
            can_delete, reason = self._check_deletable(asset)
            if not can_delete:
                results.append({**self._result_base(asset_id, asset), "deleted": False, "reason": reason})
                continue
            asset["lifecycleStatus"] = "deleting"
            asset["lastLifecycleCheckedAt"] = now
            try:
                delete_reason = self._delete_storage_object(asset)
                deleted_at = self._now_ms()
                asset["lifecycleStatus"] = "deleted"
                asset["deletedAt"] = deleted_at
                asset["deleteMode"] = "manual"
                asset["deleteError"] = ""
                asset["lastLifecycleCheckedAt"] = deleted_at
                results.append({**self._result_base(asset_id, asset), "deleted": True, "reason": delete_reason or "orphan_asset"})
            except Exception as exc:
                sanitized_error = self._sanitize_error(exc)
                failed_at = self._now_ms()
                asset["lifecycleStatus"] = "delete_failed"
                asset["deleteError"] = sanitized_error
                asset["deleteMode"] = "manual"
                asset["lastLifecycleCheckedAt"] = failed_at
                results.append({**self._result_base(asset_id, asset), "deleted": False, "reason": "delete_failed", "error": sanitized_error})
        registry["assets"] = assets
        if not dry_run:
            self._save_sanitized_registry(registry)
        return {"success": True, "dryRun": bool(dry_run), "results": results}