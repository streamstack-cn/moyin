"""引用篮 API 链路冒烟：项目 → 条目规则渲染 → docx 导出文件。

不依赖 TestClient / 实库，锁住「入篮后能导出」的核心闭合路径。
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.citation_service import BookRef, CitationEntry, render_footnotes  # noqa: E402
from services.docx_export_service import render_footnote_docx  # noqa: E402


class CitationExportSmokeTests(unittest.TestCase):
    def test_two_items_same_book_export_docx(self):
        book = BookRef(
            book_id="smoke-book",
            title="冒烟测试书",
            authors=["测试作者"],
            pub_place="北京",
            publisher="冒烟社",
            pub_date="2024-05",
        )
        entries = [
            CitationEntry(book=book, page_no="3", quoted_text="第一句摘录"),
            CitationEntry(book=book, page_no="3", quoted_text="第二句摘录"),
        ]
        rendered = render_footnotes(entries, "simplified")
        self.assertEqual(len(rendered), 2)
        self.assertEqual(rendered[1].text, "同上。")

        with tempfile.TemporaryDirectory() as td:
            dest = str(Path(td) / "smoke-footnotes.docx")
            out = render_footnote_docx(
                rendered,
                dest,
                doc_title="冒烟脚注",
                project_name="冒烟篮",
            )
            path = Path(out)
            self.assertTrue(path.is_file())
            self.assertGreater(path.stat().st_size, 500)


if __name__ == "__main__":
    unittest.main()
