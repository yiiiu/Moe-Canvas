import json
import os
import time

from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION, AssetRegistryService


class AssetUsageIndexService:
    def __init__(self, *, assets_file_path, canvas_dir_getter):
        self.assets_file_path = os.path.abspath(assets_file_path)
        self._get_canvas_dir = canvas_dir_getter

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    @staticmethod
    def _now_ms():
        return int(time.time() * 1000)

    @staticmethod
    def _load_json(path, default=None):
        try:
            with open(path, "r", encoding="utf-8-sig") as file:
                return json.load(file)
        except Exception:
            return default

    @staticmethod
    def _safe_project_id(filename):
        name = os.path.basename(str(filename or ""))
        return name[:-5] if name.endswith(".json") else name

    @staticmethod
    def _normalize_nodes(nodes):
        if isinstance(nodes, list):
            return [node for node in nodes if isinstance(node, dict)]
        if isinstance(nodes, dict):
            return [node for node in nodes.values() if isinstance(node, dict)]
        return []

    @classmethod
    def _project_canvases(cls, project):
        if not isinstance(project, dict):
            return []
        canvases = project.get("canvases")
        if isinstance(canvases, list):
            return [canvas for canvas in canvases if isinstance(canvas, dict)]
        return [
            {
                "id": cls._text(project.get("activeCanvasId")) or "",
                "nodes": project.get("nodes"),
            }
        ]

    @classmethod
    def _node_asset_id(cls, node):
        if not isinstance(node, dict):
            return ""
        asset_id = cls._text(node.get("assetId"))
        if asset_id:
            return asset_id
        data = node.get("data") if isinstance(node.get("data"), dict) else None
        return cls._text(data.get("assetId")) if data else ""

    def _load_registry(self):
        registry = AssetRegistryService(assets_file_path=self.assets_file_path)._load()
        if not isinstance(registry.get("assets"), list):
            registry["assets"] = []
        registry["version"] = ASSET_REGISTRY_VERSION
        return registry

    def _save_registry(self, registry):
        AssetRegistryService(assets_file_path=self.assets_file_path)._save(registry)

    def _scan_project_files(self):
        canvas_dir = os.path.abspath(self._get_canvas_dir())
        if not os.path.isdir(canvas_dir):
            return [], []
        projects = []
        warnings = []
        for filename in sorted(os.listdir(canvas_dir)):
            if not filename.endswith(".json"):
                continue
            path = os.path.join(canvas_dir, filename)
            data = self._load_json(path)
            if not isinstance(data, dict):
                warnings.append({"projectFile": filename, "message": "Invalid project JSON"})
                continue
            projects.append((filename, data))
        return projects, warnings

    def _safe_usage(self, asset):
        usage = asset.get("usage") if isinstance(asset, dict) and isinstance(asset.get("usage"), dict) else {}
        references = []
        for item in usage.get("references") if isinstance(usage.get("references"), list) else []:
            if not isinstance(item, dict):
                continue
            references.append(
                {
                    "projectId": self._text(item.get("projectId")),
                    "canvasId": self._text(item.get("canvasId")),
                    "nodeId": self._text(item.get("nodeId")),
                    "nodeType": self._text(item.get("nodeType")),
                }
            )
        return {
            "usageCount": int(usage.get("usageCount") or len(references)),
            "lastUsedAt": int(usage.get("lastUsedAt") or 0),
            "references": references,
        }

    def rebuild_usage_index(self):
        registry = self._load_registry()
        assets = [asset for asset in registry.get("assets", []) if isinstance(asset, dict)]
        asset_by_id = {}
        for asset in assets:
            if self._text(asset.get("lifecycleStatus")) == "deleted":
                continue
            asset_id = self._text(asset.get("assetId"))
            if asset_id and asset_id not in asset_by_id:
                asset_by_id[asset_id] = asset

        references_by_asset_id = {}
        missing = []
        missing_seen = set()
        scanned_nodes = 0
        projects, warnings = self._scan_project_files()
        for filename, project in projects:
            project_id = self._text(project.get("id")) or self._safe_project_id(filename)
            for canvas in self._project_canvases(project):
                canvas_id = self._text(canvas.get("id"))
                for node in self._normalize_nodes(canvas.get("nodes")):
                    scanned_nodes += 1
                    asset_id = self._node_asset_id(node)
                    if not asset_id:
                        continue
                    reference = {
                        "projectId": project_id,
                        "canvasId": canvas_id,
                        "nodeId": self._text(node.get("id")),
                        "nodeType": self._text(node.get("type")),
                    }
                    if asset_id in asset_by_id:
                        references_by_asset_id.setdefault(asset_id, []).append(reference)
                    else:
                        missing_key = (
                            asset_id,
                            reference["projectId"],
                            reference["canvasId"],
                            reference["nodeId"],
                        )
                        if missing_key not in missing_seen:
                            missing_seen.add(missing_key)
                            missing.append({"assetId": asset_id, **reference})

        now = self._now_ms()
        used_assets = 0
        orphan_assets = 0
        for asset in assets:
            asset_id = self._text(asset.get("assetId"))
            is_deleted = self._text(asset.get("lifecycleStatus")) == "deleted"
            references = [] if is_deleted else references_by_asset_id.get(asset_id, [])
            usage_count = len(references)
            last_used_at = now if usage_count else int(asset.get("lastUsedAt") or 0)
            asset["usage"] = {
                "usageCount": usage_count,
                "lastUsedAt": last_used_at,
                "references": references,
            }
            asset["lastScannedAt"] = now
            asset["lastUsedAt"] = last_used_at
            if is_deleted:
                continue
            if usage_count:
                asset["lifecycleStatus"] = "active"
                used_assets += 1
            else:
                asset["lifecycleStatus"] = "orphan"
                orphan_assets += 1
        registry["assets"] = assets
        self._save_registry(registry)
        return {
            "success": True,
            "scannedProjects": len(projects),
            "scannedNodes": scanned_nodes,
            "usedAssets": used_assets,
            "orphanAssets": orphan_assets,
            "missingAssetReferences": missing,
            "warnings": warnings,
        }

    def get_usage(self, asset_id):
        target = self._text(asset_id)
        if not target:
            return None
        registry = self._load_registry()
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            if self._text(asset.get("assetId")) != target:
                continue
            sanitized = AssetRegistryService._sanitize_mapping(asset)
            usage = self._safe_usage(asset)
            return {
                "assetId": sanitized.get("assetId", ""),
                "type": sanitized.get("type", ""),
                "url": sanitized.get("url", ""),
                "usage": usage,
                "usageCount": int(usage.get("usageCount") or 0),
                "lastUsedAt": int(sanitized.get("lastUsedAt") or usage.get("lastUsedAt") or 0),
                "lifecycleStatus": sanitized.get("lifecycleStatus", ""),
                "lastScannedAt": int(sanitized.get("lastScannedAt") or 0),
            }
        return None

    def list_orphans(self):
        registry = self._load_registry()
        result = []
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            sanitized = AssetRegistryService._sanitize_mapping(asset)
            usage = self._safe_usage(asset)
            usage_count = int(usage.get("usageCount") or 0)
            if sanitized.get("lifecycleStatus") != "orphan" and usage_count != 0:
                continue
            storage = sanitized.get("storage") if isinstance(sanitized.get("storage"), dict) else {}
            result.append(
                {
                    "assetId": sanitized.get("assetId", ""),
                    "type": sanitized.get("type", ""),
                    "url": sanitized.get("url", ""),
                    "storage": {"type": self._text(storage.get("type"))},
                    "size": int(sanitized.get("size") or 0),
                    "createdAt": int(sanitized.get("createdAt") or 0),
                    "lastUsedAt": int(sanitized.get("lastUsedAt") or usage.get("lastUsedAt") or 0),
                    "lifecycleStatus": sanitized.get("lifecycleStatus") or "orphan",
                }
            )
        return result