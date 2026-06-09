import json
import urllib.error
import urllib.parse
import urllib.request


class RemoteProxyRouteService:
    def __init__(
        self,
        *,
        read_body,
        subscription_gate_service_getter,
        video_vip_workflow_ids,
    ):
        self._read_body = read_body
        self._get_subscription_gate_service = subscription_gate_service_getter
        self._video_vip_workflow_ids = {
            str(workflow_id or "").strip()
            for workflow_id in (video_vip_workflow_ids or set())
            if str(workflow_id or "").strip()
        }

    @staticmethod
    def _json_ok(data):
        return {"kind": "json_ok", "data": data}

    @staticmethod
    def _json_err(code, message):
        return {
            "kind": "json_err",
            "code": int(code),
            "message": str(message or ""),
        }

    @staticmethod
    def _proxy_response(status, body, *, content_type="application/json; charset=utf-8"):
        payload = body if isinstance(body, (bytes, bytearray)) else bytes(body or b"")
        return {
            "kind": "binary",
            "status": int(status),
            "body": bytes(payload),
            "contentType": str(content_type or "application/json; charset=utf-8"),
        }

    @staticmethod
    def _parse_json_object(body):
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return None, RemoteProxyRouteService._json_err(400, "Invalid JSON")
        if not isinstance(data, dict):
            return None, RemoteProxyRouteService._json_err(400, "Invalid JSON")
        return data, None

    @staticmethod
    def _parse_query(raw_path, *, max_num_fields=20):
        parsed = urllib.parse.urlparse(str(raw_path or ""))
        return urllib.parse.parse_qs(
            parsed.query,
            keep_blank_values=True,
            max_num_fields=max_num_fields,
        )

    @staticmethod
    def _extract_bearer_token(header_value):
        auth_value = str(header_value or "").strip()
        if auth_value.lower().startswith("bearer "):
            return auth_value[7:].strip()
        return ""

    def _extract_proxy_api_key(self, handler, query):
        api_key = query.get("apiKey", [""])[0].strip() if "apiKey" in query else ""
        if api_key:
            return api_key.rstrip(",")
        return self._extract_bearer_token(handler.headers.get("Authorization", ""))

    @staticmethod
    def _normalize_runninghub_instance_type(value):
        instance_type = str(value or "").strip().lower()
        if instance_type in ("24g", "default", "basic"):
            return "default"
        if instance_type in ("48g", "plus", "pro"):
            return "plus"
        return "default"

    @staticmethod
    def _requests_module():
        import requests

        return requests

    def _read_json_request(self, handler):
        return self._parse_json_object(self._read_body(handler))

    def _vip_gate_denial_response(self, handler, payload, *, required_model_id):
        gate_service = self._get_subscription_gate_service()
        decision = gate_service.check_vip_subscription_gate(
            handler,
            payload,
            required_model_id=required_model_id,
        )
        if bool(decision.get("allowed")):
            return None
        return self._json_ok(gate_service.build_subscription_denial_payload(decision))

    def _post_json_to_remote(self, api_url, payload, *, timeout, error_prefix):
        try:
            requests = self._requests_module()
            resp = requests.post(api_url, json=payload, timeout=timeout)
            return self._proxy_response(resp.status_code, resp.content)
        except ImportError:
            req_body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(api_url, data=req_body, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("User-Agent", "Mozilla/5.0")
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    resp_data = resp.read()
                return self._proxy_response(resp.status, resp_data)
            except urllib.error.HTTPError as exc:
                return self._proxy_response(exc.code, exc.read())
        except Exception as exc:
            return self._json_err(500, f"{error_prefix}: {repr(exc)}")

    def _handle_task_proxy(self, handler):
        query = self._parse_query(handler.path, max_num_fields=10)
        api_url = query.get("apiUrl", [""])[0].strip() if "apiUrl" in query else ""
        api_key = self._extract_proxy_api_key(handler, query)
        api_url = api_url.rstrip(",")
        if not api_url or not api_key:
            return self._json_err(400, "Missing apiUrl or apiKey")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        }
        parsed_api_url = urllib.parse.urlparse(api_url)
        result_endpoint_path = str(parsed_api_url.path or "").rstrip("/")
        if result_endpoint_path in ("/v1/api/result", "/v1/draw/result"):
            result_query = urllib.parse.parse_qs(
                parsed_api_url.query,
                keep_blank_values=True,
                max_num_fields=20,
            )
            task_id = ""
            for key in ("id", "taskId", "task_id"):
                value = result_query.get(key, [""])[0].strip() if key in result_query else ""
                if value:
                    task_id = value
                    break
            if task_id:
                current_result_url = urllib.parse.urlunparse(
                    (
                        parsed_api_url.scheme,
                        parsed_api_url.netloc,
                        parsed_api_url.path,
                        "",
                        "",
                        "",
                    )
                )
                candidate_paths = [parsed_api_url.path]
                if result_endpoint_path == "/v1/api/result":
                    candidate_paths.append("/v1/draw/result")
                elif result_endpoint_path == "/v1/draw/result":
                    candidate_paths.append("/v1/api/result")
                candidate_result_urls = []
                for candidate_path in candidate_paths:
                    candidate_url = urllib.parse.urlunparse(
                        (
                            parsed_api_url.scheme,
                            parsed_api_url.netloc,
                            candidate_path,
                            "",
                            "",
                            "",
                        )
                    )
                    if candidate_url and candidate_url not in candidate_result_urls:
                        candidate_result_urls.append(candidate_url)
                if current_result_url and current_result_url not in candidate_result_urls:
                    candidate_result_urls.insert(0, current_result_url)
                candidate_get_urls = []
                for candidate_url in candidate_result_urls:
                    parsed_candidate_url = urllib.parse.urlparse(candidate_url)
                    for task_id_key in ("id", "taskId", "task_id"):
                        get_url = urllib.parse.urlunparse(
                            (
                                parsed_candidate_url.scheme,
                                parsed_candidate_url.netloc,
                                parsed_candidate_url.path,
                                "",
                                urllib.parse.urlencode({task_id_key: task_id}),
                                "",
                            )
                        )
                        if get_url and get_url not in candidate_get_urls:
                            candidate_get_urls.append(get_url)
                if api_url and api_url not in candidate_get_urls:
                    candidate_get_urls.insert(0, api_url)
                post_headers = {
                    **headers,
                    "Content-Type": "application/json",
                }
                candidate_payloads = [
                    {"id": task_id},
                    {"taskId": task_id},
                    {"task_id": task_id},
                ]
                pending_message = "result not exist, valid for 2 hours"
                def _pending_result_response():
                    pending_payload = json.dumps(
                        {
                            "id": task_id,
                            "task_id": task_id,
                            "taskId": task_id,
                            "status": "pending",
                            "message": pending_message,
                        }
                    ).encode("utf-8")
                    return self._proxy_response(200, pending_payload)
                def _is_result_not_exist(status_code, content):
                    return int(status_code or 0) in (200, 400, 404) and b"result not exist" in (content or b"").lower()
                def _is_id_required(status_code, content):
                    return int(status_code or 0) in (200, 400, 404) and b"id is required" in (content or b"").lower()
                def _is_candidate_protocol_error(status_code, content):
                    lower_content = (content or b"").lower()
                    return int(status_code or 0) in (200, 400, 401, 403, 404) and (
                        b"apikey error" in lower_content
                        or b"api key error" in lower_content
                        or b"api_key error" in lower_content
                        or b"model not register" in lower_content
                        or b"page not found" in lower_content
                    )
                try:
                    try:
                        requests = self._requests_module()
                        last_status_code = 404
                        last_content = b""
                        saw_result_not_exist = False
                        for candidate_get_url in candidate_get_urls:
                            original_resp = requests.get(candidate_get_url, headers=headers, timeout=30)
                            original_content = original_resp.content or b""
                            last_status_code = original_resp.status_code
                            last_content = original_content
                            if _is_result_not_exist(original_resp.status_code, original_content):
                                saw_result_not_exist = True
                                continue
                            if _is_id_required(original_resp.status_code, original_content) or _is_candidate_protocol_error(original_resp.status_code, original_content):
                                continue
                            return self._proxy_response(original_resp.status_code, original_content)
                        for candidate_url in candidate_result_urls:
                            for payload in candidate_payloads:
                                resp = requests.post(
                                    candidate_url,
                                    json=payload,
                                    headers=post_headers,
                                    timeout=30,
                                )
                                content = resp.content or b""
                                last_status_code = resp.status_code
                                last_content = content
                                if _is_result_not_exist(resp.status_code, content):
                                    saw_result_not_exist = True
                                    continue
                                if _is_id_required(resp.status_code, content) or _is_candidate_protocol_error(resp.status_code, content):
                                    continue
                                return self._proxy_response(resp.status_code, content)
                        if saw_result_not_exist:
                            return _pending_result_response()
                        if _is_candidate_protocol_error(last_status_code, last_content) or _is_id_required(last_status_code, last_content):
                            return _pending_result_response()
                        return self._proxy_response(last_status_code, last_content)
                    except ImportError:
                        pass
                    last_status_code = 404
                    last_content = b""
                    saw_result_not_exist = False
                    for candidate_get_url in candidate_get_urls:
                        try:
                            original_req = urllib.request.Request(candidate_get_url, headers=headers, method="GET")
                            with urllib.request.urlopen(original_req, timeout=30) as original_resp:
                                original_data = original_resp.read()
                            last_status_code = original_resp.status
                            last_content = original_data
                            if _is_result_not_exist(original_resp.status, original_data):
                                saw_result_not_exist = True
                                continue
                            if _is_id_required(original_resp.status, original_data) or _is_candidate_protocol_error(original_resp.status, original_data):
                                continue
                            return self._proxy_response(original_resp.status, original_data)
                        except urllib.error.HTTPError as exc:
                            error_body = exc.read()
                            last_status_code = exc.code
                            last_content = error_body
                            if _is_result_not_exist(exc.code, error_body):
                                saw_result_not_exist = True
                                continue
                            if _is_id_required(exc.code, error_body) or _is_candidate_protocol_error(exc.code, error_body):
                                continue
                            return self._proxy_response(exc.code, error_body)
                    for candidate_url in candidate_result_urls:
                        for payload in candidate_payloads:
                            req_body = json.dumps(payload).encode("utf-8")
                            req = urllib.request.Request(candidate_url, data=req_body, headers=post_headers, method="POST")
                            try:
                                with urllib.request.urlopen(req, timeout=30) as resp:
                                    resp_data = resp.read()
                                last_status_code = resp.status
                                last_content = resp_data
                                if _is_result_not_exist(resp.status, resp_data):
                                    saw_result_not_exist = True
                                    continue
                                if _is_id_required(resp.status, resp_data) or _is_candidate_protocol_error(resp.status, resp_data):
                                    continue
                                return self._proxy_response(resp.status, resp_data)
                            except urllib.error.HTTPError as exc:
                                error_body = exc.read()
                                last_status_code = exc.code
                                last_content = error_body
                                if _is_result_not_exist(exc.code, error_body):
                                    saw_result_not_exist = True
                                    continue
                                if _is_id_required(exc.code, error_body) or _is_candidate_protocol_error(exc.code, error_body):
                                    continue
                                return self._proxy_response(exc.code, error_body)
                    if saw_result_not_exist:
                        return _pending_result_response()
                    if _is_candidate_protocol_error(last_status_code, last_content) or _is_id_required(last_status_code, last_content):
                        return _pending_result_response()
                    return self._proxy_response(last_status_code, last_content)
                except Exception as exc:
                    return self._json_err(500, f"GRSAI result proxy error: {str(exc)}")
        try:
            try:
                requests = self._requests_module()
                resp = requests.get(api_url, headers=headers, timeout=30)
                return self._proxy_response(resp.status_code, resp.content)
            except ImportError:
                pass
            except Exception:
                pass

            req = urllib.request.Request(api_url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp_data = resp.read()
                return self._proxy_response(200, resp_data)
            except urllib.error.HTTPError as exc:
                return self._proxy_response(exc.code, exc.read())
            except Exception as exc:
                return self._json_err(500, f"Urllib polling error: {str(exc)}")
        except Exception as exc:
            return self._json_err(500, f"Task proxy global error: {repr(exc)}")

    def _handle_upload_proxy(self, handler):
        query = self._parse_query(handler.path)
        api_url = query.get("apiUrl", [""])[0].strip()
        api_key = self._extract_proxy_api_key(handler, query)
        if not api_url or not api_key:
            return self._json_err(400, "Missing apiUrl or apiKey")

        try:
            content_length = int(handler.headers.get("Content-Length", 0))
            body = handler.rfile.read(content_length)
            content_type = handler.headers.get("Content-Type", "")

            req = urllib.request.Request(api_url, data=body, method="POST")
            req.add_header("Authorization", f"Bearer {api_key}")
            req.add_header("Content-Type", content_type)
            req.add_header("Content-Length", str(len(body)))

            with urllib.request.urlopen(req, timeout=60) as resp:
                return self._proxy_response(resp.status, resp.read())
        except urllib.error.HTTPError as exc:
            return self._proxy_response(exc.code, exc.read())
        except Exception as exc:
            return self._json_err(500, f"Upload proxy error: {str(exc)}")

    def _handle_runninghub_workflow_run(self, handler):
        data, error = self._read_json_request(handler)
        if error is not None:
            return error

        api_key = (data.get("apiKey") or "").strip()
        workflow_id = str(data.get("workflowId") or "").strip()
        node_info_list = data.get("nodeInfoList")
        if not api_key or not workflow_id or not isinstance(node_info_list, list):
            return self._json_err(400, "Missing apiKey or workflowId or nodeInfoList")

        if workflow_id in self._video_vip_workflow_ids:
            denial = self._vip_gate_denial_response(
                handler,
                data,
                required_model_id=f"runninghub/{workflow_id}",
            )
            if denial is not None:
                return denial

        payload = dict(data)
        payload["instanceType"] = self._normalize_runninghub_instance_type(
            data.get("instanceType") or data.get("rhInstanceType") or ""
        )
        return self._post_json_to_remote(
            "https://www.runninghub.cn/task/openapi/create",
            payload,
            timeout=900,
            error_prefix="RunningHub workflow proxy error",
        )

    def _handle_runninghub_task_action(self, handler, *, api_url, error_prefix):
        data, error = self._read_json_request(handler)
        if error is not None:
            return error

        api_key = (data.get("apiKey") or "").strip()
        task_id = str(data.get("taskId") or "").strip()
        if not api_key or not task_id:
            return self._json_err(400, "Missing apiKey or taskId")

        return self._post_json_to_remote(
            api_url,
            {"apiKey": api_key, "taskId": task_id},
            timeout=60,
            error_prefix=error_prefix,
        )

    def handle_get(self, handler, path):
        if path == "/api/v2/proxy/task":
            return self._handle_task_proxy(handler)
        return None

    def handle_post(self, handler, path):
        if path == "/api/v2/proxy/upload":
            return self._handle_upload_proxy(handler)

        if path == "/api/v2/runninghubwf/run":
            return self._handle_runninghub_workflow_run(handler)

        if path == "/api/v2/runninghubwf/query":
            return self._handle_runninghub_task_action(
                handler,
                api_url="https://www.runninghub.cn/task/openapi/outputs",
                error_prefix="RunningHub query proxy error",
            )

        if path == "/api/v2/runninghubwf/cancel":
            return self._handle_runninghub_task_action(
                handler,
                api_url="https://www.runninghub.cn/task/openapi/cancel",
                error_prefix="RunningHub cancel proxy error",
            )

        return None
