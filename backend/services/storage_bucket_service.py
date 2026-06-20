import datetime
import hashlib
import hmac
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid


class StorageBucketConfigError(ValueError):
    pass


class StorageBucketService:
    def __init__(self, *, settings_getter):
        self._settings_getter = settings_getter

    @staticmethod
    def _text(value):
        return str(value or "").strip()

    @staticmethod
    def _trim_trailing_slash(value):
        return StorageBucketService._text(value).rstrip("/")

    @staticmethod
    def _normalize_prefix(value):
        cleaned = StorageBucketService._text(value).replace("\\", "/")
        cleaned = re.sub(r"^/+", "", cleaned)
        cleaned = re.sub(r"/+", "/", cleaned)
        if cleaned and not cleaned.endswith("/"):
            cleaned += "/"
        return cleaned

    @staticmethod
    def _normalize_bucket(raw_bucket):
        bucket = raw_bucket if isinstance(raw_bucket, dict) else {}
        return {
            "id": StorageBucketService._text(bucket.get("id")),
            "label": StorageBucketService._text(bucket.get("label")),
            "providerType": "s3-compatible",
            "endpoint": StorageBucketService._trim_trailing_slash(bucket.get("endpoint")),
            "region": StorageBucketService._text(bucket.get("region")) or "auto",
            "bucket": StorageBucketService._text(bucket.get("bucket")),
            "accessKeyId": StorageBucketService._text(bucket.get("accessKeyId")),
            "secretAccessKey": StorageBucketService._text(bucket.get("secretAccessKey")),
            "forcePathStyle": bool(bucket.get("forcePathStyle")),
            "publicBaseUrl": StorageBucketService._trim_trailing_slash(bucket.get("publicBaseUrl")),
            "prefix": StorageBucketService._normalize_prefix(bucket.get("prefix")),
            "enabled": bucket.get("enabled") is not False,
        }

    def _custom_storage(self):
        settings = self._settings_getter() or {}
        custom_storage = settings.get("customStorage") if isinstance(settings, dict) else {}
        return custom_storage if isinstance(custom_storage, dict) else {}

    def active_bucket(self):
        custom_storage = self._custom_storage()
        if not custom_storage.get("enabled"):
            return None
        buckets = custom_storage.get("buckets")
        if not isinstance(buckets, list):
            return None
        active_id = self._text(custom_storage.get("activeBucketId"))
        normalized = [self._normalize_bucket(item) for item in buckets]
        for bucket in normalized:
            if bucket.get("enabled") and active_id and bucket.get("id") == active_id:
                return bucket
        for bucket in normalized:
            if bucket.get("enabled"):
                return bucket
        return None

    def is_enabled(self):
        return self.active_bucket() is not None

    def validate_bucket(self, bucket):
        if not bucket:
            raise StorageBucketConfigError("自定义存储桶未启用")
        for field, label in (
            ("endpoint", "Endpoint"),
            ("bucket", "Bucket"),
            ("accessKeyId", "Access Key ID"),
            ("secretAccessKey", "Secret Access Key"),
        ):
            if not bucket.get(field):
                raise StorageBucketConfigError(f"缺少 {label}")
        return bucket

    def sanitize_error(self, error, bucket=None):
        active = bucket or self.active_bucket() or {}
        message = str(error or "存储桶操作失败")
        for secret in (active.get("accessKeyId"), active.get("secretAccessKey")):
            secret_text = self._text(secret)
            if secret_text:
                message = message.replace(secret_text, "***")
        message = re.sub(r"Authorization\s*[:=][^\s,;]+(?:\s+AWS4-HMAC-SHA256[^\n\r]*)?", "Authorization=***", message, flags=re.I)
        message = re.sub(r"AWS4-HMAC-SHA256[^\n\r]*", "AWS4-HMAC-SHA256 ***", message, flags=re.I)
        message = re.sub(r"Signature\s*=\s*[A-Fa-f0-9]+", "Signature=***", message, flags=re.I)
        return message

    @staticmethod
    def _object_key(bucket, filename, local_path=""):
        prefix = StorageBucketService._normalize_prefix(bucket.get("prefix"))
        raw_name = StorageBucketService._text(local_path) or StorageBucketService._text(filename) or "media.bin"
        raw_name = raw_name.replace("\\", "/").lstrip("/")
        raw_name = re.sub(r"[^a-zA-Z0-9._\-/]+", "_", raw_name)
        raw_name = re.sub(r"/+", "/", raw_name).strip("/") or "media.bin"
        return f"{prefix}{raw_name}"

    @staticmethod
    def _public_url(bucket, key):
        public_base = StorageBucketService._trim_trailing_slash(bucket.get("publicBaseUrl"))
        if public_base:
            return f"{public_base}/{urllib.parse.quote(key, safe='/._-')}"
        endpoint = StorageBucketService._trim_trailing_slash(bucket.get("endpoint"))
        bucket_name = StorageBucketService._text(bucket.get("bucket"))
        quoted_key = urllib.parse.quote(key, safe="/._-")
        if bucket.get("forcePathStyle"):
            return f"{endpoint}/{urllib.parse.quote(bucket_name, safe='')}/{quoted_key}"
        parts = urllib.parse.urlsplit(endpoint)
        if not parts.scheme or not parts.netloc:
            return f"{endpoint}/{quoted_key}"
        return urllib.parse.urlunsplit((parts.scheme, f"{bucket_name}.{parts.netloc}", f"/{quoted_key}", "", ""))

    @staticmethod
    def _signing_key(secret_key, date_stamp, region, service="s3"):
        def sign(key, msg):
            return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

        key_date = sign(("AWS4" + secret_key).encode("utf-8"), date_stamp)
        key_region = sign(key_date, region)
        key_service = sign(key_region, service)
        return sign(key_service, "aws4_request")

    def _object_url(self, bucket, key):
        endpoint = self._trim_trailing_slash(bucket.get("endpoint"))
        bucket_name = self._text(bucket.get("bucket"))
        quoted_key = urllib.parse.quote(key, safe="/._-")
        if bucket.get("forcePathStyle"):
            return f"{endpoint}/{urllib.parse.quote(bucket_name, safe='')}/{quoted_key}"
        parts = urllib.parse.urlsplit(endpoint)
        return urllib.parse.urlunsplit((parts.scheme, f"{bucket_name}.{parts.netloc}", f"/{quoted_key}", "", ""))

    def _signed_request(self, bucket, key, *, method, file_bytes=b"", content_type=""):
        region = self._text(bucket.get("region")) or "auto"
        payload = bytes(file_bytes or b"")
        url = self._object_url(bucket, key)
        parsed = urllib.parse.urlsplit(url)
        host = parsed.netloc
        now = datetime.datetime.now(datetime.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(payload).hexdigest()
        canonical_uri = parsed.path or "/"
        canonical_query = ""
        canonical_headers = (
            f"host:{host}\n"
            f"x-amz-content-sha256:{payload_hash}\n"
            f"x-amz-date:{amz_date}\n"
        )
        signed_headers = "host;x-amz-content-sha256;x-amz-date"
        canonical_request = "\n".join((
            method.upper(),
            canonical_uri,
            canonical_query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ))
        credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
        string_to_sign = "\n".join((
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ))
        signing_key = self._signing_key(bucket.get("secretAccessKey"), date_stamp, region)
        signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        authorization = (
            "AWS4-HMAC-SHA256 "
            f"Credential={bucket.get('accessKeyId')}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )
        headers = {
            "Authorization": authorization,
            "Host": host,
            "X-Amz-Content-Sha256": payload_hash,
            "X-Amz-Date": amz_date,
        }
        data = None
        if method.upper() in ("PUT", "POST"):
            data = payload
            headers["Content-Type"] = content_type or "application/octet-stream"
            headers["Content-Length"] = str(len(payload))
        return urllib.request.Request(url, data=data, headers=headers, method=method.upper())

    def _signed_put_request(self, bucket, key, file_bytes, content_type):
        return self._signed_request(
            bucket,
            key,
            method="PUT",
            file_bytes=file_bytes,
            content_type=content_type,
        )

    def _signed_delete_request(self, bucket, key):
        return self._signed_request(bucket, key, method="DELETE")

    def _signed_head_request(self, bucket, key):
        return self._signed_request(bucket, key, method="HEAD")

    def _signed_get_request(self, bucket, key):
        return self._signed_request(bucket, key, method="GET")

    def _probe_key(self, bucket):
        prefix = self._normalize_prefix(bucket.get("prefix"))
        return f"{prefix}__probe__/connection-test-{uuid.uuid4()}.txt"

    def _read_http_error_body(self, exc):
        try:
            return exc.read().decode("utf-8", "ignore")
        except Exception:
            return ""

    def _classify_request_error(self, error, bucket=None, *, operation="request"):
        if isinstance(error, urllib.error.HTTPError):
            body = self._read_http_error_body(error)
            detail = f"HTTP {error.code}"
            code_text = f"{error.code} {body}".lower()
            if operation == "public":
                return f"publicBaseUrl 不可访问：{detail}"
            if operation == "delete":
                return f"删除 probe 失败：{detail}"
            if error.code == 404 or "nosuchbucket" in code_text or "not found" in code_text:
                return f"bucket 不存在：{detail}"
            if error.code in (401, 403) and (
                "signature" in code_text
                or "invalidaccesskey" in code_text
                or "access key" in code_text
                or "credential" in code_text
                or "auth" in code_text
            ):
                return f"认证失败：{detail}"
            if error.code == 403:
                return f"没有写入权限：{detail}"
            return f"存储桶请求失败：{detail}"
        if isinstance(error, urllib.error.URLError):
            return f"endpoint 不可达：{self.sanitize_error(getattr(error, 'reason', error), bucket)}"
        text = str(error or "")
        lower = text.lower()
        if operation == "public":
            return f"publicBaseUrl 不可访问：{self.sanitize_error(text, bucket)}"
        if operation == "delete":
            return f"删除 probe 失败：{self.sanitize_error(text, bucket)}"
        if "timed out" in lower or "timeout" in lower or "refused" in lower or "unreachable" in lower:
            return f"endpoint 不可达：{self.sanitize_error(text, bucket)}"
        if "signature" in lower or "authorization" in lower or "credential" in lower or "secret" in lower:
            return "认证失败"
        return self.sanitize_error(text or "存储桶请求失败", bucket)

    def upload_media_bytes(self, file_bytes, *, filename, content_type="", local_path=""):
        bucket = self.validate_bucket(self.active_bucket())
        payload = bytes(file_bytes or b"")
        key = self._object_key(bucket, filename, local_path)
        request = self._signed_put_request(bucket, key, payload, content_type)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                status = int(getattr(response, "status", 200) or 200)
                if status >= 400:
                    raise RuntimeError(f"HTTP {status}")
        except Exception as exc:
            raise RuntimeError(self._classify_request_error(exc, bucket, operation="write")) from exc
        return {
            "url": self._public_url(bucket, key),
            "key": key,
            "bucket": bucket.get("bucket"),
            "endpoint": bucket.get("endpoint"),
            "size": len(payload),
            "contentType": content_type or "application/octet-stream",
        }

    def _request_success(self, request, *, timeout=30, expected_body=None):
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status = int(getattr(response, "status", 200) or 200)
            if status >= 400:
                raise RuntimeError(f"HTTP {status}")
            if expected_body is not None:
                body = response.read()
                if body != expected_body:
                    raise RuntimeError("probe read-back mismatch")
            return status

    def _verify_probe_read(self, bucket, probe_key, payload):
        try:
            self._request_success(self._signed_head_request(bucket, probe_key), timeout=30)
            return
        except urllib.error.HTTPError as exc:
            if exc.code not in (405, 501):
                raise
        self._request_success(self._signed_get_request(bucket, probe_key), timeout=30, expected_body=payload)

    def _verify_public_access(self, bucket, probe_key, payload):
        public_base = self._trim_trailing_slash(bucket.get("publicBaseUrl"))
        if not public_base:
            return
        url = f"{public_base}/{urllib.parse.quote(probe_key, safe='/._-')}"
        request = urllib.request.Request(url, method="GET")
        self._request_success(request, timeout=30, expected_body=payload)

    def test_connection(self, bucket_config=None):
        bucket = self.validate_bucket(
            self._normalize_bucket(bucket_config) if bucket_config is not None else self.active_bucket()
        )
        probe_key = self._probe_key(bucket)
        payload = b"ai-canvas-storage-probe"
        checks = {
            "config": True,
            "write": False,
            "read": False,
            "publicAccess": False,
            "delete": False,
        }
        failure_message = ""
        delete_message = ""
        try:
            self._request_success(
                self._signed_put_request(bucket, probe_key, payload, "text/plain; charset=utf-8"),
                timeout=30,
            )
            checks["write"] = True
            try:
                self._verify_probe_read(bucket, probe_key, payload)
                checks["read"] = True
            except Exception as exc:
                failure_message = self._classify_request_error(exc, bucket, operation="read")
            if not failure_message:
                try:
                    self._verify_public_access(bucket, probe_key, payload)
                    checks["publicAccess"] = True
                except Exception as exc:
                    failure_message = self._classify_request_error(exc, bucket, operation="public")
        except Exception as exc:
            failure_message = self._classify_request_error(exc, bucket, operation="write")
        finally:
            try:
                self._request_success(self._signed_delete_request(bucket, probe_key), timeout=30)
                checks["delete"] = True
            except Exception as exc:
                delete_message = self._classify_request_error(exc, bucket, operation="delete")
        if failure_message:
            raise RuntimeError(self.sanitize_error(failure_message, bucket))
        if delete_message:
            raise RuntimeError(self.sanitize_error(delete_message, bucket))
        return {
            "success": True,
            "checks": checks,
            "message": "连接测试成功",
            "bucket": bucket.get("bucket"),
            "key": probe_key,
        }