import json
import os
import re
import threading
import time

from backend.services.asset_registry_service import ASSET_REGISTRY_VERSION, SENSITIVE_ASSET_KEYS, AssetRegistryService


JOB_STORE_VERSION = 1
DEFAULT_MAX_JOBS = 200
DEFAULT_HEARTBEAT_TIMEOUT_MS = 30 * 60 * 1000
TERMINAL_STATUSES = frozenset(("success", "partial_failed", "failed", "canceled"))
RUNNING_STATUSES = frozenset(("pending", "running"))
QUEUE_SOURCE_STATUS = "deleted_candidate"


class AssetCleanupExecutorService:
    def __init__(
        self,
        *,
        jobs_file_path,
        assets_file_path,
        canvas_dir_getter,
        lifecycle_service,
        cleanup_queue_service,
        local_root_dir=None,
        now_ms_getter=None,
        auto_start_worker=True,
        max_jobs=DEFAULT_MAX_JOBS,
        heartbeat_timeout_ms=DEFAULT_HEARTBEAT_TIMEOUT_MS,
    ):
        self.jobs_file_path = os.path.abspath(jobs_file_path)
        self.assets_file_path = os.path.abspath(assets_file_path)
        self._get_canvas_dir = canvas_dir_getter
        self.lifecycle_service = lifecycle_service
        self.cleanup_queue_service = cleanup_queue_service
        self.local_root_dir = os.path.abspath(local_root_dir or os.getcwd())
        self._get_now_ms = now_ms_getter
        self.max_jobs = max(1, int(max_jobs or DEFAULT_MAX_JOBS))
        self.heartbeat_timeout_ms = max(1, int(heartbeat_timeout_ms or DEFAULT_HEARTBEAT_TIMEOUT_MS))
        self._lock = threading.RLock()
        self._worker_event = threading.Event()
        self._worker_started = False
        self._stop_worker = False
        self.mark_stale_jobs()
        if auto_start_worker:
            self.start_worker()

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

    def _load_jobs_unlocked(self):
        if not os.path.exists(self.jobs_file_path):
            return {"version": JOB_STORE_VERSION, "jobs": []}
        try:
            with open(self.jobs_file_path, "r", encoding="utf-8-sig") as file:
                payload = json.load(file)
        except Exception:
            payload = {}
        jobs = payload.get("jobs") if isinstance(payload, dict) else []
        return {"version": JOB_STORE_VERSION, "jobs": [job for job in jobs if isinstance(job, dict)]}

    def _save_jobs_unlocked(self, payload):
        jobs = [self._sanitize(job) for job in (payload or {}).get("jobs", []) if isinstance(job, dict)]
        jobs = sorted(jobs, key=lambda job: (self._safe_int(job.get("createdAt")), self._text(job.get("cleanupJobId"))))
        if len(jobs) > self.max_jobs:
            jobs = jobs[-self.max_jobs :]
        data = {"version": JOB_STORE_VERSION, "jobs": jobs}
        os.makedirs(os.path.dirname(self.jobs_file_path), exist_ok=True)
        tmp_path = f"{self.jobs_file_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.jobs_file_path)

    def _load_assets(self):
        registry = AssetRegistryService(assets_file_path=self.assets_file_path)._load()
        if not isinstance(registry.get("assets"), list):
            registry["assets"] = []
        registry["version"] = ASSET_REGISTRY_VERSION
        return registry

    def _save_assets(self, registry):
        AssetRegistryService(assets_file_path=self.assets_file_path)._save(registry)

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

    def _new_job_id(self):
        return f"cleanup_job_{self._now_ms()}_{os.getpid()}"

    def _empty_result(self, asset_id):
        return {
            "assetId": asset_id,
            "status": "pending",
            "reason": "pending",
            "releasedBytes": 0,
            "error": "",
            "startedAt": 0,
            "finishedAt": 0,
            "attempts": [],
            "previousErrors": [],
        }

    def _recount_job(self, job):
        results = [item for item in job.get("results", []) if isinstance(item, dict)]
        total = self._safe_int(job.get("totalCount")) or len(results)
        processed = len([item for item in results if self._text(item.get("status")) in ("success", "failed", "skipped")])
        success = len([item for item in results if self._text(item.get("status")) == "success"])
        failed = len([item for item in results if self._text(item.get("status")) == "failed"])
        skipped = len([item for item in results if self._text(item.get("status")) == "skipped"])
        job["totalCount"] = total
        job["processedCount"] = processed
        job["successCount"] = success
        job["failedCount"] = failed
        job["skippedCount"] = skipped
        job["releasedBytes"] = sum(self._safe_int(item.get("releasedBytes")) for item in results if self._text(item.get("status")) == "success")
        job["progressPercent"] = 100 if total <= 0 else int(round((processed / total) * 100))
        return job

    def _final_status(self, job):
        self._recount_job(job)
        if job.get("cancelRequested") is True or any(
            self._text(item.get("reason")) == "canceled" for item in job.get("results", []) if isinstance(item, dict)
        ):
            return "canceled"
        if job.get("successCount") == job.get("totalCount"):
            return "success"
        if job.get("successCount") > 0 or (job.get("failedCount") > 0 and job.get("skippedCount") > 0):
            return "partial_failed"
        return "failed"

    def _find_job(self, jobs, job_id):
        target = self._text(job_id)
        for job in jobs:
            if self._text(job.get("cleanupJobId")) == target:
                return job
        return None

    def _locked_asset_ids(self, jobs, excluding_job_id=""):
        locked = set()
        excluded = self._text(excluding_job_id)
        for job in jobs:
            if self._text(job.get("cleanupJobId")) == excluded:
                continue
            if self._text(job.get("status")) not in RUNNING_STATUSES:
                continue
            for result in job.get("results", []):
                if not isinstance(result, dict):
                    continue
                if self._text(result.get("status")) == "pending":
                    locked.add(self._text(result.get("assetId")))
        return locked

    def create_job(self, asset_ids, confirm=False):
        if confirm is not True:
            return {"success": False, "error": "confirm_required"}
        ids = self._normalize_ids(asset_ids)
        now = self._now_ms()
        with self._lock:
            payload = self._load_jobs_unlocked()
            locked = self._locked_asset_ids(payload.get("jobs", []))
            results = []
            for asset_id in ids:
                item = self._empty_result(asset_id)
                if asset_id in locked:
                    item.update({"status": "skipped", "reason": "asset_locked", "finishedAt": now})
                results.append(item)
            job = {
                "cleanupJobId": self._new_job_id(),
                "status": "pending",
                "assetIds": ids,
                "totalCount": len(ids),
                "processedCount": 0,
                "successCount": 0,
                "failedCount": 0,
                "skippedCount": 0,
                "releasedBytes": 0,
                "currentAssetId": "",
                "progressPercent": 0,
                "createdAt": now,
                "updatedAt": now,
                "startedAt": 0,
                "finishedAt": 0,
                "lastHeartbeatAt": now,
                "cancelRequested": False,
                "reason": "",
                "results": results,
                "retryResults": [],
            }
            self._recount_job(job)
            payload["jobs"].append(job)
            self._save_jobs_unlocked(payload)
        self._worker_event.set()
        return {"success": True, "cleanupJobId": job["cleanupJobId"], "status": job["status"], "job": self._sanitize(job)}

    def get_job(self, job_id):
        with self._lock:
            payload = self._load_jobs_unlocked()
            job = self._find_job(payload.get("jobs", []), job_id)
            if not job:
                return {"success": False, "error": "job_not_found"}
            return {"success": True, "job": self._sanitize(job)}

    def list_jobs(self, limit=20):
        safe_limit = max(1, min(100, self._safe_int(limit) or 20))
        with self._lock:
            payload = self._load_jobs_unlocked()
            jobs = sorted(payload.get("jobs", []), key=lambda job: (self._safe_int(job.get("createdAt")), self._text(job.get("cleanupJobId"))), reverse=True)
            return {"success": True, "jobs": self._sanitize(jobs[:safe_limit])}

    def start_worker(self):
        with self._lock:
            if self._worker_started:
                return
            self._worker_started = True
        thread = threading.Thread(target=self._worker_loop, daemon=True)
        thread.start()

    def _worker_loop(self):
        while not self._stop_worker:
            self._worker_event.wait(1)
            self._worker_event.clear()
            self.run_pending_jobs_once()

    def run_pending_jobs_once(self, max_items=None):
        processed = 0
        while True:
            with self._lock:
                payload = self._load_jobs_unlocked()
                job = next((item for item in payload.get("jobs", []) if self._text(item.get("status")) in RUNNING_STATUSES), None)
                if not job:
                    self._save_jobs_unlocked(payload)
                    return processed
                if self._text(job.get("status")) == "pending":
                    now = self._now_ms()
                    job["status"] = "running"
                    job["startedAt"] = job.get("startedAt") or now
                    job["updatedAt"] = now
                    job["lastHeartbeatAt"] = now
                    self._save_jobs_unlocked(payload)
                job_id = self._text(job.get("cleanupJobId"))
            item_processed = self._run_one_item(job_id)
            if item_processed:
                processed += 1
            with self._lock:
                payload = self._load_jobs_unlocked()
                job = self._find_job(payload.get("jobs", []), job_id)
                if job and self._job_has_no_pending_items(job):
                    now = self._now_ms()
                    job["status"] = self._final_status(job)
                    job["currentAssetId"] = ""
                    job["finishedAt"] = now
                    job["updatedAt"] = now
                    job["lastHeartbeatAt"] = now
                    self._save_jobs_unlocked(payload)
            if max_items is not None and processed >= max_items:
                return processed

    def _job_has_no_pending_items(self, job):
        return not any(self._text(item.get("status")) == "pending" for item in job.get("results", []) if isinstance(item, dict))

    def _run_one_item(self, job_id):
        with self._lock:
            payload = self._load_jobs_unlocked()
            job = self._find_job(payload.get("jobs", []), job_id)
            if not job or self._text(job.get("status")) not in RUNNING_STATUSES:
                return False
            now = self._now_ms()
            if job.get("cancelRequested") is True:
                for item in job.get("results", []):
                    if isinstance(item, dict) and self._text(item.get("status")) == "pending":
                        item.update({"status": "skipped", "reason": "canceled", "finishedAt": now})
                job["updatedAt"] = now
                job["lastHeartbeatAt"] = now
                self._recount_job(job)
                self._save_jobs_unlocked(payload)
                return False
            result = next((item for item in job.get("results", []) if isinstance(item, dict) and self._text(item.get("status")) == "pending"), None)
            if not result:
                return False
            asset_id = self._text(result.get("assetId"))
            result["status"] = "running"
            result["reason"] = "running"
            result["startedAt"] = now
            job["currentAssetId"] = asset_id
            job["status"] = "running"
            job["updatedAt"] = now
            job["lastHeartbeatAt"] = now
            self._save_jobs_unlocked(payload)
        completed = self._execute_asset(job_id, asset_id)
        with self._lock:
            payload = self._load_jobs_unlocked()
            job = self._find_job(payload.get("jobs", []), job_id)
            if job:
                for index, item in enumerate(job.get("results", [])):
                    if isinstance(item, dict) and self._text(item.get("assetId")) == asset_id:
                        job["results"][index] = completed
                        break
                now = self._now_ms()
                job["currentAssetId"] = ""
                job["updatedAt"] = now
                job["lastHeartbeatAt"] = now
                self._recount_job(job)
                self._save_jobs_unlocked(payload)
        return True

    def _cleanup_candidate_ids(self):
        registry = self._load_assets()
        candidate_ids = set()
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            asset_id = self._text(asset.get("assetId"))
            if not asset_id:
                continue
            if self._text(asset.get("lifecycleStatus")) == QUEUE_SOURCE_STATUS:
                candidate_ids.add(asset_id)
        return candidate_ids

    def _restore_job_candidates(self, job_id, processed_ids=None, candidate_ids=None):
        processed = set(processed_ids or [])
        if candidate_ids is None:
            with self._lock:
                payload = self._load_jobs_unlocked()
                job = self._find_job(payload.get("jobs", []), job_id)
                restore_ids = set(job.get("assetIds", [])) if isinstance(job, dict) else set()
        else:
            restore_ids = set(candidate_ids or [])
        registry = self._load_assets()
        changed = False
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict):
                continue
            asset_id = self._text(asset.get("assetId"))
            if asset_id in processed or asset_id not in restore_ids:
                continue
            if self._text(asset.get("lifecycleStatus")) != "orphan":
                continue
            if self._safe_int((asset.get("usage") if isinstance(asset.get("usage"), dict) else {}).get("usageCount")) != 0:
                continue
            asset["lifecycleStatus"] = QUEUE_SOURCE_STATUS
            changed = True
        if changed:
            self._save_assets(registry)

    def _preflight_asset(self, asset_id, previous_result=None):
        preflight = self.cleanup_queue_service.dry_run([asset_id])
        dry = next((item for item in preflight.get("results", []) if isinstance(item, dict) and self._text(item.get("assetId")) == asset_id), {})
        if dry.get("canDelete") is True:
            return dry
        if isinstance(previous_result, dict):
            registry = self._load_assets()
            for asset in registry.get("assets", []):
                if not isinstance(asset, dict) or self._text(asset.get("assetId")) != asset_id:
                    continue
                if self._text(asset.get("lifecycleStatus")) == "delete_failed":
                    return {"assetId": asset_id, "canDelete": True, "reason": "retry_delete_failed", "releasableBytes": self._safe_int(asset.get("size"))}
        return dry

    def _execute_asset(self, job_id, asset_id, previous_result=None):
        started_at = self._now_ms()
        result = previous_result if isinstance(previous_result, dict) else self._empty_result(asset_id)
        previous_errors = list(result.get("previousErrors", [])) if isinstance(result.get("previousErrors"), list) else []
        attempts = list(result.get("attempts", [])) if isinstance(result.get("attempts"), list) else []
        result.update({"assetId": asset_id, "status": "failed", "reason": "delete_failed", "releasedBytes": 0, "error": "", "startedAt": started_at})
        dry = self._preflight_asset(asset_id, previous_result=previous_result)
        if dry.get("canDelete") is not True:
            finished_at = self._now_ms()
            reason = self._text(dry.get("reason")) or "not_cleanup_candidate"
            result.update({"status": "skipped", "reason": reason, "releasedBytes": 0, "error": "", "finishedAt": finished_at})
            attempts.append({"status": "skipped", "reason": reason, "error": "", "startedAt": started_at, "finishedAt": finished_at})
            result["attempts"] = attempts
            result["previousErrors"] = previous_errors
            return result
        releasable_bytes = self._safe_int(dry.get("releasableBytes"))
        candidate_ids = self._cleanup_candidate_ids()
        delete_payload = self.lifecycle_service.delete_assets([asset_id], dry_run=False)
        delete_result = next((item for item in delete_payload.get("results", []) if isinstance(item, dict) and self._text(item.get("assetId")) == asset_id), {})
        finished_at = self._now_ms()
        deleted = delete_result.get("deleted") is True
        reason = self._text(delete_result.get("reason")) or "delete_failed"
        error = self._sanitize_text(delete_result.get("error"))
        if deleted:
            result.update({"status": "success", "reason": reason or "orphan_asset", "releasedBytes": releasable_bytes, "error": "", "finishedAt": finished_at})
            self._mark_asset_deleted(asset_id, job_id, released_reason=result.get("reason"))
            self._restore_job_candidates(job_id, processed_ids={asset_id}, candidate_ids=candidate_ids)
        elif self._is_object_not_found(error) and self._asset_is_deleted_candidate(asset_id):
            result.update({"status": "success", "reason": "object_already_missing", "releasedBytes": 0, "error": "", "finishedAt": finished_at})
            self._mark_asset_deleted(asset_id, job_id, released_reason="object_already_missing")
            self._restore_job_candidates(job_id, processed_ids={asset_id}, candidate_ids=candidate_ids)
        else:
            result.update({"status": "failed", "reason": reason, "releasedBytes": 0, "error": error, "finishedAt": finished_at})
            if error:
                previous_errors.append(error)
            self._write_delete_error(asset_id, error or reason)
            self._restore_job_candidates(job_id, processed_ids={asset_id}, candidate_ids=candidate_ids)
        attempts.append({"status": result.get("status"), "reason": result.get("reason"), "error": result.get("error", ""), "startedAt": started_at, "finishedAt": finished_at})
        result["attempts"] = attempts
        result["previousErrors"] = previous_errors
        return result

    @staticmethod
    def _is_object_not_found(error):
        text = str(error or "").lower()
        return "object_not_found" in text or "not found" in text or "nosuchkey" in text

    def _asset_is_deleted_candidate(self, asset_id):
        registry = self._load_assets()
        for asset in registry.get("assets", []):
            if isinstance(asset, dict) and self._text(asset.get("assetId")) == asset_id:
                return self._text(asset.get("lifecycleStatus")) in (QUEUE_SOURCE_STATUS, "delete_failed")
        return False

    def _mark_asset_deleted(self, asset_id, job_id, released_reason=""):
        registry = self._load_assets()
        now = self._now_ms()
        changed = False
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict) or self._text(asset.get("assetId")) != asset_id:
                continue
            asset["lifecycleStatus"] = "deleted"
            asset["deletedAt"] = self._safe_int(asset.get("deletedAt")) or now
            asset["deleteMode"] = "manual"
            asset["deleteError"] = ""
            asset["cleanupJobId"] = job_id
            asset["lastLifecycleCheckedAt"] = now
            cleanup_queue = asset.get("cleanupQueue") if isinstance(asset.get("cleanupQueue"), dict) else {}
            cleanup_queue["reviewStatus"] = "deleted"
            cleanup_queue["reviewedAt"] = now
            if released_reason:
                cleanup_queue["reviewNote"] = self._sanitize_text(released_reason)
            asset["cleanupQueue"] = cleanup_queue
            changed = True
            break
        if changed:
            self._save_assets(registry)

    def _write_delete_error(self, asset_id, error):
        registry = self._load_assets()
        now = self._now_ms()
        changed = False
        for asset in registry.get("assets", []):
            if not isinstance(asset, dict) or self._text(asset.get("assetId")) != asset_id:
                continue
            asset["deleteError"] = self._sanitize_text(error)
            asset["lastLifecycleCheckedAt"] = now
            changed = True
            break
        if changed:
            self._save_assets(registry)

    def cancel_job(self, job_id):
        with self._lock:
            payload = self._load_jobs_unlocked()
            job = self._find_job(payload.get("jobs", []), job_id)
            if not job:
                return {"success": False, "error": "job_not_found"}
            if self._text(job.get("status")) in TERMINAL_STATUSES:
                return {"success": False, "error": "job_already_finished"}
            now = self._now_ms()
            if self._text(job.get("status")) == "pending":
                for item in job.get("results", []):
                    if isinstance(item, dict) and self._text(item.get("status")) == "pending":
                        item.update({"status": "skipped", "reason": "canceled", "finishedAt": now})
                job["status"] = "canceled"
                job["finishedAt"] = now
            else:
                job["cancelRequested"] = True
            job["updatedAt"] = now
            job["lastHeartbeatAt"] = now
            self._recount_job(job)
            self._save_jobs_unlocked(payload)
            return {"success": True, "job": self._sanitize(job)}

    def retry_job(self, job_id):
        with self._lock:
            payload = self._load_jobs_unlocked()
            job = self._find_job(payload.get("jobs", []), job_id)
            if not job:
                return {"success": False, "error": "job_not_found"}
            failed_results = [item for item in job.get("results", []) if isinstance(item, dict) and self._text(item.get("status")) == "failed"]
            if not failed_results:
                return {"success": True, "job": self._sanitize(job)}
            now = self._now_ms()
            job["status"] = "running"
            job["cancelRequested"] = False
            job["finishedAt"] = 0
            job["updatedAt"] = now
            job["lastHeartbeatAt"] = now
            self._save_jobs_unlocked(payload)
        retry_results = []
        for item in failed_results:
            retry_results.append(self._execute_asset(job_id, self._text(item.get("assetId")), previous_result=item))
        with self._lock:
            payload = self._load_jobs_unlocked()
            job = self._find_job(payload.get("jobs", []), job_id)
            for retry_result in retry_results:
                for index, item in enumerate(job.get("results", [])):
                    if isinstance(item, dict) and self._text(item.get("assetId")) == self._text(retry_result.get("assetId")):
                        job["results"][index] = retry_result
                        break
            now = self._now_ms()
            job.setdefault("retryResults", []).extend(retry_results)
            job["status"] = self._final_status(job)
            job["finishedAt"] = now
            job["updatedAt"] = now
            job["lastHeartbeatAt"] = now
            self._save_jobs_unlocked(payload)
            return {"success": True, "job": self._sanitize(job)}

    def mark_stale_jobs(self):
        with self._lock:
            payload = self._load_jobs_unlocked()
            now = self._now_ms()
            changed = False
            for job in payload.get("jobs", []):
                if self._text(job.get("status")) not in RUNNING_STATUSES:
                    continue
                heartbeat = self._safe_int(job.get("lastHeartbeatAt")) or self._safe_int(job.get("updatedAt")) or self._safe_int(job.get("createdAt"))
                if heartbeat and now - heartbeat <= self.heartbeat_timeout_ms:
                    continue
                job["reason"] = "server_restarted_or_interrupted"
                for asset_id in job.get("assetIds", []):
                    if any(self._text(item.get("assetId")) == self._text(asset_id) for item in job.get("results", []) if isinstance(item, dict)):
                        continue
                    job.setdefault("results", []).append(self._empty_result(self._text(asset_id)))
                for item in job.get("results", []):
                    if isinstance(item, dict) and self._text(item.get("status")) in ("", "pending", "running"):
                        item.update({"status": "skipped", "reason": "server_restarted_or_interrupted", "finishedAt": now})
                self._recount_job(job)
                job["status"] = "partial_failed" if job.get("successCount") > 0 else "failed"
                job["currentAssetId"] = ""
                job["finishedAt"] = now
                job["updatedAt"] = now
                job["lastHeartbeatAt"] = now
                changed = True
            if changed or len(payload.get("jobs", [])) > self.max_jobs:
                self._save_jobs_unlocked(payload)