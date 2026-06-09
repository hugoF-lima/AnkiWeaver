import sys
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

import main
from fastapi import HTTPException


class TestSentencesEndpoints(unittest.TestCase):
    def test_get_sentences_returns_results_from_sentences_module(self):
        expected = [{"jp": "猫です", "en": "It is a cat", "pt": "É um gato", "has_audio": False, "audio_id": None}]
        with patch("sentences.search_sentences", return_value=expected) as search_mock:
            out = main.get_sentences(word="猫", page=0, per_page=10, random=False)
        self.assertEqual(out, expected)
        self.assertEqual(search_mock.call_args.kwargs["db_path"], main._get_active_database_path())

    def test_get_sentences_error_becomes_http_500(self):
        with patch("sentences.search_sentences", side_effect=RuntimeError("db down")):
            with self.assertRaises(HTTPException) as ctx:
                main.get_sentences(word="猫", page=0, per_page=10, random=False)
        self.assertEqual(ctx.exception.status_code, 500)

    def test_get_sentences_batch_dedupes_words_and_continues_on_individual_errors(self):
        def fake_search(word, page=0, per_page=1, randomize=False, db_path=""):
            if word == "bad":
                raise RuntimeError("fail")
            return [{"jp": f"{word}JP", "en": f"{word}EN", "pt": f"{word}PT", "has_audio": True, "audio_id": "1"}]

        with patch("sentences.search_sentences", side_effect=fake_search) as search_mock:
            out = main.get_sentences_batch(main.BatchSentencesRequest(words=["ok", "ok", "bad"], per_word=1, random=False))

        self.assertTrue(out.get("ok"))
        results = out.get("results") or []
        self.assertEqual(len(results), 2)
        by_word = {r["word"]: r for r in results}
        self.assertIn("ok", by_word)
        self.assertIn("bad", by_word)
        self.assertIn("error", by_word["bad"])
        for call in search_mock.call_args_list:
            self.assertEqual(call.kwargs["db_path"], main._get_active_database_path())
