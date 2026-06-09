import sys
from pathlib import Path
import unittest
from unittest.mock import patch, Mock


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

UNIT_TESTS_DIR = Path(__file__).resolve().parent
if str(UNIT_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(UNIT_TESTS_DIR))

import stubs

stubs.install()

import requests
import anki
import main


class TestAnkiConnectInvoke(unittest.TestCase):
    def test_invoke_request_exception_becomes_runtime_error(self):
        with patch("requests.post", side_effect=requests.RequestException("boom")):
            with self.assertRaises(RuntimeError) as ctx:
                anki.invoke("deckNames", {})
        self.assertIn("AnkiConnect request failed", str(ctx.exception))

    def test_invoke_invalid_json_becomes_runtime_error(self):
        class Resp:
            status_code = 500
            text = "<html>bad</html>"

            def json(self):
                raise ValueError("no json")

        with patch("requests.post", return_value=Resp()):
            with self.assertRaises(RuntimeError) as ctx:
                anki.invoke("deckNames", {})
        self.assertIn("invalid JSON", str(ctx.exception))

    def test_update_note_audio_id_triggers_store_media(self):
        calls = []

        def fake_invoke(action, params):
            calls.append((action, params))
            return None

        with patch.object(anki, "invoke", side_effect=fake_invoke):
            out = anki.update_note(
                note_id=123,
                sentence_audio=None,
                audio_id="tatoeba_12345.mp3",
            )

        self.assertTrue(out.get("ok"))
        self.assertTrue(any(c[0] == "storeMediaFile" for c in calls))
        self.assertTrue(any(c[0] == "updateNoteFields" for c in calls))
        store_call = next(c for c in calls if c[0] == "storeMediaFile")
        self.assertEqual(store_call[1]["filename"], "tatoeba_12345.mp3")
        self.assertIn("/12345", store_call[1]["url"])

    def test_open_browse_dedupes_and_truncates(self):
        invoked = []

        def fake_invoke(action, params=None):
            invoked.append((action, params))
            return None

        ids = list(range(1, 601)) + [5, 5, 6]
        req = main.OpenBrowseRequest(noteIds=ids)
        with patch.object(anki, "invoke", side_effect=fake_invoke):
            out = main.open_notes_in_browser(req)

        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("opened"), 500)
        self.assertEqual(out.get("totalRequested"), 600)
        self.assertTrue(out.get("truncated"))
        self.assertTrue(any(a == "guiBrowse" for a, _ in invoked))
