"""X-Request-Id 中间件：透传客户端 ID 并回写响应头。"""

from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from main import REQUEST_ID_HEADER, app


class RequestIdMiddlewareTests(unittest.TestCase):
    def test_echoes_client_request_id(self):
        client = TestClient(app)
        rid = "test-req-id-123"
        resp = client.get("/api/health", headers={REQUEST_ID_HEADER: rid})
        # health 可能 404；只要中间件挂上就会回写 header
        self.assertEqual(resp.headers.get(REQUEST_ID_HEADER), rid)

    def test_generates_when_missing(self):
        client = TestClient(app)
        resp = client.get("/api/health")
        self.assertTrue(resp.headers.get(REQUEST_ID_HEADER))


if __name__ == "__main__":
    unittest.main()
