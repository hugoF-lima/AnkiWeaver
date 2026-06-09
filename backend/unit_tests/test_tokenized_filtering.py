import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

UNIT_TESTS_DIR = Path(__file__).resolve().parent
if str(UNIT_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(UNIT_TESTS_DIR))

import stubs

stubs.install()

from freq_tokenization.tokenized_filtering import (
    TokenEntry,
    _katakana_to_hiragana,
    build_token_table,
    build_token_table_from_csv,
    build_token_table_from_json,
    filter_tokens,
)


class TestTokenizedFiltering(unittest.TestCase):
    def test_csv_sniffer_failure_falls_back_to_comma(self):
        csv_text = "Expression,Reading,Glossary\n猫,ねこ,cat\n"
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".csv", encoding="utf-8") as f:
            f.write(csv_text)
            path = f.name
        try:
            with patch("csv.Sniffer.sniff", side_effect=Exception("sniff failed")):
                tokens = build_token_table_from_csv(path, vocab_column="Expression", kana_column="Reading", translation_column="Glossary")
            self.assertTrue(any(t.surface == "猫" for t in tokens))
        finally:
            Path(path).unlink(missing_ok=True)

    def test_csv_header_by_name_equals_no_header_by_index(self):
        header_csv = "Expression,Reading,Glossary\n猫,ねこ,cat\n犬,いぬ,dog\n"
        no_header_csv = "猫,ねこ,cat\n犬,いぬ,dog\n"
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".csv", encoding="utf-8") as f1:
            f1.write(header_csv)
            p1 = f1.name
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".csv", encoding="utf-8") as f2:
            f2.write(no_header_csv)
            p2 = f2.name
        try:
            tokens_by_name = build_token_table_from_csv(p1, vocab_column="Expression", kana_column="Reading", translation_column="Glossary")
            tokens_by_idx = build_token_table_from_csv(p2, vocab_column=0, kana_column=1, translation_column=2)
            a = sorted([(t.surface, t.kana, t.translation) for t in tokens_by_name])
            b = sorted([(t.surface, t.kana, t.translation) for t in tokens_by_idx])
            self.assertEqual(a, b)
        finally:
            Path(p1).unlink(missing_ok=True)
            Path(p2).unlink(missing_ok=True)

    def test_build_token_table_counts_occurrences_for_lemma(self):
        text = "催された。催された。"
        tokens = build_token_table(text)
        by_lemma = {t.dictionary_form: t for t in tokens}
        self.assertIn("催す", by_lemma)
        self.assertEqual(by_lemma["催す"].occurrences, 2)

    def test_katakana_to_hiragana(self):
        self.assertEqual(_katakana_to_hiragana("カタカナ"), "かたかな")
        self.assertEqual(_katakana_to_hiragana("テストー"), "てすとー")

    def test_filter_tokens_remove_katakana_only(self):
        kata = TokenEntry(surface="カタカナ", dictionary_form="カタカナ", reading="カタカナ", pos="名詞", occurrences=1)
        kanji = TokenEntry(surface="日本語", dictionary_form="日本語", reading="ニホンゴ", pos="名詞", occurrences=1)
        out = filter_tokens([kata, kanji], remove_katakana=True, tag_tokens=False)
        lemmas = {t.dictionary_form for t in out}
        self.assertIn("日本語", lemmas)
        self.assertNotIn("カタカナ", lemmas)

    def test_json_invalid_raises(self):
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as f:
            f.write("{not json")
            p = f.name
        try:
            with self.assertRaises(Exception):
                build_token_table_from_json(p)
        finally:
            Path(p).unlink(missing_ok=True)

    def test_json_dotted_path_mapping_extracts_fields(self):
        data = {"items": [{"expression": "猫", "reading": "ねこ", "glossary": "cat"}]}
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json", encoding="utf-8") as f:
            import json

            json.dump(data, f, ensure_ascii=False)
            p = f.name
        try:
            tokens = build_token_table_from_json(
                p,
                mapping={
                    "expression": "items.expression",
                    "reading": "items.reading",
                    "glossary": "items.glossary",
                },
            )
            self.assertTrue(any(t.surface == "猫" and t.kana == "ねこ" and t.translation == "cat" for t in tokens))
        finally:
            Path(p).unlink(missing_ok=True)
