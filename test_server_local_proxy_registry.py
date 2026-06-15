import json
import threading
import time
import unittest
import urllib.parse
import urllib.request

import server


class LocalProxyTaskRegistryTest(unittest.TestCase):
    def setUp(self):
        with server.LOCAL_PROXY_TASK_LOCK:
            server.LOCAL_PROXY_TASK_REGISTRY.clear()

    def tearDown(self):
        with server.LOCAL_PROXY_TASK_LOCK:
            server.LOCAL_PROXY_TASK_REGISTRY.clear()

    def _start_http_server(self, handler_cls):
        httpd = server.QuietThreadingTCPServer(("127.0.0.1", 0), handler_cls)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"

    def _json_request(self, url, payload=None, method="GET", timeout=5):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method=method,
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

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

    def test_proxy_completions_upstream_payload_removes_local_recovery_fields(self):
        payload = {
            "apiUrl": "https://example.invalid/v1",
            "apiKey": "frontend-secret",
            "model": "gpt-5.4",
            "messages": [{"role": "user", "content": "hello"}],
            "runtimeTaskId": "runtime-text-1",
            "clientTaskId": "client-text-1",
            "nodeId": "text-node-1",
            "canvasId": "canvas-1",
            "provider": "custom_openai_compatible",
            "kind": "text",
            "installId": "install-1",
            "deviceId": "device-1",
        }

        upstream, local_ref = server._build_completions_proxy_upstream_payload(payload)

        self.assertEqual(upstream["model"], "gpt-5.4")
        self.assertEqual(upstream["messages"], [{"role": "user", "content": "hello"}])
        self.assertNotIn("apiUrl", upstream)
        self.assertNotIn("apiKey", upstream)
        self.assertNotIn("runtimeTaskId", upstream)
        self.assertNotIn("clientTaskId", upstream)
        self.assertNotIn("nodeId", upstream)
        self.assertNotIn("canvasId", upstream)
        self.assertNotIn("provider", upstream)
        self.assertNotIn("kind", upstream)
        self.assertNotIn("installId", upstream)
        self.assertNotIn("deviceId", upstream)
        self.assertEqual(local_ref, {
            "runtimeTaskId": "runtime-text-1",
            "clientTaskId": "client-text-1",
            "nodeId": "text-node-1",
            "canvasId": "canvas-1",
            "provider": "custom_openai_compatible",
            "kind": "text",
        })
    def test_proxy_completions_route_registers_running_then_success_for_local_task(self):
        upstream_release = threading.Event()
        upstream_seen = []

        class UpstreamHandler(server.http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length).decode("utf-8")
                upstream_seen.append(json.loads(body or "{}"))
                upstream_release.wait(timeout=5)
                response = json.dumps({
                    "id": "resp_text_route_1",
                    "object": "chat.completion",
                    "model": "gpt-5.4",
                    "choices": [{"message": {"role": "assistant", "content": "路由恢复文本"}}],
                }).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

        upstream_httpd, upstream_url = self._start_http_server(UpstreamHandler)
        app_httpd, app_url = self._start_http_server(server.Handler)
        completion_error = []
        completion_result = []

        def submit_completion():
            try:
                completion_result.append(self._json_request(
                    f"{app_url}/api/v2/proxy/completions",
                    {
                        "apiUrl": upstream_url,
                        "apiKey": "frontend-secret",
                        "model": "custom_openai_compatible/gpt-5.4",
                        "messages": [{"role": "user", "content": "hello"}],
                        "runtimeTaskId": "runtime-text-route-1",
                        "clientTaskId": "client-text-route-1",
                        "nodeId": "text-node-route-1",
                        "canvasId": "canvas-route-1",
                        "provider": "custom_openai_compatible",
                        "kind": "text",
                    },
                    method="POST",
                    timeout=10,
                ))
            except Exception as exc:
                completion_error.append(exc)

        thread = threading.Thread(target=submit_completion, daemon=True)
        thread.start()
        try:
            deadline = time.time() + 5
            running = None
            while time.time() < deadline:
                running = self._json_request(
                    f"{app_url}/api/v2/proxy/local-task?runtimeTaskId=runtime-text-route-1&clientTaskId=client-text-route-1",
                    timeout=5,
                )
                if running.get("status") == "running":
                    break
                time.sleep(0.05)

            self.assertEqual(running.get("status"), "running")
            self.assertEqual(running.get("runtimeTaskId"), "runtime-text-route-1")
            self.assertEqual(running.get("clientTaskId"), "client-text-route-1")
            self.assertEqual(running.get("kind"), "text")
            self.assertTrue(upstream_seen)
            self.assertNotIn("runtimeTaskId", upstream_seen[0])
            self.assertNotIn("clientTaskId", upstream_seen[0])
            self.assertNotIn("apiKey", upstream_seen[0])

            upstream_release.set()
            thread.join(timeout=10)
            self.assertFalse(completion_error)
            self.assertTrue(completion_result)

            success = self._json_request(
                f"{app_url}/api/v2/proxy/local-task?runtimeTaskId=runtime-text-route-1&clientTaskId=client-text-route-1",
                timeout=5,
            )
            self.assertEqual(success.get("status"), "success")
            self.assertEqual(success.get("result", {}).get("id"), "resp_text_route_1")
            self.assertEqual(success.get("result", {}).get("choices", [])[0].get("message", {}).get("content"), "路由恢复文本")
        finally:
            upstream_release.set()
            upstream_httpd.shutdown()
            upstream_httpd.server_close()
            app_httpd.shutdown()
            app_httpd.server_close()
