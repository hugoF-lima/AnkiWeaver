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


class TestNotesListingAndFiltering(unittest.TestCase):
    def test_get_notes_builds_missing_audio_regex_query_using_mapping(self):
        calls = []

        mapping = {"sentence_audio": "MySentenceAudio", "sentence": "MySentence", "translation": "MyTranslation", "expression": "Expression"}

        def fake_invoke(action, params):
            calls.append((action, params))
            if action == "findNotes":
                q = params.get("query") or ""
                if q == 'deck:"Deck"':
                    return [10]
                return [1, 2, 3]
            if action == "notesInfo":
                notes = params.get("notes") or []
                if notes == [10]:
                    return [{"noteId": 10, "modelName": "Model", "fields": {"MySentenceAudio": {"value": ""}}}]
                out = []
                for nid in notes:
                    out.append({"noteId": nid, "fields": {"Expression": {"value": f"w{nid}"}}})
                return out
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_profile_mapping", return_value=mapping):
                out = main.get_notes(deck="Deck", limit=50, offset=0, sort="most_recent", filters="missing_audio")

        find_calls = [c for c in calls if c[0] == "findNotes"]
        self.assertGreaterEqual(len(find_calls), 2)
        query = find_calls[-1][1]["query"]
        self.assertIn('deck:"Deck"', query)
        self.assertIn('-"MySentenceAudio:re:\\[sound:"', query)
        self.assertIn("notes", out)
        self.assertEqual(out["total"], 3)

    def test_get_notes_sort_most_recent_orders_by_note_id_desc(self):
        calls = []
        find_count = {"n": 0}

        def fake_invoke(action, params):
            calls.append((action, params))
            if action == "findNotes":
                q = params.get("query") or ""
                if q == 'deck:"Deck"' and find_count["n"] == 0:
                    find_count["n"] += 1
                    return [9]
                if q == 'deck:"Deck"' and find_count["n"] == 1:
                    find_count["n"] += 1
                    return [3, 1, 2]
                return [3, 1, 2]
            if action == "notesInfo":
                notes = params.get("notes") or []
                if notes == [9]:
                    return [{"noteId": 9, "modelName": "Model", "fields": {"Expression": {"value": "x"}}}]
                return [{"noteId": nid, "fields": {"Expression": {"value": f"w{nid}"}}} for nid in notes]
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_profile_mapping", return_value={"expression": "Expression"}):
                out = main.get_notes(deck="Deck", limit=50, offset=0, sort="most_recent", filters="")

        ids = [n["noteId"] for n in out["notes"]]
        self.assertEqual(ids, [3, 2, 1])

    def test_get_notes_sort_asc_uses_expression_field(self):
        calls = []
        find_count = {"n": 0}

        mapping = {"expression": "Expression"}

        def fake_invoke(action, params):
            calls.append((action, params))
            if action == "findNotes":
                q = params.get("query") or ""
                if q == 'deck:"Deck"' and find_count["n"] == 0:
                    find_count["n"] += 1
                    return [99]
                if q == 'deck:"Deck"' and find_count["n"] == 1:
                    find_count["n"] += 1
                    return [1, 2, 3]
                return [1, 2, 3]
            if action == "notesInfo":
                notes = params.get("notes") or []
                if notes == [99]:
                    return [{"noteId": 99, "modelName": "Model", "fields": {"Expression": {"value": "x"}}}]
                payload = {
                    1: {"noteId": 1, "fields": {"Expression": {"value": "b"}}},
                    2: {"noteId": 2, "fields": {"Expression": {"value": "a"}}},
                    3: {"noteId": 3, "fields": {"Expression": {"value": "c"}}},
                }
                return [payload[int(n)] for n in notes]
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_profile_mapping", return_value=mapping):
                out = main.get_notes(deck="Deck", limit=50, offset=0, sort="asc", filters="")

        ids = [n["noteId"] for n in out["notes"]]
        self.assertEqual(ids, [2, 1, 3])

    def test_get_note_ids_contains_audio_query_uses_regex(self):
        calls = []

        mapping = {"sentence_audio": "SentenceAudio", "expression": "Expression"}

        def fake_invoke(action, params):
            calls.append((action, params))
            if action == "findNotes":
                q = params.get("query") or ""
                if q == 'deck:"Deck"':
                    return [7]
                return [11, 12]
            if action == "notesInfo":
                notes = params.get("notes") or []
                return [{"noteId": notes[0], "modelName": "Model", "fields": {"SentenceAudio": {"value": ""}}}]
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_profile_mapping", return_value=mapping):
                out = main.get_note_ids(deck="Deck", limit=500, offset=0, sort="most_recent", filters="contains_audio")

        find_calls = [c for c in calls if c[0] == "findNotes"]
        query = find_calls[-1][1]["query"]
        self.assertIn('"SentenceAudio:re:\\[sound:', query)
        self.assertEqual(out["noteIds"], [12, 11])

    def test_get_notes_empty_deck_returns_empty_payload(self):
        def fake_invoke(action, params):
            if action == "findNotes":
                return []
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            out = main.get_notes(deck="Deck", limit=50, offset=0, sort="most_recent", filters="")

        self.assertEqual(out["notes"], [])
        self.assertEqual(out["total"], 0)
        self.assertIsNone(out["mapping"])

    def test_get_note_ids_empty_deck_returns_empty_payload(self):
        def fake_invoke(action, params):
            if action == "findNotes":
                return []
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            out = main.get_note_ids(deck="Deck", limit=500, offset=0, sort="most_recent", filters="")

        self.assertEqual(out["noteIds"], [])
        self.assertEqual(out["total"], 0)
        self.assertIsNone(out["mapping"])
