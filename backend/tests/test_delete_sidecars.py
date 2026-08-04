"""删除书籍时应同步清理 config/converted 下的转换副本。"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


class DeleteSidecarTests(unittest.TestCase):
    def test_delete_removes_converted_by_file_hash_when_path_stale(self):
        """库内 converted_path 失效时，仍应按 file_hash 删除转换后的 epub。"""
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            converted_dir = root / "converted"
            covers_dir = root / "covers"
            converted_dir.mkdir()
            covers_dir.mkdir()

            file_hash = "a" * 64
            converted = converted_dir / f"{file_hash}.epub"
            converted.write_bytes(b"%PDF-fake-epub-content-for-delete-test")

            book = SimpleNamespace(
                file_path=str(root / "missing-original.mobi"),
                file_hash=file_hash,
                cover_path="",
                # 旧绝对路径：文件已不在此处，但 hash 约定路径仍存在
                converted_path=str(root / "old-data" / "converted" / f"{file_hash}.epub"),
            )

            with (
                patch.object(scan_service.storage, "CONVERTED_DIR", converted_dir),
                patch.object(scan_service.storage, "COVERS_DIR", covers_dir),
                patch.object(
                    scan_service.storage,
                    "resolve_stored_path",
                    side_effect=lambda p: None,
                ),
            ):
                result = scan_service.delete_book_files(book)

            self.assertFalse(converted.exists(), "转换副本应被删除")
            self.assertTrue(any(file_hash in d for d in result["deleted"]))

    def test_cleanup_sidecar_also_uses_file_hash(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            converted_dir = root / "converted"
            covers_dir = root / "covers"
            converted_dir.mkdir()
            covers_dir.mkdir()

            file_hash = "b" * 64
            converted = converted_dir / f"{file_hash}.epub"
            converted.write_bytes(b"epub-bytes")

            book = SimpleNamespace(
                file_path="",
                file_hash=file_hash,
                cover_path="",
                converted_path="",
            )

            with (
                patch.object(scan_service.storage, "CONVERTED_DIR", converted_dir),
                patch.object(scan_service.storage, "COVERS_DIR", covers_dir),
            ):
                scan_service._cleanup_book_sidecar_files(book)

            self.assertFalse(converted.exists())


if __name__ == "__main__":
    unittest.main()
