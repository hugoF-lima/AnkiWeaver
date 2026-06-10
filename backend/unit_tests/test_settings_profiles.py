import io
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch, Mock
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


class TestSettingsProfiles(unittest.TestCase):
    def test_profiles_round_trip_save_and_get(self):
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "profiles.json"
            env_path = Path(td) / ".env"
            env_path.write_text('DEEPL_AUTH_KEY="x"\n', encoding="utf-8")

            store = {
                "activeProfileId": "default",
                "profiles": {
                    "default": {
                        "name": "Default",
                        "env": {"DEEPL_AUTH_KEY": "k"},
                        "languageOverride": "auto",
                        "selectedNoteType": "",
                        "databasePath": "/tmp/custom.db",
                        "mappings": {},
                    }
                },
            }

            with patch.object(main, "settings_path", settings_path):
                with patch.object(main, "env_path", env_path):
                    out = main.save_profiles(store)
                    self.assertTrue(out.get("ok"))
                    got = main.get_profiles()
                    self.assertEqual(got.get("activeProfileId"), "default")
                    self.assertIn("profiles", got)
                    self.assertEqual(got["profiles"]["default"]["env"]["DEEPL_AUTH_KEY"], "k")
                    self.assertEqual(got["profiles"]["default"]["databasePath"], "/tmp/custom.db")

    def test_set_active_profile_rejects_unknown_profile(self):
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "profiles.json"
            settings_path.write_text('{"activeProfileId":"default","profiles":{"default":{"name":"Default","env":{},"languageOverride":"auto","selectedNoteType":"","mappings":{}}}}', encoding="utf-8")

            with patch.object(main, "settings_path", settings_path):
                with self.assertRaises(HTTPException) as ctx:
                    main.set_active_profile(main.ActiveProfileRequest(profileId="missing"))
                self.assertEqual(ctx.exception.status_code, 404)

    def test_set_env_persists_in_active_profile_and_get_env_returns_it(self):
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "profiles.json"
            settings_path.write_text('{"activeProfileId":"default","profiles":{"default":{"name":"Default","env":{},"languageOverride":"auto","selectedNoteType":"","mappings":{}}}}', encoding="utf-8")
            env_path = Path(td) / ".env"
            env_path.write_text("", encoding="utf-8")

            with patch.object(main, "settings_path", settings_path):
                with patch.object(main, "env_path", env_path):
                    payload = main.EnvPayload(AZURE_SPEECH_KEY="a", DEEPL_AUTH_KEY="d", ELEVEN_LABS_SPEECH_KEY="e")
                    out = main.set_env(payload)
                    self.assertTrue(out.get("ok"))
                    got = main.get_env()
                    self.assertEqual(got["AZURE_SPEECH_KEY"], "a")
                    self.assertEqual(got["DEEPL_AUTH_KEY"], "d")
                    self.assertEqual(got["ELEVEN_LABS_SPEECH_KEY"], "e")

    def test_get_env_does_not_carry_keys_between_profiles(self):
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "profiles.json"
            settings_path.write_text(
                '{"activeProfileId":"secondary","profiles":{"default":{"name":"Default","env":{"AZURE_SPEECH_KEY":"azure-default","DEEPL_AUTH_KEY":"deepl-default","ELEVEN_LABS_SPEECH_KEY":"eleven-default"},"languageOverride":"auto","selectedNoteType":"","mappings":{}},"secondary":{"name":"Secondary","env":{"AZURE_SPEECH_KEY":"","DEEPL_AUTH_KEY":"deepl-secondary","ELEVEN_LABS_SPEECH_KEY":""},"languageOverride":"auto","selectedNoteType":"","mappings":{}}}}',
                encoding="utf-8",
            )
            env_path = Path(td) / ".env"
            env_path.write_text('AZURE_SPEECH_KEY="dotenv-azure"\nDEEPL_AUTH_KEY="dotenv-deepl"\n', encoding="utf-8")

            with patch.object(main, "settings_path", settings_path):
                with patch.object(main, "env_path", env_path):
                    got = main.get_env()
                    self.assertEqual(got["AZURE_SPEECH_KEY"], "")
                    self.assertEqual(got["DEEPL_AUTH_KEY"], "deepl-secondary")
                    self.assertEqual(got["ELEVEN_LABS_SPEECH_KEY"], "")

    def test_validate_key_unknown_provider(self):
        out = main.validate_key(main.ValidateKeyRequest(provider="NOPE", key="k"))
        self.assertFalse(out.get("ok"))

    def test_get_active_database_path_prefers_profile_value(self):
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "profiles.json"
            settings_path.write_text(
                '{"activeProfileId":"default","profiles":{"default":{"name":"Default","env":{},"languageOverride":"auto","selectedNoteType":"","databasePath":"/tmp/custom.db","mappings":{}}}}',
                encoding="utf-8",
            )

            with patch.object(main, "settings_path", settings_path):
                self.assertEqual(main._get_active_database_path(), "/tmp/custom.db")

    def test_get_active_database_path_falls_back_to_default_relative_path(self):
        with tempfile.TemporaryDirectory() as td:
            settings_path = Path(td) / "profiles.json"
            settings_path.write_text(
                '{"activeProfileId":"default","profiles":{"default":{"name":"Default","env":{},"languageOverride":"auto","selectedNoteType":"","databasePath":"","mappings":{}}}}',
                encoding="utf-8",
            )
            fake_root = Path(td)
            fake_default = fake_root / "backend" / "data" / "tatoeba-multi-lang.db"
            fake_default.parent.mkdir(parents=True, exist_ok=True)
            fake_default.write_text("", encoding="utf-8")

            with patch.object(main, "settings_path", settings_path):
                with patch.object(main, "PROJECT_ROOT", fake_root):
                    with patch("sentences.get_default_db_path", return_value=fake_default):
                        self.assertEqual(main._get_active_database_path(), "backend/data/tatoeba-multi-lang.db")

    def test_upload_database_file_stores_file_in_project_data_dir(self):
        with tempfile.TemporaryDirectory() as td:
            fake_root = Path(td)
            (fake_root / "backend" / "data").mkdir(parents=True)
            upload = UploadFile(filename="custom.sqlite", file=io.BytesIO(b"sqlite-bytes"))

            with patch.object(main, "PROJECT_ROOT", fake_root):
                out = self._run_async(main.upload_database_file(upload))

            saved_path = fake_root / out["databasePath"]
            self.assertTrue(saved_path.exists())
            self.assertEqual(saved_path.read_bytes(), b"sqlite-bytes")
            self.assertTrue(out["databasePath"].startswith("backend/data/imported_databases/"))

    def _run_async(self, coro):
        try:
            import asyncio
            return asyncio.run(coro)
        except RuntimeError:
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(coro)
            finally:
                loop.close()

    def test_validate_key_deepl_success(self):
        ok_resp = Mock()
        ok_resp.status_code = 200
        ok_resp.text = "ok"

        with patch("requests.get", return_value=ok_resp) as get_mock:
            out = main.validate_key(main.ValidateKeyRequest(provider="DEEPL", key="abc:fx"))

        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("status"), 200)
        self.assertTrue(get_mock.called)

    def test_migrate_legacy_store_converts_legacy_mappings(self):
        # legacy store format: dict of modelName -> list(mapping entries)
        legacy = {
            "ModelA": [
                {"anki_field": "Expression", "internal_field": "expression", "active": True}
            ],
            "ModelB": [],
        }

        out = main._migrate_legacy_store(legacy)
        # Should create a default profile wrapping the legacy mappings
        self.assertIn("profiles", out)
        profiles = out.get("profiles") or {}
        self.assertIn("default", profiles)
        default = profiles.get("default") or {}
        self.assertIn("mappings", default)
        self.assertEqual(default.get("mappings"), legacy)

    def test_to_project_relative_path_inside_and_outside_project(self):
        with tempfile.TemporaryDirectory() as td:
            fake_root = Path(td) / "projroot"
            fake_root.mkdir()

            inside = fake_root / "backend" / "data" / "db.sqlite"
            inside.parent.mkdir(parents=True, exist_ok=True)
            inside.write_text("x", encoding="utf-8")

            outside = Path(td) / "external" / "other.sqlite"
            outside.parent.mkdir(parents=True, exist_ok=True)
            outside.write_text("y", encoding="utf-8")

            with patch.object(main, "PROJECT_ROOT", fake_root):
                rel = main._to_project_relative_path(inside)
                self.assertEqual(rel, inside.resolve().relative_to(fake_root).as_posix())

                abs_path = main._to_project_relative_path(outside)
                self.assertEqual(abs_path, str(outside.resolve()))
