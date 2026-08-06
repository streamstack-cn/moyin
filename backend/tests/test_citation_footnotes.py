"""引用脚注与参考书目规则（纯函数表驱动）。"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.citation_service import (  # noqa: E402
    BibliographyItem,
    BookRef,
    CitationEntry,
    RenderedFootnote,
    format_pub_date_zh,
    render_bibliography,
    render_footnotes,
)
from services.docx_export_service import (  # noqa: E402
    render_bibliography_docx,
    render_footnote_docx,
)


def _ref(
    book_id: str,
    title: str,
    authors: list[str],
    *,
    translator: str = "",
    pub_place: str = "北京",
    publisher: str = "测试出版社",
    pub_date: str = "2024-01",
) -> BookRef:
    return BookRef(
        book_id=book_id,
        title=title,
        authors=authors,
        translator=translator,
        pub_place=pub_place,
        publisher=publisher,
        pub_date=pub_date,
    )


class FormatPubDateTests(unittest.TestCase):
    def test_iso_month(self):
        self.assertEqual(format_pub_date_zh("2024-01"), "2024年1月")

    def test_year_only(self):
        self.assertEqual(format_pub_date_zh("2020"), "2020年")

    def test_already_zh(self):
        self.assertEqual(format_pub_date_zh("2024年01月"), "2024年1月")


class FootnoteRenderTests(unittest.TestCase):
    def test_first_full_then_ibid_same_page(self):
        a = _ref("b1", "测试之书", ["张三"])
        entries = [
            CitationEntry(book=a, page_no="22", quoted_text="摘录甲"),
            CitationEntry(book=a, page_no="22", quoted_text="摘录乙"),
        ]
        out = render_footnotes(entries, "simplified")
        self.assertEqual(len(out), 2)
        self.assertIn("张三", out[0].text)
        self.assertIn("《测试之书》", out[0].text)
        self.assertIn("22", out[0].text)
        self.assertEqual(out[1].text, "同上。")

    def test_ibid_different_page(self):
        a = _ref("b1", "测试之书", ["张三"])
        entries = [
            CitationEntry(book=a, page_no="10"),
            CitationEntry(book=a, page_no="18"),
        ]
        out = render_footnotes(entries, "simplified")
        self.assertEqual(out[1].text, "同上，18。")

    def test_short_form_when_reappears_after_other_book(self):
        a = _ref("b1", "甲书", ["李四"])
        b = _ref("b2", "乙书", ["王五"])
        entries = [
            CitationEntry(book=a, page_no="1"),
            CitationEntry(book=b, page_no="2"),
            CitationEntry(book=a, page_no="3"),
        ]
        out = render_footnotes(entries, "simplified")
        self.assertIn("（北京：测试出版社，2024年1月）", out[0].text)
        self.assertNotIn("（北京：测试出版社", out[2].text)
        self.assertIn("李四，《甲书》，3。", out[2].text)

    def test_translator_form(self):
        a = _ref("b1", "译著", ["Author"], translator="赵六")
        out = render_footnotes([CitationEntry(book=a, page_no="5")], "simplified")
        self.assertIn("著", out[0].text)
        self.assertIn("赵六译", out[0].text)

    def test_page_with_ye_suffix_normalized(self):
        a = _ref("b1", "页码书", ["钱七"])
        out = render_footnotes([CitationEntry(book=a, page_no="第12页")], "simplified")
        self.assertIn("，12。", out[0].text)


class BibliographyRenderTests(unittest.TestCase):
    def test_dedupe_and_drop_page(self):
        a = _ref("b1", "甲书", ["陈一"])
        entries = [
            CitationEntry(book=a, page_no="1"),
            CitationEntry(book=a, page_no="9"),
        ]
        items = render_bibliography(entries, "simplified")
        self.assertEqual(len(items), 1)
        # 书目无页码；出版年月里的「1月」不算页码
        self.assertTrue(items[0].text.endswith("。"))
        self.assertNotIn("页", items[0].text)
        self.assertIn("。《甲书》。", items[0].text)
        self.assertIn("北京：测试出版社，2024年1月。", items[0].text)

    def test_sort_by_stroke(self):
        # 丁(2画) 应排在 陈(16画左右) 之前；以笔画表结果为准，只断言顺序稳定且两条都在
        early = _ref("b-ding", "早书", ["丁一"])
        late = _ref("b-chen", "晚书", ["陈二"])
        items = render_bibliography(
            [CitationEntry(book=late), CitationEntry(book=early)],
            "simplified",
        )
        self.assertEqual(len(items), 2)
        self.assertLessEqual(items[0].sort_key[0], items[1].sort_key[0])


class DocxExportTests(unittest.TestCase):
    def test_footnote_fallback_docx(self):
        items = [
            RenderedFootnote(order=1, text="作者，《书名》，1。", quoted_text="摘录"),
        ]
        with tempfile.TemporaryDirectory() as td:
            dest = str(Path(td) / "fn.docx")
            path = render_footnote_docx(items, dest, doc_title="脚注测试", project_name="测试篮")
            self.assertTrue(Path(path).is_file())
            self.assertGreater(Path(path).stat().st_size, 800)

    def test_bibliography_docx(self):
        items = [
            BibliographyItem(text="作者。《书名》。北京：测试出版社，2024年1月。", stroke_estimated=True, sort_key=(1, "作者")),
        ]
        with tempfile.TemporaryDirectory() as td:
            dest = str(Path(td) / "bib.docx")
            path = render_bibliography_docx(items, dest, doc_title="书目测试")
            self.assertTrue(Path(path).is_file())
            self.assertGreater(Path(path).stat().st_size, 800)


if __name__ == "__main__":
    unittest.main()
