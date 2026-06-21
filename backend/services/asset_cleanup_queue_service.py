import json
import os
import re
import shutil
import tempfile
import time

from backend.services.asset_lifecycle_service import AssetLifecycleService
from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION, SENSITIVE_ASSET_KEYS, AssetRegistryService


QUEUE_SOURCE_STATUS = "deleted_candidate"
TERMINAL_DELETED_STATUS = "deleted"
ACTIVE_STATUS = "active"
QUEUE_REVIEW_PENDING = "pending"
QUEUE_REVIEW_DELETED = "deleted"
QUEUE_REVIEW_REJECTED = "rejected"
QUEUE_REVIEW_FAILED = "failed"


class AssetCleanupQueueService:
    def __init__(self, *, assets_file_path, canvas_dir_getter, lifecycle_service, local_root_dir=None, now_ms_getter=None):
        self.assets_file_path = os.path.abspath(assets_file_path)
        self._get_canvas_dir = canvas_dir_getter
        self.lifecycle_service = lifecycle_service
        self.local_root_dir = os.path.abspath(local_root_dir or os.getcwd())
        self._get_now_ms = now_ms_getter

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    @staticmethod
    def _safe_int(value):
        try:
            return int(value or 0)
        except Exception:
            return 0

    def _now_ms(self):
        if self._get_now_ms:
            try:
                return int(self._get_now_ms())
            except Exception:
                pass
        return int(time.time() * 1000)

    @staticmethod
    def _sanitize_text(value):
        text = str(value or "")
        text = re.sub(r"Authorization\s*[:=][^\n\r]*", "Authorization=***", text, flags=re.I)
        text = re.sub(r"AWS4-HMAC-SHA256[^\n\r]*", "AWS4-HMAC-SHA256 ***", text, flags=re.I)
        text = re.sub(r"Signature\s*=\s*[^\s,;\u0026]+", "Signature=***", text, flags=re.I)
        text = re.sub(r"Credential\s*=\s*[^\s,;\u0026]+", "Credential=***", text, flags=re.I)
        text = re.sub(
            r"(accessKeyId|accessKey|secretAccessKey|secretKey|apiKey|token|password)\s*[:=]\s*[^\s,;\u0026]+",
            r"\1=***",
            text,
            flags=re.I,
        )
        return text

    @classmethod
    def _sanitize(cls, value):
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                key_text = str(key or "")
                if key_text in SENSITIVE_ASSET_KEYS or key_text.lower() in SENSITIVE_ASSET_KEYS:
                    continue
                result[key_text] = cls._sanitize(item)
            return result
        if isinstance(value, list):
            return [cls._sanitize(item) for item in value]
        if isinstance(value, str):
            return cls._sanitize_text(value)
        if isinstance(value, (int, float, bool)) or value is None:
            return value
        return ""

    def _load_registry(self):
        registry = AssetRegistryService(assets_file_path=self.assets_file_path)._load()
        if not isinstance(registry.get("assets"), list):
            registry["assets"] = []
        registry["version"] = ASSET_REGISTRY_VERSION
        return registry

    def _save_registry(self, registry):
        payload = registry if isinstance(registry, dict) else {}
        payload["version"] = ASSET_REGISTRY_VERSION
        payload["assets"] = [self._sanitize(asset) for asset in payload.get("assets", []) if isinstance(asset, dict)]
        AssetRegistryService(assets_file_path=self.assets_file_path)._save(payload)

    def _normalize_ids(self, asset_ids):
        ids = []
        seen = set()
        for value in asset_ids if isinstance(asset_ids, list) else []:
            asset_id = self._text(value)
            if not asset_id or asset_id in seen:
                continue
            ids.append(asset_id)
            seen.add(asset_id)
        return ids

    def _find_assets(self, assets):
        return {self._text(asset.get("assetId")): asset for asset in assets if isinstance(asset, dict) and self._text(asset.get("assetId"))}

    def _usage_count(self, asset):
        usage = asset.get("usage") if isinstance(asset, dict) and isinstance(asset.get("usage"), dict) else {}
        return self._safe_int(usage.get("usageCount"))

    def _cleanup_queue_state(self, asset):
        cleanup_queue = asset.get("cleanupQueue") if isinstance(asset.get("cleanupQueue"), dict) else {}
        queued_at = self._safe_int(cleanup_queue.get("queuedAt")) or self._safe_int(asset.get("candidateAt"))
        queue_reason = self._text(cleanup_queue.get("queueReason")) or self._text(asset.get("lifecycleReason"))
        review_status = self._text(cleanup_queue.get("reviewStatus")) or QUEUE_REVIEW_PENDING
        return {
            "queuedAt": queued_at,
            "queueReason": self._sanitize_text(queue_reason),
            "reviewStatus": review_status,
            "reviewedAt": self._safe_int(cleanup_queue.get("reviewedAt")),
            "reviewNote": self._sanitize_text(cleanup_queue.get("reviewNote")),
        }

    def _queue_item(self, asset):
        sanitized = self._sanitize(asset)
        storage = sanitized.get("storage") if isinstance(sanitized.get("storage"), dict) else {}
        usage = sanitized.get("usage") if isinstance(sanitized.get("usage"), dict) else {}
        return {
            "assetId": self._text(sanitized.get("assetId")),
            "type": self._text(sanitized.get("type")) or "file",
            "url": self._text(sanitized.get("url")),
            "objectKey": self._text(sanitized.get("objectKey")),
            "storage": {
                "type": self._text(storage.get("type")) or "local",
                "bucket": self._text(storage.get("bucket")),
            },
            "size": self._safe_int(sanitized.get("size")),
            "createdAt": self._safe_int(sanitized.get("createdAt")),
            "candidateAt": self._safe_int(sanitized.get("candidateAt")),
            "lifecycleReason": self._sanitize_text(sanitized.get("lifecycleReason")),
            "usage": {"usageCount": self._safe_int(usage.get("usageCount"))},
            "pinned": bool(sanitized.get("pinned") is True),
            "cleanupQueue": self._cleanup_queue_state(sanitized),
        }

    def _apply_filters(self, items, filters):
        source = filters if isinstance(filters, dict) else {}
        asset_type = self._text(source.get("type"))
        storage_type = self._text(source.get("storageType"))
        bucket = self._text(source.get("bucket"))
        result = []
        for item in items:
            if asset_type and item.get("type") != asset_type:
                continue
            storage = item.get("storage") if isinstance(item.get("storage"), dict) else {}
            if storage_type and storage.get("type") != storage_type:
                continue
            if bucket and storage.get("bucket") != bucket:
                continue
            result.append(item)
        return result

    def _sort_items(self, items, sort_key):
        sort = self._text(sort_key) or "created_desc"
        if sort == "size_asc":
            return sorted(items, key=lambda item: (self._safe_int(item.get("size")), self._text(item.get("assetId"))))
        if sort == "created_asc":
            return sorted(items, key=lambda item: (self._safe_int(item.get("createdAt")), self._text(item.get("assetId"))))
        if sort == "created_desc":
            return sorted(items, key=lambda item: (-self._safe_int(item.get("createdAt")), self._text(item.get("assetId"))))
        return sorted(items, key=lambda item: (-self._safe_int(item.get("size")), self._text(item.get("assetId"))))

    def _summary(self, items):
        summary = {
            "totalCount": 0,
            "totalBytes": 0,
            "byType": {},
            "byStorage": {},
            "byBucket": {},
        }
        for item in items:
            size = self._safe_int(item.get("size"))
            item_type = self._text(item.get("type")) or "file"
            storage = item.get("storage") if isinstance(item.get("storage"), dict) else {}
            storage_type = self._text(storage.get("type")) or "local"
            bucket = self._text(storage.get("bucket")) or "local"
            summary["totalCount"] += 1
            summary["totalBytes"] += size
            for key, group in ((item_type, summary["byType"]), (storage_type, summary["byStorage"]), (bucket, summary["byBucket"])):
                if key not in group:
                    group[key] = {"count": 0, "bytes": 0}
                group[key]["count"] += 1
                group[key]["bytes"] += size
        return summary

    def _page(self, items, filters):
        page = max(1, self._safe_int((filters or {}).get("page")) or 1)
        page_size = self._safe_int((filters or {}).get("pageSize")) or 50
        page_size = max(1, min(500, page_size))
        start = (page - 1) * page_size
        return items[start : start + page_size], page, page_size

    def list_queue(self, filters=None):
        registry = self._load_registry()
        candidates = []
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            if self._text(asset.get("lifecycleStatus")) != QUEUE_SOURCE_STATUS:
                continue
            candidates.append(self._queue_item(asset))
        filtered = self._apply_filters(candidates, filters or {})
        sorted_items = self._sort_items(filtered, (filters or {}).get("sort"))
        page_items, page, page_size = self._page(sorted_items, filters or {})
        return {
            "success": True,
            "queue": page_items,
            "summary": self._summary(filtered),
            "page": page,
            "pageSize": page_size,
            "totalCount": len(filtered),
        }

    def _phase5_dry_run(self, asset_ids):
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_assets_file = os.path.join(tmpdir, "assets.json")
            if os.path.exists(self.assets_file_path):
                shutil.copyfile(self.assets_file_path, temp_assets_file)
            else:
                with open(temp_assets_file, "w", encoding="utf-8") as file:
                    json.dump({"version": ASSET_REGISTRY_VERSION, "assets": []}, file)
            temp_lifecycle = AssetLifecycleService(
                assets_file_path=temp_assets_file,
                canvas_dir_getter=self._get_canvas_dir,
                storage_bucket_service=getattr(self.lifecycle_service, "storage_bucket_service", None),
                local_root_dir=getattr(self.lifecycle_service, "local_root_dir", self.local_root_dir),
            )
            return temp_lifecycle.delete_assets(asset_ids, dry_run=True)

    def _block_reason(self, asset, phase5_result):
        if asset is None:
            return "asset_not_found"
        status = self._text(asset.get("lifecycleStatus"))
        if status == TERMINAL_DELETED_STATUS:
            return "already_deleted"
        if bool(asset.get("pinned") is True):
            return "asset_pinned"
        if status == ACTIVE_STATUS or self._usage_count(asset) > 0:
            return "asset_in_use"
        if status != QUEUE_SOURCE_STATUS:
            return "not_cleanup_candidate"
        if isinstance(phase5_result, dict) and phase5_result.get("canDelete") is False:
            return self._text(phase5_result.get("reason")) or "invalid_status"
        return ""

    def dry_run(self, asset_ids):
        ids = self._normalize_ids(asset_ids)
        registry = self._load_registry()
        assets = [asset for asset in registry.get("assets", []) if isinstance(asset, dict)]
        asset_by_id = self._find_assets(assets)
        phase5 = self._phase5_dry_run(ids)
        phase5_by_id = {self._text(item.get("assetId")): item for item in phase5.get("results", []) if isinstance(item, dict)}
        results = []
        for asset_id in ids:
            asset = asset_by_id.get(asset_id)
            phase5_result = phase5_by_id.get(asset_id, {})
            reason = self._block_reason(asset, phase5_result)
            can_delete = not reason and bool(phase5_result.get("canDelete") is True)
            if not reason and not can_delete:
                reason = self._text(phase5_result.get("reason")) or "invalid_status"
            size = self._safe_int(asset.get("size")) if isinstance(asset, dict) else 0
            results.append(
                {
                    "assetId": asset_id,
                    "canDelete": can_delete,
                    "reason": reason or "orphan_asset",
                    "releasableBytes": size if can_delete else 0,
                }
            )
        return {"success": True, "dryRun": True, "results": results}

    def _set_cleanup_review(self, asset_id, review_status, *, note=""):
        registry = self._load_registry()
        assets = [asset for asset in registry.get("assets", []) if isinstance(asset, dict)]
        now = self._now_ms()
        for asset in assets:
            if self._text(asset.get("assetId")) != asset_id:
                continue
            cleanup_queue = asset.get("cleanupQueue") if isinstance(asset.get("cleanupQueue"), dict) else {}
            cleanup_queue.update(self._cleanup_queue_state(asset))
            cleanup_queue["reviewStatus"] = review_status
            cleanup_queue["reviewedAt"] = now
            if note:
                cleanup_queue["reviewNote"] = self._sanitize_text(note)
            asset["cleanupQueue"] = cleanup_queue
            break
        registry["assets"] = assets
        self._save_registry(registry)

    def _restore_pending_candidates(self, candidate_snapshots, excluded_ids=None):
        excluded = set(excluded_ids or [])
        snapshots = candidate_snapshots if isinstance(candidate_snapshots, dict) else {}
        if not snapshots:
            return
        registry = self._load_registry()
        assets = [asset for asset in registry.get("assets", []) if isinstance(asset, dict)]
        changed = False
        for asset in assets:
            asset_id = self._text(asset.get("assetId"))
            if asset_id in excluded or asset_id not in snapshots:
                continue
            if self._text(asset.get("lifecycleStatus")) != "orphan":
                continue
            snapshot = snapshots.get(asset_id) if isinstance(snapshots.get(asset_id), dict) else {}
            asset["lifecycleStatus"] = QUEUE_SOURCE_STATUS
            if isinstance(snapshot.get("usage"), dict):
                asset["usage"] = snapshot.get("usage")
            if "cleanupQueue" in snapshot:
                asset["cleanupQueue"] = snapshot.get("cleanupQueue")
            changed = True
        if changed:
            registry["assets"] = assets
            self._save_registry(registry)

    def delete(self, asset_ids, confirm=False):
        if confirm is not True:
            return {"success": False, "error": "confirm_required", "results": []}
        ids = self._normalize_ids(asset_ids)
        registry = self._load_registry()
        candidate_snapshots = {}
        for asset in registry.get("assets", []):
            if isinstance(asset, dict) and self._text(asset.get("lifecycleStatus")) == QUEUE_SOURCE_STATUS:
                candidate_snapshots[self._text(asset.get("assetId"))] = dict(asset)
        preflight = self.dry_run(ids)
        results = []
        deleted_ids = set()
        for item in preflight.get("results", []):
            asset_id = self._text(item.get("assetId"))
            if item.get("canDelete") is not True:
                results.append({"assetId": asset_id, "deleted": False, "reason": self._text(item.get("reason")), "releasableBytes": 0})
                continue
            delete_payload = self.lifecycle_service.delete_assets([asset_id], dry_run=False)
            delete_result = next(
                (entry for entry in delete_payload.get("results", []) if isinstance(entry, dict) and self._text(entry.get("assetId")) == asset_id),
                {},
            )
            deleted = bool(delete_result.get("deleted") is True)
            reason = self._text(delete_result.get("reason")) or "delete_failed"
            if deleted:
                deleted_ids.add(asset_id)
                self._restore_pending_candidates(candidate_snapshots, excluded_ids=deleted_ids)
                self._set_cleanup_review(asset_id, QUEUE_REVIEW_DELETED)
                results.append(
                    {
                        "assetId": asset_id,
                        "deleted": True,
                        "reason": reason,
                        "releasableBytes": self._safe_int(item.get("releasableBytes")),
                    }
                )
            else:
                self._restore_pending_candidates(candidate_snapshots, excluded_ids=deleted_ids)
                if reason == "delete_failed":
                    self._set_cleanup_review(asset_id, QUEUE_REVIEW_FAILED, note=delete_result.get("error") or reason)
                results.append({"assetId": asset_id, "deleted": False, "reason": reason, "releasableBytes": 0})
        return {"success": True, "confirm": True, "results": results}

    def reject(self, asset_ids, reason=""):
        ids = self._normalize_ids(asset_ids)
        registry = self._load_registry()
        assets = [asset for asset in registry.get("assets", []) if isinstance(asset, dict)]
        asset_by_id = self._find_assets(assets)
        now = self._now_ms()
        note = self._sanitize_text(reason)
        results = []
        changed = False
        for asset_id in ids:
            asset = asset_by_id.get(asset_id)
            if asset is None:
                results.append({"assetId": asset_id, "rejected": False, "reason": "asset_not_found"})
                continue
            if self._text(asset.get("lifecycleStatus")) != QUEUE_SOURCE_STATUS:
                results.append({"assetId": asset_id, "rejected": False, "reason": "invalid_status"})
                continue
            cleanup_queue = asset.get("cleanupQueue") if isinstance(asset.get("cleanupQueue"), dict) else {}
            cleanup_queue.update(self._cleanup_queue_state(asset))
            cleanup_queue["reviewStatus"] = QUEUE_REVIEW_REJECTED
            cleanup_queue["reviewedAt"] = now
            cleanup_queue["reviewNote"] = note
            asset["cleanupQueue"] = cleanup_queue
            asset["lifecycleStatus"] = "orphan"
            asset["lastLifecycleCheckedAt"] = now
            changed = True
            results.append({"assetId": asset_id, "rejected": True, "reason": "rejected"})
        if changed:
            registry["assets"] = assets
            self._save_registry(registry)
        return {"success": True, "results": results}