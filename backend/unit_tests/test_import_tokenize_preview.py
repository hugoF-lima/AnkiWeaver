import sys
import asyncio
from io import BytesIO
from pathlib import Path
import unittest

from starlette.datastructures import UploadFile


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
from unittest.mock import patch


def _upload_file(filename: str, content: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=BytesIO(content))


class TestTokenizePreviewImportFailures(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        loop = asyncio.get_running_loop()
        loop.set_debug(False)
        try:
            loop.slow_callback_duration = 60.0
        except Exception:
            pass

    async def test_rejects_unsupported_file_type(self):
        file = _upload_file("data.pdf", b"pdf")
        with self.assertRaises(HTTPException) as ctx:
            await main.tokenize_preview(deckName="Deck", file=file, columnMapping=None, csvDelimiter=None)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Only .csv, .txt, and .json are supported", str(ctx.exception.detail))

    async def test_txt_empty_returns_empty_payload(self):
        file = _upload_file("data.txt", b"")
        out = await main.tokenize_preview(deckName="Deck", file=file, columnMapping=None, csvDelimiter=None)
        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("rows"), [])
        self.assertEqual(out.get("total"), 0)
        self.assertEqual(out.get("duplicateCount"), 0)

    async def test_csv_without_inferable_vocab_column_returns_400(self):
        csv_bytes = b"a,b\n1,2\n3,4\n"
        file = _upload_file("data.csv", csv_bytes)
        with self.assertRaises(HTTPException) as ctx:
            await main.tokenize_preview(deckName="Deck", file=file, columnMapping=None, csvDelimiter=None)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Could not infer vocab column", str(ctx.exception.detail))

    async def test_csv_causareta_appears_as_lemma_moyosu_in_preview(self):
        csv_bytes = "Expression\n催された\n".encode("utf-8")
        file = _upload_file("data.csv", csv_bytes)
        with patch("anki.invoke", return_value=[]):
            out = await main.tokenize_preview(deckName="Deck", file=file, columnMapping=None, csvDelimiter=None)
        rows = out.get("rows") or []
        entries = {r.get("entry") for r in rows}
        self.assertIn("催す", entries)
