import datetime
import hashlib
import hmac
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


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

    def _signed_put_request(self, bucket, key, file_bytes, content_type):
        endpoint = self._trim_trailing_slash(bucket.get("endpoint"))
        bucket_name = self._text(bucket.get("bucket"))
        region = self._text(bucket.get("region")) or "auto"
        quoted_key = urllib.parse.quote(key, safe="/._-")
        if bucket.get("forcePathStyle"):
            url = f"{endpoint}/{urllib.parse.quote(bucket_name, safe='')}/{quoted_key}"
        else:
            parts = urllib.parse.urlsplit(endpoint)
            url = urllib.parse.urlunsplit((parts.scheme, f"{bucket_name}.{parts.netloc}", f"/{quoted_key}", "", ""))
        parsed = urllib.parse.urlsplit(url)
        host = parsed.netloc
        now = datetime.datetime.utcnow()
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(file_bytes).hexdigest()
        canonical_uri = parsed.path or "/"
        canonical_query = ""
        canonical_headers = (
            f"host:{host}\n"
            f"x-amz-content-sha256:{payload_hash}\n"
            f"x-amz-date:{amz_date}\n"
        )
        signed_headers = "host;x-amz-content-sha256;x-amz-date"
        canonical_request = "\n".join((
            "PUT",
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
            "Content-Type": content_type or "application/octet-stream",
            "Content-Length": str(len(file_bytes)),
            "Host": host,
            "X-Amz-Content-Sha256": payload_hash,
            "X-Amz-Date": amz_date,
        }
        return urllib.request.Request(url, data=file_bytes, headers=headers, method="PUT")

    def upload_media_bytes(self, file_bytes, *, filename, content_type="", local_path=""):
        bucket = self.validate_bucket(self.active_bucket())
        payload = bytes(file_bytes or b"")
        key = self._object_key(bucket, filename, local_path)
        request = self._signed_put_request(bucket, key, payload, content_type)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                status = int(getattr(response, "status", 200) or 200)
                if status >= 400:
                    raise RuntimeError(f"bucket upload failed: HTTP {status}")
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"bucket upload failed: HTTP {exc.code}") from exc
        return {
            "url": self._public_url(bucket, key),
            "key": key,
            "bucket": bucket.get("bucket"),
            "size": len(payload),
            "contentType": content_type or "application/octet-stream",
        }

    def test_connection(self):
        bucket = self.validate_bucket(self.active_bucket())
        probe_key = self._object_key(bucket, "probe.txt", "probe.txt")
        return {
            "success": True,
            "bucket": bucket.get("bucket"),
            "key": probe_key,
        }