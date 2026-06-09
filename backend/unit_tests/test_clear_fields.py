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


class TestClearFields(unittest.TestCase):
    def test_clear_sentence_fields_clears_only_existing_fields(self):
        calls = []

        note = {"noteId": 1, "fields": {"Sentence": {"value": "x"}, "SentenceAudio": {"value": "[sound:a.mp3]"}}}

        def fake_invoke(action, params):
            calls.append((action, params))
            if action == "notesInfo":
                return [note]
            if action == "updateNoteFields":
                return None
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            out = main.clear_sentence_fields(1, main.ClearFieldsRequest(fields=["Sentence", "MissingField"]))

        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("cleared"), ["Sentence"])
        update = next(p for a, p in calls if a == "updateNoteFields")
        self.assertEqual(update["note"]["fields"]["Sentence"], "")

    def test_clear_sentence_fields_note_not_found_returns_404(self):
        def fake_invoke(action, params):
            if action == "notesInfo":
                return []
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with self.assertRaises(HTTPException) as ctx:
                main.clear_sentence_fields(1, main.ClearFieldsRequest(fields=["Sentence"]))

        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("Note not found in Anki", str(ctx.exception.detail))
