import json
import os
import threading
import time
import uuid

from backend.services.asset_retention_policy_service import AssetRetentionPolicyService


DEFAULT_RETENTION_SCHEDULER = {
    "enabled": False,
    "intervalHours": 24,
    "runOnStartup": False,
    "markCandidates": True,
    "autoDelete": False,
    "maxAssetsPerRun": 500,
    "lastRunAt": 0,
    "nextRunAt": 0,
}
RUN_HISTORY_LIMIT = 100
HOUR_MS = 60 * 60 * 1000


class AssetRetentionSchedulerService:
    def __init__(self, *, retention_policy_service, settings_file_getter, runs_file_getter, now_ms_getter=None):
        self.retention_policy_service = retention_policy_service
        self._get_settings_file = settings_file_getter
        self._get_runs_file = runs_file_getter
        self._get_now_ms = now_ms_getter
        self._run_lock = threading.Lock()

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
            return int(default)
        return number

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

    @classmethod
    def _sanitize(cls, value):
        return AssetRetentionPolicyService._sanitize(value)

    @classmethod
    def _sanitize_text(cls, value):
        return AssetRetentionPolicyService._sanitize_text(value)

    def _settings_file(self):
        return os.path.abspath(self._get_settings_file())

    def _runs_file(self):
        return os.path.abspath(self._get_runs_file())

    def _load_settings(self):
        data = self._load_json(self._settings_file(), {})
        return data if isinstance(data, dict) else {}

    def _save_settings(self, settings):
        self._save_json(self._settings_file(), settings if isinstance(settings, dict) else {})

    def _load_runs(self):
        data = self._load_json(self._runs_file(), {})
        if not isinstance(data, dict):
            data = {}
        runs = data.get("runs") if isinstance(data.get("runs"), list) else []
        return {"version": 1, "runs": [self._sanitize(item) for item in runs if isinstance(item, dict)]}

    def _save_runs(self, payload):
        data = payload if isinstance(payload, dict) else {}
        runs = data.get("runs") if isinstance(data.get("runs"), list) else []
        self._save_json(self._runs_file(), {"version": 1, "runs": [self._sanitize(item) for item in runs[-RUN_HISTORY_LIMIT:]]})

    def normalize_scheduler(self, value=None):
        source = value if isinstance(value, dict) else {}
        scheduler = dict(DEFAULT_RETENTION_SCHEDULER)
        scheduler["enabled"] = bool(source.get("enabled", scheduler["enabled"]))
        scheduler["intervalHours"] = max(1, min(24 * 365, self._safe_int(source.get("intervalHours"), scheduler["intervalHours"])))
        scheduler["runOnStartup"] = bool(source.get("runOnStartup", scheduler["runOnStartup"]))
        scheduler["markCandidates"] = source.get("markCandidates", scheduler["markCandidates"]) is not False
        scheduler["autoDelete"] = False
        scheduler["maxAssetsPerRun"] = max(1, min(10000, self._safe_int(source.get("maxAssetsPerRun"), scheduler["maxAssetsPerRun"])))
        scheduler["lastRunAt"] = max(0, self._safe_int(source.get("lastRunAt"), scheduler["lastRunAt"]))
        scheduler["nextRunAt"] = max(0, self._safe_int(source.get("nextRunAt"), scheduler["nextRunAt"]))
        scheduler["autoDeleteStatus"] = "unsupported_auto_delete" if bool(source.get("autoDelete")) else "disabled"
        return self._sanitize(scheduler)

    def _warnings_for_scheduler_payload(self, payload):
        source = payload if isinstance(payload, dict) else {}
        if source.get("autoDelete") is True:
            return [{"code": "unsupported_auto_delete", "message": "autoDelete is not supported and was forced to false"}]
        return []

    def get_scheduler(self):
        settings = self._load_settings()
        return {
            "success": True,
            "scheduler": self.normalize_scheduler(settings.get("retentionScheduler")),
            "running": self._run_lock.locked(),
        }

    def update_scheduler(self, payload):
        source = payload if isinstance(payload, dict) else {}
        settings = self._load_settings()
        current = settings.get("retentionScheduler") if isinstance(settings.get("retentionScheduler"), dict) else {}
        merged = dict(current)
        for key in ("enabled", "intervalHours", "runOnStartup", "markCandidates", "maxAssetsPerRun"):
            if key in source:
                merged[key] = source.get(key)
        if "autoDelete" in source:
            merged["autoDelete"] = False
        scheduler = self.normalize_scheduler(merged)
        scheduler.pop("autoDeleteStatus", None)
        settings["retentionScheduler"] = scheduler
        self._save_settings(settings)
        return {
            "success": True,
            "scheduler": self.normalize_scheduler(scheduler),
            "running": self._run_lock.locked(),
            "warnings": self._warnings_for_scheduler_payload(source),
        }

    def _update_run_times(self, scheduler, now_ms):
        interval_hours = max(1, self._safe_int(scheduler.get("intervalHours"), DEFAULT_RETENTION_SCHEDULER["intervalHours"]))
        scheduler["lastRunAt"] = now_ms
        scheduler["nextRunAt"] = now_ms + interval_hours * HOUR_MS
        scheduler["autoDelete"] = False
        settings = self._load_settings()
        saved = self.normalize_scheduler(settings.get("retentionScheduler"))
        saved.update({
            "lastRunAt": scheduler["lastRunAt"],
            "nextRunAt": scheduler["nextRunAt"],
            "autoDelete": False,
        })
        saved.pop("autoDeleteStatus", None)
        settings["retentionScheduler"] = saved
        self._save_settings(settings)
        return self.normalize_scheduler(saved)

    def _append_run(self, run):
        history = self._load_runs()
        runs = history.get("runs") if isinstance(history.get("runs"), list) else []
        runs.append(self._sanitize(run))
        self._save_runs({"version": 1, "runs": runs})

    def get_runs(self, limit=20):
        history = self._load_runs()
        count = max(1, min(100, self._safe_int(limit, 20)))
        runs = history.get("runs") if isinstance(history.get("runs"), list) else []
        return {"success": True, "runs": self._sanitize(runs[-count:])}

    def _empty_run(self, *, mode, status="success", started_at=None, errors=None):
        now_ms = self._now_ms()
        started = started_at if started_at is not None else now_ms
        return {
            "runId": f"retention_scheduler_run_{uuid.uuid4().hex}",
            "startedAt": started,
            "finishedAt": now_ms,
            "status": status,
            "mode": mode if mode in ("scheduled", "manual", "startup") else "manual",
            "checkedAssets": 0,
            "candidateCount": 0,
            "markedCount": 0,
            "candidateBytes": 0,
            "skippedActive": 0,
            "skippedTooNew": 0,
            "skippedPinned": 0,
            "errors": [self._sanitize_text(item) for item in errors] if isinstance(errors, list) else [],
        }

    def _count_skipped(self, skipped, reason):
        return sum(1 for item in skipped if isinstance(item, dict) and item.get("reason") == reason)

    def _limit_evaluation(self, evaluation, max_assets):
        limited = dict(evaluation if isinstance(evaluation, dict) else {})
        candidates = limited.get("candidates") if isinstance(limited.get("candidates"), list) else []
        limited_candidates = candidates[:max_assets]
        limited["candidates"] = limited_candidates
        limited["candidateCount"] = len(limited_candidates)
        limited["reclaimableBytes"] = sum(self._safe_int(item.get("size"), 0) for item in limited_candidates if isinstance(item, dict))
        return self._sanitize(limited)

    def run_once(self, request=None):
        data = request if isinstance(request, dict) else {}
        mode = str(data.get("mode") or "manual").strip().lower()
        mode = mode if mode in ("scheduled", "manual", "startup") else "manual"
        dry_run = data.get("dryRun") is True
        if not self._run_lock.acquire(blocking=False):
            run = self._empty_run(mode=mode, status="skipped", errors=["already_running"])
            self._append_run(run)
            return {"success": True, "dryRun": dry_run, "run": run, "scheduler": self.get_scheduler()["scheduler"], "running": True}
        started_at = self._now_ms()
        try:
            scheduler = self.normalize_scheduler(self._load_settings().get("retentionScheduler"))
            max_assets = max(1, self._safe_int(scheduler.get("maxAssetsPerRun"), DEFAULT_RETENTION_SCHEDULER["maxAssetsPerRun"]))
            evaluation = self.retention_policy_service.evaluate({"dryRun": True})
            limited_evaluation = self._limit_evaluation(evaluation, max_assets)
            skipped = limited_evaluation.get("skipped") if isinstance(limited_evaluation.get("skipped"), list) else []
            marked = []
            if not dry_run and scheduler.get("markCandidates") is True:
                apply_result = self.retention_policy_service.apply({"maxAssetsPerRun": max_assets})
                marked = apply_result.get("marked") if isinstance(apply_result.get("marked"), list) else []
            run = self._empty_run(mode=mode, status="success", started_at=started_at)
            run.update({
                "finishedAt": self._now_ms(),
                "checkedAssets": len(limited_evaluation.get("candidates", [])) + len(skipped),
                "candidateCount": len(limited_evaluation.get("candidates", [])),
                "markedCount": len(marked),
                "candidateBytes": self._safe_int(limited_evaluation.get("reclaimableBytes"), 0),
                "skippedActive": self._count_skipped(skipped, "active_asset") + self._count_skipped(skipped, "asset_in_use"),
                "skippedTooNew": self._count_skipped(skipped, "asset_too_new"),
                "skippedPinned": self._count_skipped(skipped, "pinned_asset"),
                "errors": [],
            })
            updated_scheduler = self._update_run_times(scheduler, run["finishedAt"])
            self._append_run(run)
            return {
                "success": True,
                "dryRun": dry_run,
                "run": self._sanitize(run),
                "scheduler": updated_scheduler,
                "candidates": limited_evaluation.get("candidates", []),
                "marked": self._sanitize(marked),
                "running": False,
            }
        except Exception as exc:
            run = self._empty_run(mode=mode, status="failed", started_at=started_at, errors=[self._sanitize_text(exc)])
            self._append_run(run)
            return {"success": False, "dryRun": dry_run, "run": run, "scheduler": self.get_scheduler()["scheduler"], "running": False}
        finally:
            self._run_lock.release()

    def maybe_run_scheduled(self, mode="scheduled"):
        scheduler = self.normalize_scheduler(self._load_settings().get("retentionScheduler"))
        selected_mode = mode if mode in ("scheduled", "startup") else "scheduled"
        if not scheduler.get("enabled"):
            run = self._empty_run(mode=selected_mode, status="skipped", errors=["scheduler_disabled"])
            return {"success": True, "run": run, "scheduler": scheduler, "running": self._run_lock.locked()}
        now_ms = self._now_ms()
        should_run_on_startup = selected_mode == "startup" and scheduler.get("runOnStartup") is True
        should_run_on_due = now_ms >= self._safe_int(scheduler.get("nextRunAt"), 0)
        if not (should_run_on_startup or should_run_on_due):
            run = self._empty_run(mode=selected_mode, status="skipped", errors=["not_due"])
            return {"success": True, "run": run, "scheduler": scheduler, "running": self._run_lock.locked()}
        return self.run_once({"mode": selected_mode, "dryRun": False})

    def start_background_scheduler(self, *, stop_event=None, poll_interval_seconds=300):
        interval = max(60.0, float(poll_interval_seconds or 300))
        if stop_event is not None:
            interval = max(0.01, float(poll_interval_seconds or 0.01))
        stopper = stop_event or threading.Event()

        def worker():
            try:
                self.maybe_run_scheduled(mode="startup")
            except Exception:
                pass
            while not stopper.wait(interval):
                try:
                    self.maybe_run_scheduled(mode="scheduled")
                except Exception:
                    pass

        thread = threading.Thread(target=worker, daemon=True, name="RetentionScheduler")
        thread.start()
        return thread