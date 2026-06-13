import time
import unittest

import server


class LocalProxyTaskRegistryTest(unittest.TestCase):
    def setUp(self):
        with server.LOCAL_PROXY_TASK_LOCK:
            server.LOCAL_PROXY_TASK_REGISTRY.clear()

    def tearDown(self):
        with server.LOCAL_PROXY_TASK_LOCK:
            server.LOCAL_PROXY_TASK_REGISTRY.clear()

    def test_missing_local_task_returns_explicit_missing_status(self):
        self.assertEqual(
            server._get_local_proxy_task("", ""),
            {"status": "missing", "reason": "missing_local_task_id"},
        )
        self.assertEqual(
            server._get_local_proxy_task("runtime-missing", ""),
            {"status": "missing", "reason": "request_lost"},
        )

    def test_runtime_and_client_ids_resolve_same_cached_task(self):
        task_ref = {
            "runtimeTaskId": "runtime-1",
            "clientTaskId": "client-1",
            "nodeId": "node-1",
            "canvasId": "canvas-1",
            "provider": "grsai",
            "kind": "image",
        }

        running = server._upsert_local_proxy_task(task_ref, status="running")
        self.assertEqual(running["status"], "running")
        self.assertEqual(server._get_local_proxy_task("runtime-1", "")["status"], "running")
        self.assertEqual(server._get_local_proxy_task("", "client-1")["status"], "running")

        result = {"imageUrl": "https://cdn.example/result.png"}
        server._upsert_local_proxy_task(
            task_ref,
            status="success",
            result=result,
            httpStatus=200,
            contentType="application/json; charset=utf-8",
        )

        by_runtime = server._get_local_proxy_task("runtime-1", "")
        by_client = server._get_local_proxy_task("", "client-1")
        self.assertEqual(by_runtime["status"], "success")
        self.assertEqual(by_client["status"], "success")
        self.assertEqual(by_runtime["result"], result)
        self.assertEqual(by_client["result"], result)
        self.assertEqual(by_runtime["runtimeTaskId"], "runtime-1")
        self.assertEqual(by_runtime["clientTaskId"], "client-1")

    def test_expired_cached_task_is_reported_as_request_lost(self):
        expired_updated_at = int((time.time() - server.LOCAL_PROXY_TASK_TTL_SECONDS - 1) * 1000)
        with server.LOCAL_PROXY_TASK_LOCK:
            server.LOCAL_PROXY_TASK_REGISTRY["runtime-expired"] = {
                "runtimeTaskId": "runtime-expired",
                "status": "running",
                "updatedAt": expired_updated_at,
            }

        self.assertEqual(
            server._get_local_proxy_task("runtime-expired", ""),
            {"status": "missing", "reason": "request_lost"},
        )
    def test_proxy_image_upstream_payload_removes_local_and_sensitive_fields(self):
        payload = {
            "prompt": "cat",
            "provider": "grsai",
            "apiUrl": "https://example.invalid/v1/api/generate",
            "apiKey": "frontend-secret",
            "runtimeTaskId": "runtime-1",
            "clientTaskId": "client-1",
            "nodeId": "node-1",
            "canvasId": "canvas-1",
            "kind": "image",
            "installId": "install-1",
            "install_id": "install-2",
            "deviceId": "device-1",
            "webHook": "https://should-not-survive.example/hook",
            "replyType": "url",
        }

        upstream, local_ref = server._build_image_proxy_upstream_payload(payload)

        self.assertEqual(upstream["prompt"], "cat")
        self.assertEqual(upstream["webHook"], "-1")
        self.assertEqual(upstream["shutProgress"], False)
        self.assertNotIn("apiUrl", upstream)
        self.assertNotIn("apiKey", upstream)
        self.assertNotIn("runtimeTaskId", upstream)
        self.assertNotIn("clientTaskId", upstream)
        self.assertNotIn("nodeId", upstream)
        self.assertNotIn("canvasId", upstream)
        self.assertNotIn("provider", upstream)
        self.assertNotIn("kind", upstream)
        self.assertNotIn("installId", upstream)
        self.assertNotIn("install_id", upstream)
        self.assertNotIn("deviceId", upstream)
        self.assertNotIn("replyType", upstream)
        self.assertEqual(local_ref, {
            "runtimeTaskId": "runtime-1",
            "clientTaskId": "client-1",
            "nodeId": "node-1",
            "canvasId": "canvas-1",
            "provider": "grsai",
            "kind": "image",
        })


if __name__ == "__main__":
    unittest.main()