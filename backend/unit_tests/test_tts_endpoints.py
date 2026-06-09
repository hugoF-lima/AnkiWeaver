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

import main
from fastapi import HTTPException


class TestTTSEndpoints(unittest.TestCase):
    def test_voice_preview_returns_media_url_when_synth_succeeds(self):
        with tempfile.TemporaryDirectory() as td:
            media_dir = Path(td)

            def fake_invoke(action, params):
                if action == "getMediaDirPath":
                    return str(media_dir)
                raise AssertionError(f"Unexpected invoke action: {action}")

            with patch("anki.invoke", side_effect=fake_invoke):
                with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "k"}):
                    with patch.object(main, "synth_az_tts_sentence", return_value=True):
                        out = main.voice_preview(main.VoicePreviewRequest(text="hello", voiceName="v"))

        self.assertIn("audioUrl", out)
        self.assertEqual(out.get("voiceName"), "v")

    def test_voice_preview_raises_http_500_when_synth_fails(self):
        def fake_invoke(action, params):
            if action == "getMediaDirPath":
                return "/tmp"
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "k"}):
                with patch.object(main, "synth_az_tts_sentence", return_value=False):
                    with self.assertRaises(HTTPException) as ctx:
                        main.voice_preview(main.VoicePreviewRequest(text="hello", voiceName="v"))
        self.assertEqual(ctx.exception.status_code, 500)

    def test_generate_note_audio_updates_sentence_audio_when_missing(self):
        calls = []

        note = {
            "noteId": 123,
            "modelName": "Model",
            "fields": {
                "Sentence": {"value": "猫です"},
                "SentenceAudio": {"value": ""},
                "Expression": {"value": "猫"},
                "Audio": {"value": ""},
            },
        }

        def fake_invoke(action, params):
            calls.append((action, params))
            if action == "notesInfo":
                return [note]
            if action == "getMediaDirPath":
                return "/tmp"
            if action == "updateNoteFields":
                return None
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "k"}):
                with patch.object(main, "_get_profile_mapping", return_value=None):
                    with patch.object(main, "synth_az_tts_sentence", return_value=True):
                        out = main.generate_note_audio(main.GenerateNoteAudioRequest(noteId=123, voiceName="v", generateSentenceAudio=True, generateExpressionAudio=False))

        self.assertTrue(out.get("ok"))
        self.assertIn("SentenceAudio", out.get("updatedFields", []))
        self.assertTrue(any(a == "updateNoteFields" for a, _ in calls))

    def test_generate_note_audio_rejects_sentence_audio_when_disabled_in_mapping(self):
        note = {"noteId": 123, "modelName": "Model", "fields": {"Sentence": {"value": "猫です"}, "SentenceAudio": {"value": ""}}}

        def fake_invoke(action, params):
            if action == "notesInfo":
                return [note]
            if action == "getMediaDirPath":
                return "/tmp"
            raise AssertionError(f"Unexpected invoke action: {action}")

        with patch("anki.invoke", side_effect=fake_invoke):
            with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "k"}):
                with patch.object(main, "_get_profile_mapping", return_value={"sentence": "Sentence"}):
                    with self.assertRaises(HTTPException) as ctx:
                        main.generate_note_audio(main.GenerateNoteAudioRequest(noteId=123, voiceName="v", generateSentenceAudio=True, generateExpressionAudio=False))

        self.assertEqual(ctx.exception.status_code, 400)

    def test_voice_preview_uses_elevenlabs_when_eleven_voice_selected(self):
        with tempfile.TemporaryDirectory() as td:
            media_dir = Path(td)

            def fake_invoke(action, params):
                if action == "getMediaDirPath":
                    return str(media_dir)
                raise AssertionError(f"Unexpected invoke action: {action}")

            with patch("anki.invoke", side_effect=fake_invoke):
                with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "", "ELEVEN_LABS_SPEECH_KEY": "e"}):
                    with patch.object(main, "synth_az_tts_sentence", return_value=True) as azure_mock:
                        with patch.object(main, "synth_elevenlabs_tts", return_value=True) as eleven_mock:
                            out = main.voice_preview(main.VoicePreviewRequest(text="hello", voiceName="elevenlabs:voice_123"))

        self.assertIn("audioUrl", out)
        self.assertEqual(out.get("voiceName"), "elevenlabs:voice_123")
        azure_mock.assert_not_called()
        eleven_mock.assert_called_once()

    def test_get_tts_voice_prefers_elevenlabs_when_azure_key_missing(self):
        with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "", "ELEVEN_LABS_SPEECH_KEY": "e"}):
            out = main.get_tts_voice()

        self.assertEqual(out.get("defaultVoiceName"), "elevenlabs:EXAVITQu4vr4xnSDxMaL")
        eleven_voice_ids = {voice.get("id") for voice in out.get("voices", []) if voice.get("provider") == "elevenlabs"}
        self.assertEqual(
            eleven_voice_ids,
            {"elevenlabs:EXAVITQu4vr4xnSDxMaL", "elevenlabs:pNInz6obpgDQGcFmaJgB"},
        )

    def test_get_tts_voice_returns_all_supported_azure_voices(self):
        with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "a", "ELEVEN_LABS_SPEECH_KEY": ""}):
            out = main.get_tts_voice()

        azure_voice_ids = {voice.get("id") for voice in out.get("voices", []) if voice.get("provider") == "azure"}
        self.assertEqual(
            azure_voice_ids,
            {
                "azure:ja-JP-NanamiNeural",
                "azure:ja-JP-KeitaNeural",
                "azure:ja-JP-AoiNeural",
                "azure:ja-JP-DaichiNeural",
                "azure:ja-JP-MayuNeural",
                "azure:ja-JP-NaokiNeural",
                "azure:ja-JP-ShioriNeural",
            },
        )

    def test_get_tts_voice_returns_no_models_when_no_tts_keys_exist(self):
        with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "", "ELEVEN_LABS_SPEECH_KEY": ""}):
            out = main.get_tts_voice()

        self.assertEqual(out.get("defaultVoiceName"), "")
        self.assertEqual(out.get("voiceName"), "")
        self.assertEqual(out.get("voices"), [])

    def test_resolve_tts_voice_uses_available_default_when_voice_missing(self):
        with patch.object(main, "_get_active_env", return_value={"AZURE_SPEECH_KEY": "", "ELEVEN_LABS_SPEECH_KEY": "e"}):
            resolved = main._resolve_tts_voice(None)

        self.assertEqual(
            resolved,
            {
                "provider": "elevenlabs",
                "voice_id": "EXAVITQu4vr4xnSDxMaL",
                "voice_name": "elevenlabs:EXAVITQu4vr4xnSDxMaL",
            },
        )
