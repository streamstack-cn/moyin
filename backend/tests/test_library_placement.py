"""上传落盘与书架转移：目标目录 / 未归架。"""

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


class LibraryPlacementTests(unittest.TestCase):
    def test_unique_dest_avoids_overwrite(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.epub").write_bytes(b"1")
            dest = scan_service.unique_dest_in_dir(root, "a.epub")
            self.assertEqual(dest.name, "a-1.epub")
            self.assertFalse(dest.exists())

    def test_place_into_library_keeps_filename(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lib_root = root / "lib"
            uploads = root / "uploads"
            lib_root.mkdir()
            uploads.mkdir()
            src = root / "tmp.epub"
            src.write_bytes(b"epub-bytes")

            with (
                patch.object(scan_service.storage, "UPLOAD_DIR", uploads),
            ):
                dest = scan_service.place_uploaded_file(
                    str(src),
                    "苏格拉底.epub",
                    library_root=str(lib_root),
                )
            self.assertEqual(Path(dest).parent, lib_root.resolve())
            self.assertEqual(Path(dest).name, "苏格拉底.epub")
            self.assertTrue(Path(dest).is_file())

    def test_place_unassigned_uses_uploads_hash_name(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uploads = root / "uploads"
            uploads.mkdir()
            src = root / "tmp.epub"
            src.write_bytes(b"hello-epub-content")

            with patch.object(scan_service.storage, "UPLOAD_DIR", uploads):
                dest = scan_service.place_uploaded_file(str(src), "x.epub", library_root=None)
            p = Path(dest)
            self.assertEqual(p.parent, uploads.resolve())
            self.assertTrue(p.name.endswith(".epub"))
            self.assertNotEqual(p.name, "x.epub")  # hash 命名
            self.assertTrue(p.is_file())

    def test_transfer_moves_file_and_updates_library(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uploads = root / "uploads"
            lib_root = root / "theology"
            uploads.mkdir()
            lib_root.mkdir()
            src = uploads / ("c" * 64 + ".epub")
            src.write_bytes(b"book-bytes")

            book = SimpleNamespace(
                id="b1",
                title="测试书",
                file_path=str(src),
                file_hash="c" * 64,
                file_format="epub",
                library_id=None,
            )
            library = SimpleNamespace(id="lib1", name="神学", root_path=str(lib_root))

            with (
                patch.object(scan_service.storage, "UPLOAD_DIR", uploads),
            ):
                result = scan_service.transfer_book_file(book, library=library)

            self.assertEqual(result["library_id"], "lib1")
            self.assertTrue(Path(result["file_path"]).is_file())
            self.assertEqual(Path(result["file_path"]).parent, lib_root.resolve())
            self.assertFalse(src.exists())
            self.assertEqual(book.library_id, "lib1")

    def test_transfer_to_unassigned(self):
        from services import scan_service

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            uploads = root / "uploads"
            lib_root = root / "lib"
            uploads.mkdir()
            lib_root.mkdir()
            src = lib_root / "book.epub"
            src.write_bytes(b"abc12345")

            book = SimpleNamespace(
                id="b2",
                title="书",
                file_path=str(src),
                file_hash="d" * 64,
                file_format="epub",
                library_id="lib1",
            )

            with patch.object(scan_service.storage, "UPLOAD_DIR", uploads):
                result = scan_service.transfer_book_file(book, library=None)

            self.assertIsNone(result["library_id"])
            self.assertTrue(str(result["file_path"]).startswith(str(uploads.resolve())))
            self.assertFalse(src.exists())
            self.assertIsNone(book.library_id)


if __name__ == "__main__":
    unittest.main()
