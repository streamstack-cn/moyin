"""书名清洗与豆瓣候选打分。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.book_match import (  # noqa: E402
    parse_book_title,
    pick_best_candidate,
    rank_candidates,
    score_candidate,
)


class BookTitleParseTests(unittest.TestCase):
    def test_strip_turing_series_bracket(self):
        p = parse_book_title("[图灵原创].深入React技术栈")
        self.assertEqual(p.title, "深入React技术栈")
        self.assertIn("图灵原创", p.series_tags)
        self.assertEqual(p.queries[0], "深入React技术栈")

    def test_strip_turing_programming_series(self):
        p = parse_book_title("[图灵程序设计丛书].Python机器学习基础教程.pdf")
        self.assertEqual(p.title, "Python机器学习基础教程")

    def test_matumoto_turing_series_with_title_marks(self):
        p = parse_book_title("《[图灵程序设计丛书].松本行弘：编程语言的设计与实现》")
        self.assertEqual(p.title, "编程语言的设计与实现")
        self.assertEqual(p.authors, ["松本行弘"])
        self.assertIn("图灵程序设计丛书", p.series_tags)
        self.assertEqual(p.queries[0], "编程语言的设计与实现")
        self.assertIn("编程语言的设计与实现 松本行弘", p.queries)

    def test_author_colon_title(self):
        p = parse_book_title("松本行弘：编程语言的设计与实现")
        self.assertEqual(p.title, "编程语言的设计与实现")
        self.assertEqual(p.authors, ["松本行弘"])

    def test_short_chinese_title_with_author(self):
        p = parse_book_title("王小波：黄金时代")
        self.assertEqual(p.title, "黄金时代")
        self.assertEqual(p.authors, ["王小波"])

    def test_strip_book_title_marks(self):
        p = parse_book_title("《编程语言的设计与实现》")
        self.assertEqual(p.title, "编程语言的设计与实现")

    def test_strip_scan_junk(self):
        p = parse_book_title("人类简史（扫描版）")
        self.assertEqual(p.title, "人类简史")

    def test_keep_meaningful_title_with_year_hint(self):
        p = parse_book_title("深入React技术栈", year_hint="2016")
        self.assertEqual(p.title, "深入React技术栈")
        self.assertEqual(p.year, "2016")
        self.assertIn("深入React技术栈 2016", p.queries)


class BookScoreTests(unittest.TestCase):
    def test_prefers_exact_clean_title(self):
        candidates = [
            {"title": "React 设计模式", "year": "2018", "publisher": "电子工业出版社", "rating": 7.0},
            {"title": "深入React技术栈", "year": "2016", "publisher": "人民邮电出版社", "rating": 8.2},
            {"title": "React 进阶之路", "year": "2016", "publisher": "人民邮电出版社", "rating": 7.5},
        ]
        best = pick_best_candidate(
            candidates,
            title="深入React技术栈",
            year="2016",
            publisher="人民邮电出版社",
        )
        self.assertIsNotNone(best)
        self.assertEqual(best["title"], "深入React技术栈")

    def test_year_and_publisher_break_ties(self):
        candidates = [
            {"title": "推荐系统实践", "year": "2012", "publisher": "人民邮电出版社", "rating": 8.0},
            {"title": "推荐系统实践", "year": "2018", "publisher": "电子工业出版社", "rating": 7.0},
        ]
        best = pick_best_candidate(
            candidates,
            title="推荐系统实践",
            year="2012",
            publisher="人民邮电出版社",
        )
        self.assertEqual(best["year"], "2012")
        self.assertGreater(
            score_candidate(candidates[0], title="推荐系统实践", year="2012", publisher="人民邮电出版社"),
            score_candidate(candidates[1], title="推荐系统实践", year="2012", publisher="人民邮电出版社"),
        )

    def test_reject_low_confidence(self):
        candidates = [
            {"title": "完全不相关的书", "year": "1999", "publisher": "某某社", "rating": 5.0},
        ]
        best = pick_best_candidate(candidates, title="深入React技术栈", year="2016")
        self.assertIsNone(best)

    def test_rank_puts_best_first(self):
        ranked = rank_candidates(
            [
                {"title": "React 进阶之路", "year": "2016", "publisher": "", "rating": 7.0},
                {"title": "深入React技术栈", "year": "2016", "publisher": "人民邮电出版社", "rating": 8.0},
            ],
            title="深入React技术栈",
            year="2016",
            publisher="人民邮电出版社",
        )
        self.assertEqual(ranked[0]["title"], "深入React技术栈")

    def test_short_prefix_not_outrank_full_title(self):
        """「磐石」不得压过「磐石上的婚姻」。"""
        ranked = rank_candidates(
            [
                {"title": "磐石", "authors": ["某人"], "rating": 9.0},
                {"title": "婚姻", "rating": 8.0},
                {"title": "磐石上的婚姻", "authors": ["拉里·克雷伯"], "rating": 8.5},
                {"title": "磐石之上", "rating": 7.0},
            ],
            title="磐石上的婚姻",
        )
        self.assertEqual(ranked[0]["title"], "磐石上的婚姻")
        full = score_candidate({"title": "磐石上的婚姻"}, title="磐石上的婚姻")
        short = score_candidate({"title": "磐石", "rating": 9.0}, title="磐石上的婚姻")
        self.assertGreater(full, short)

    def test_year_cannot_promote_unrelated_journal(self):
        """标题无关时年份加权不应超过同名书（豆瓣侧打分）。"""
        ranked = rank_candidates(
            [
                {"title": "中国社会科学院研究生院学报", "year": "2009", "rating": 0},
                {"title": "如何认识和提升自己", "authors": ["邝炳钊"], "year": "2009", "rating": 0},
                {"title": "职业时空", "year": "2009", "rating": 0},
            ],
            title="如何认识和提升自己",
            year="2009",
        )
        self.assertEqual(ranked[0]["title"], "如何认识和提升自己")

    def test_author_helps_pick(self):
        candidates = [
            {
                "title": "编程语言的设计与实现",
                "authors": ["某人"],
                "year": "2020",
                "publisher": "人民邮电出版社",
                "rating": 7.0,
            },
            {
                "title": "编程语言的设计与实现",
                "authors": ["松本行弘"],
                "year": "2021",
                "publisher": "人民邮电出版社",
                "rating": 8.5,
            },
        ]
        best = pick_best_candidate(
            candidates,
            title="编程语言的设计与实现",
            authors=["松本行弘"],
            publisher="人民邮电出版社",
        )
        self.assertEqual(best["authors"], ["松本行弘"])


if __name__ == "__main__":
    unittest.main()
