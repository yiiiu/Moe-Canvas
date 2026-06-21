from backend.services.storage_usage_service import StorageUsageService


VALID_OPERATIONS = frozenset(("upload", "save_output", "save_output_from_url", "generation_result"))
VALID_ASSET_TYPES = frozenset(("image", "video", "audio", "file"))


class StorageQuotaService:
    def __init__(self, *, assets_file_path, settings_file_getter):
        self.assets_file_path = assets_file_path
        self._get_settings_file = settings_file_getter

    @staticmethod
    def _safe_int(value):
        try:
            number = int(value)
        except Exception:
            return 0
        return number if number > 0 else 0

    @staticmethod
    def _safe_percent(value, default=80):
        try:
            number = int(value)
        except Exception:
            number = int(default)
        return max(1, min(100, number))

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    @classmethod
    def _normalize_operation(cls, value):
        operation = cls._text(value).lower()
        return operation if operation in VALID_OPERATIONS else ""

    @classmethod
    def _normalize_asset_type(cls, value):
        asset_type = cls._text(value).lower()
        return asset_type if asset_type in VALID_ASSET_TYPES else "file"

    @staticmethod
    def _projected_percent(projected_bytes, limit_bytes):
        if limit_bytes <= 0:
            return 0
        percent = round((int(projected_bytes or 0) / int(limit_bytes)) * 100, 2)
        return int(percent) if float(percent).is_integer() else percent

    def _usage_service(self):
        return StorageUsageService(
            assets_file_path=self.assets_file_path,
            settings_file_getter=self._get_settings_file,
        )

    def preflight(self, request):
        data = request if isinstance(request, dict) else {}
        usage_payload = self._usage_service().get_storage_usage()
        usage = usage_payload.get("usage") if isinstance(usage_payload.get("usage"), dict) else {}
        quota = usage_payload.get("quota") if isinstance(usage_payload.get("quota"), dict) else {}

        current_bytes = self._safe_int(usage.get("totalBytes"))
        incoming_bytes = self._safe_int(data.get("incomingBytes"))
        projected_bytes = current_bytes + incoming_bytes
        limit_bytes = self._safe_int(quota.get("limitBytes"))
        warning_percent = self._safe_percent(quota.get("warningPercent"), 80)
        projected_percent = self._projected_percent(projected_bytes, limit_bytes)
        quota_enabled = bool(quota.get("enabled"))
        block_when_exceeded = bool(quota.get("blockWhenExceeded"))

        allowed = True
        reason = "within_quota"
        error = ""

        if not quota_enabled:
            reason = "quota_disabled"
        elif incoming_bytes <= 0:
            reason = "unknown_size"
        elif limit_bytes > 0 and projected_bytes > limit_bytes and block_when_exceeded:
            allowed = False
            reason = "quota_exceeded"
            error = "storage_quota_exceeded"
        elif limit_bytes > 0 and projected_bytes > limit_bytes:
            reason = "quota_exceeded_warning"
        elif limit_bytes > 0 and projected_percent >= warning_percent:
            reason = "quota_warning"

        result = {
            "success": True,
            "allowed": allowed,
            "reason": reason,
            "operation": self._normalize_operation(data.get("operation")),
            "assetType": self._normalize_asset_type(data.get("assetType")),
            "currentBytes": current_bytes,
            "incomingBytes": incoming_bytes,
            "projectedBytes": projected_bytes,
            "projectedPercent": projected_percent,
            "limitBytes": limit_bytes,
            "warningPercent": warning_percent,
            "quota": {
                "enabled": quota_enabled,
                "limitBytes": limit_bytes if quota_enabled else 0,
                "warningPercent": warning_percent,
                "blockWhenExceeded": block_when_exceeded,
                "usedPercent": quota.get("usedPercent") if quota_enabled else 0,
                "isWarning": bool(quota.get("isWarning")) if quota_enabled else False,
                "isExceeded": bool(quota.get("isExceeded")) if quota_enabled else False,
            },
        }
        if error:
            result["error"] = error
        return result