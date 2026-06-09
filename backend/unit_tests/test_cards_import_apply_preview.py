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


class TestCardsImportApplyAndPreview(unittest.TestCase):
    def test_cards_import_preview_matches_existing_expression(self):
        notes = [
            {"noteId": 1, "fields": {"Expression": {"value": "猫"}}},
            {"noteId": 2, "fields": {"Expression": {"value": "犬"}}},
        ]
        with patch.object(main, "_get_deck_notes_info", return_value=notes):
            req = main.ImportRecordsRequest(deckName="Deck", records=[{"Expression": "猫", "Sentence": "猫です", "SentenceTranslation": "cat"}])
            out = main.cards_import_preview(req)

        matches = out.get("matches") or []
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["noteId"], 1)
        self.assertEqual(matches[0]["word"], "猫")
        self.assertEqual(out.get("notFoundCount"), 0)

    def test_cards_import_apply_builds_multi_update_actions_and_wraps_sound(self):
        notes = [
            {"noteId": 1, "modelName": "Model", "fields": {"Expression": {"value": "猫"}, "Sentence": {"value": ""}, "SentenceTranslation": {"value": ""}, "SentenceAudio": {"value": ""}}},
        ]
        invoked = []

        def fake_invoke(action, params):
            invoked.append((action, params))
            return None

        with patch.object(main, "_get_deck_notes_info", return_value=notes):
            with patch.object(main, "_get_profile_mapping", return_value={"expression": "Expression", "sentence": "Sentence", "translation": "SentenceTranslation", "sentence_audio": "SentenceAudio"}):
                with patch("anki.invoke", side_effect=fake_invoke):
                    req = main.ImportRecordsRequest(
                        deckName="Deck",
                        records=[
                            {"Expression": "猫", "Sentence": "猫です", "SentenceTranslation": "cat", "SentenceAudio": "x.mp3"},
                            {"Expression": "missing", "Sentence": "nope"},
                        ],
                    )
                    out = main.cards_import_apply(req)

        self.assertEqual(out.get("updated"), 1)
        self.assertEqual(out.get("notFoundCount"), 1)
        multi_call = next((p for a, p in invoked if a == "multi"), None)
        self.assertIsNotNone(multi_call)
        actions = multi_call.get("actions") or []
        self.assertEqual(len(actions), 1)
        fields = actions[0]["params"]["note"]["fields"]
        self.assertEqual(fields["Sentence"], "猫です")
        self.assertEqual(fields["SentenceTranslation"], "cat")
        self.assertEqual(fields["SentenceAudio"], "[sound:x.mp3]")

