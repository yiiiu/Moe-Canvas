import json
import os
import re
import time

from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION, SENSITIVE_ASSET_KEYS, AssetRegistryService


DEFAULT_RETENTION_POLICY = {
    "enabled": True,
    "orphanRetentionDays": 7,
    "tempRetentionHours": 24,
    "deleteCandidateOnly": True,
    "autoDelete": False,
    "minAssetAgeHours": 1,
    "excludePinned": True,
    "excludeRecentlyUsedHours": 24,
}
SKIPPED_LIFECYCLE_STATUSES = frozenset(("active", "deleted", "deleting", "delete_failed"))
CANDIDATE_REASON = "retention_orphan_expired"


class AssetRetentionPolicyService:
    def __init__(self, *, assets_file_path, settings_file_getter, canvas_dir_getter=None, now_ms_getter=None):
        self.assets_file_path = os.path.abspath(assets_file_path)
        self._get_settings_file = settings_file_getter
        self._get_canvas_dir = canvas_dir_getter
        self._get_now_ms = now_ms_getter

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    def _now_ms(self):
        if self._get_now_ms:
            try:
                return int(self._get_now_ms())
            except Exception:
                pass
        return int(time.time() * 1000)

    @staticmethod
    def _safe_int(value, default=0):
        try:
            number = int(value)
        except Exception:
            number = int(default)
        return number if number >= 0 else int(default)

    @staticmethod
    def _clamp_int(value, default, min_value, max_value):
        try:
            number = int(value)
        except Exception:
            number = int(default)
        return max(int(min_value), min(int(max_value), number))

    @staticmethod
    def _load_json(path, default=None):
        try:
            with open(path, "r", encoding="utf-8-sig") as file:
                return json.load(file)
        except Exception:
            return default

    @staticmethod
    def _save_json(path, payload):
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())
        os.replace(tmp, path)

    @staticmethod
    def _sanitize_text(value):
        text = str(value or "")
        text = re.sub(r"Authorization\s*[:=][^\n\r]*", "Authorization=***", text, flags=re.I)
        text = re.sub(r"AWS4-HMAC-SHA256[^\n\r]*", "AWS4-HMAC-SHA256 ***", text, flags=re.I)
        text = re.sub(r"Signature\s*=\s*[^\s,;&]+", "Signature=***", text, flags=re.I)
        text = re.sub(r"Credential\s*=\s*[^\s,;&]+", "Credential=***", text, flags=re.I)
        text = re.sub(r"(accessKeyId|accessKey|secretAccessKey|secretKey|apiKey|token|password)\s*[:=]\s*[^\s,;&]+", r"\1=***", text, flags=re.I)
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

    def _settings_file(self):
        return os.path.abspath(self._get_settings_file())

    def _load_settings(self):
        data = self._load_json(self._settings_file(), {})
        return data if isinstance(data, dict) else {}

    def _save_settings(self, settings):
        self._save_json(self._settings_file(), settings if isinstance(settings, dict) else {})

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

    def normalize_policy(self, value=None):
        source = value if isinstance(value, dict) else {}
        policy = dict(DEFAULT_RETENTION_POLICY)
        policy["enabled"] = bool(source.get("enabled", policy["enabled"]))
        policy["orphanRetentionDays"] = self._clamp_int(source.get("orphanRetentionDays"), policy["orphanRetentionDays"], 0, 3650)
        policy["tempRetentionHours"] = self._clamp_int(source.get("tempRetentionHours"), policy["tempRetentionHours"], 1, 24 * 365)
        policy["deleteCandidateOnly"] = True
        policy["autoDelete"] = False
        policy["minAssetAgeHours"] = self._clamp_int(source.get("minAssetAgeHours"), policy["minAssetAgeHours"], 0, 24 * 3650)
        policy["excludePinned"] = bool(source.get("excludePinned", policy["excludePinned"]))
        policy["excludeRecentlyUsedHours"] = self._clamp_int(source.get("excludeRecentlyUsedHours"), policy["excludeRecentlyUsedHours"], 0, 24 * 3650)
        policy["autoDeleteStatus"] = "unsupported_auto_delete" if bool(source.get("autoDelete")) else "disabled"
        return self._sanitize(policy)

    def get_policy(self):
        settings = self._load_settings()
        return {"success": True, "policy": self.normalize_policy(settings.get("assetRetentionPolicy"))}

    def update_policy(self, payload):
        settings = self._load_settings()
        settings["assetRetentionPolicy"] = self.normalize_policy(payload if isinstance(payload, dict) else {})
        self._save_settings(settings)
        return {"success": True, "policy": settings["assetRetentionPolicy"]}

    def _usage_count(self, asset):
        usage = asset.get("usage") if isinstance(asset.get("usage"), dict) else {}
        return self._safe_int(usage.get("usageCount"), 0)

    def _asset_size(self, asset):
        return self._safe_int(asset.get("size"), 0)

    def _asset_created_at(self, asset):
        return self._safe_int(asset.get("createdAt"), 0)

    def _orphan_since(self, asset):
        return self._safe_int(asset.get("orphanSince") or asset.get("lastScannedAt") or asset.get("updatedAt") or asset.get("createdAt"), 0)

    def _candidate_payload(self, asset, policy, now_ms):
        sanitized = self._sanitize(AssetRegistryService._sanitize_mapping(asset))
        storage = sanitized.get("storage") if isinstance(sanitized.get("storage"), dict) else {}
        return {
            "assetId": self._text(sanitized.get("assetId")),
            "type": self._text(sanitized.get("type")),
            "url": self._text(sanitized.get("url")),
            "storage": {
                "type": self._text(storage.get("type")),
                "bucket": self._text(storage.get("bucket")),
            },
            "size": self._asset_size(sanitized),
            "createdAt": self._asset_created_at(sanitized),
            "lastUsedAt": self._safe_int(sanitized.get("lastUsedAt"), 0),
            "lifecycleStatus": self._text(sanitized.get("lifecycleStatus")),
            "reason": CANDIDATE_REASON,
            "candidateAt": now_ms,
            "retentionPolicySnapshot": policy,
        }

    def _missing_reference_asset_ids(self, request):
        source = request if isinstance(request, dict) else {}
        values = source.get("missingAssetReferences") if isinstance(source.get("missingAssetReferences"), list) else []
        result = set()
        for item in values:
            if not isinstance(item, dict):
                continue
            asset_id = self._text(item.get("assetId"))
            if asset_id:
                result.add(asset_id)
        return result

    def _evaluate_asset(self, asset, policy, now_ms, missing_reference_ids):
        asset_id = self._text(asset.get("assetId"))
        status = self._text(asset.get("lifecycleStatus"))
        usage_count = self._usage_count(asset)
        created_at = self._asset_created_at(asset)
        if status == "active":
            return None, {"assetId": asset_id, "reason": "active_asset"}, None
        if usage_count > 0:
            return None, {"assetId": asset_id, "reason": "asset_in_use"}, None
        if status == "deleted":
            return None, {"assetId": asset_id, "reason": "already_deleted"}, None
        if status == "delete_failed":
            return None, {"assetId": asset_id, "reason": "delete_failed"}, None
        if status == "deleting":
            return None, {"assetId": asset_id, "reason": "deleting"}, None
        if status != "orphan":
            return None, {"assetId": asset_id, "reason": "not_orphan"}, None
        if asset_id in missing_reference_ids:
            return None, {"assetId": asset_id, "reason": "missing_reference_risk"}, None
        if policy.get("excludePinned") and asset.get("pinned") is True:
            return None, {"assetId": asset_id, "reason": "pinned_asset"}, None
        if created_at <= 0:
            warning = {"assetId": asset_id, "message": "createdAt missing; skipped retention evaluation"}
            return None, {"assetId": asset_id, "reason": "missing_created_at"}, warning
        min_age_ms = int(policy.get("minAssetAgeHours") or 0) * 60 * 60 * 1000
        if now_ms - created_at < min_age_ms:
            return None, {"assetId": asset_id, "reason": "asset_too_new"}, None
        orphan_retention_ms = int(policy.get("orphanRetentionDays") or 0) * 24 * 60 * 60 * 1000
        orphan_since = self._orphan_since(asset)
        if orphan_since <= 0 or now_ms - orphan_since < orphan_retention_ms:
            return None, {"assetId": asset_id, "reason": "orphan_retention_not_elapsed"}, None
        if int(policy.get("excludeRecentlyUsedHours") or 0) > 0:
            last_used_at = self._safe_int(asset.get("lastUsedAt"), 0)
            recent_ms = int(policy.get("excludeRecentlyUsedHours") or 0) * 60 * 60 * 1000
            if last_used_at > 0 and now_ms - last_used_at < recent_ms:
                return None, {"assetId": asset_id, "reason": "recently_used"}, None
        return self._candidate_payload(asset, policy, now_ms), None, None

    def evaluate(self, request=None):
        data = request if isinstance(request, dict) else {}
        policy = self.normalize_policy(data.get("policy") if isinstance(data.get("policy"), dict) else self._load_settings().get("assetRetentionPolicy"))
        now_ms = self._now_ms()
        registry = self._load_registry()
        candidates = []
        skipped = []
        warnings = []
        missing_reference_ids = self._missing_reference_asset_ids(data)
        if not policy.get("enabled"):
            return {
                "success": True,
                "dryRun": data.get("dryRun") is not False,
                "enabled": False,
                "policy": policy,
                "candidates": [],
                "skipped": [],
                "warnings": [],
                "reclaimableBytes": 0,
                "autoDeleteStatus": policy.get("autoDeleteStatus"),
            }
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            candidate, skipped_item, warning = self._evaluate_asset(asset, policy, now_ms, missing_reference_ids)
            if candidate:
                candidates.append(candidate)
            if skipped_item:
                skipped.append(skipped_item)
            if warning:
                warnings.append(warning)
        return {
            "success": True,
            "dryRun": data.get("dryRun") is not False,
            "enabled": True,
            "policy": policy,
            "candidates": candidates,
            "skipped": skipped,
            "warnings": warnings,
            "candidateCount": len(candidates),
            "reclaimableBytes": sum(self._asset_size(item) for item in candidates),
            "autoDeleteStatus": policy.get("autoDeleteStatus"),
        }

    def apply(self, request=None):
        data = request if isinstance(request, dict) else {}
        evaluation = self.evaluate(data)
        registry = self._load_registry()
        by_id = {self._text(asset.get("assetId")): asset for asset in registry.get("assets", []) if isinstance(asset, dict)}
        now_ms = self._now_ms()
        marked = []
        policy = evaluation.get("policy") if isinstance(evaluation.get("policy"), dict) else self.normalize_policy()
        for candidate in evaluation.get("candidates", []):
            asset_id = self._text(candidate.get("assetId"))
            asset = by_id.get(asset_id)
            if not asset:
                continue
            asset["pinned"] = asset.get("pinned") is True
            asset["lifecycleStatus"] = "deleted_candidate"
            asset["lifecycleReason"] = CANDIDATE_REASON
            asset["candidateAt"] = now_ms
            asset["retentionCheckedAt"] = now_ms
            asset["retentionPolicySnapshot"] = policy
            marked.append({"assetId": asset_id, "lifecycleStatus": "deleted_candidate", "reason": CANDIDATE_REASON})
        if marked:
            self._save_registry(registry)
        return {
            "success": True,
            "mode": "candidate_only",
            "autoDeleteStatus": policy.get("autoDeleteStatus"),
            "marked": marked,
            "candidates": evaluation.get("candidates", []),
            "skipped": evaluation.get("skipped", []),
            "warnings": evaluation.get("warnings", []),
            "reclaimableBytes": evaluation.get("reclaimableBytes", 0),
        }