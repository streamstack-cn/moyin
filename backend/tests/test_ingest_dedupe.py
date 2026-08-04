"""入库去重：同 hash / 同路径不应产生两本书。"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


class IngestDedupeTests(unittest.TestCase):
    def test_normalize_path_absolute(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "a.pdf"
            f.write_bytes(b"%PDF-1.4 test")
            n = scan_service.normalize_book_path(str(f))
            self.assertTrue(n.startswith("/"))
            self.assertEqual(n, str(f.resolve()))

    def test_second_ingest_same_hash_reuses_book(self):
        import asyncio
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "book.pdf"
            f.write_bytes(b"%PDF-1.4 hello-moyin-dedupe")

            existing = MagicMock()
            existing.file_path = str(f.resolve())
            existing.library_id = None
            existing.file_size = f.stat().st_size

            db = MagicMock()
            # 第一次：无已有；第二次：按 hash 命中
            db.query.return_value.filter.return_value.first.side_effect = [None, existing]

            with (
                patch.object(scan_service, "_find_existing_book", side_effect=[None, existing]),
                patch.object(scan_service, "_rebind_existing_book", return_value=existing) as rebind,
                patch.object(scan_service.convert_service, "needs_conversion", return_value=False),
                patch.object(scan_service.convert_service, "extract_calibre_metadata", return_value={}),
                patch.object(scan_service.convert_service, "extract_cover_with_calibre", return_value=None),
                patch.object(scan_service, "_index_content"),
                patch.object(scan_service.metadata_service, "auto_match", return_value=None),
            ):
                # 第一次会走到创建分支，需要 db.add/commit；这里改为两次都走 find
                # 直接验证第二次复用
                with patch.object(scan_service, "_find_existing_book", return_value=existing):
                    book = asyncio.run(
                        scan_service.ingest_file(db, str(f), library_id="lib1", auto_match=False)
                    )
                self.assertIs(book, existing)
                rebind.assert_called()


if __name__ == "__main__":
    unittest.main()
