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


class TestDeepLFailures(unittest.TestCase):
    def test_translate_sentence_rejects_missing_key(self):
        with patch.object(main, "_get_active_env", return_value={}):
            with self.assertRaises(HTTPException) as ctx:
                main.translate_sentence("123", main.TranslateRequest(text="hello", target_lang="en-US"))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertIn("DEEPL_AUTH_KEY", str(ctx.exception.detail))
