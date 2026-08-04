"""豆瓣登录态 / 探活状态辅助逻辑。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import api_douban as douban_api  # noqa: E402


class DoubanProbeStateTests(unittest.TestCase):
    def test_probe_state_mapping(self):
        self.assertEqual(douban_api._probe_state_of({"valid": True}), "ok")
        self.assertEqual(douban_api._probe_state_of({"valid": False, "risk_control": True}), "risk")
        self.assertEqual(douban_api._probe_state_of({"valid": False}), "invalid")

    def test_persist_invalid_clears_identity(self):
        db = MagicMock()
        calls: list[dict] = []

        def capture(_db, mapping):
            calls.append(dict(mapping))

        orig = douban_api._set_many
        douban_api._set_many = capture  # type: ignore[assignment]
        try:
            douban_api._persist_probe(
                db,
                "dbcl2=x; ck=y",
                {"valid": False, "error": "Cookie 无效", "user_id": "old", "name": "旧名"},
            )
        finally:
            douban_api._set_many = orig  # type: ignore[assignment]

        self.assertTrue(calls)
        patch = calls[-1]
        self.assertEqual(patch["DOUBAN_PROBE_STATE"], "invalid")
        self.assertEqual(patch["DOUBAN_USER_ID"], "")
        self.assertEqual(patch["DOUBAN_USER_NAME"], "")

    def test_persist_risk_keeps_optional_identity(self):
        db = MagicMock()
        calls: list[dict] = []

        def capture(_db, mapping):
            calls.append(dict(mapping))

        orig = douban_api._set_many
        douban_api._set_many = capture  # type: ignore[assignment]
        try:
            douban_api._persist_probe(
                db,
                "dbcl2=x; ck=y",
                {"valid": False, "risk_control": True, "error": "风控", "user_id": "", "name": ""},
            )
        finally:
            douban_api._set_many = orig  # type: ignore[assignment]

        patch = calls[-1]
        self.assertEqual(patch["DOUBAN_PROBE_STATE"], "risk")
        self.assertNotIn("DOUBAN_USER_ID", patch)

    def test_status_payload_includes_auto_match(self):
        p = douban_api._status_payload(
            enabled=True,
            cookie_set=True,
            cookie_ok=False,
            state="risk",
            message="x",
            user_id="",
            user_name="",
            source="cache",
            checked_at=1,
            probe_age_seconds=10,
            auto_match_metadata=False,
        )
        self.assertFalse(p["auto_match_metadata"])
        self.assertEqual(p["state"], "risk")


if __name__ == "__main__":
    unittest.main()
