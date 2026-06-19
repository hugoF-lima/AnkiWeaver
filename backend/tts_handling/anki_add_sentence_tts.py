import os
from pathlib import Path
from tqdm import tqdm
import base64
import tempfile

# Assuming your local modules are structured like this
import anki
from tts_handling.audio_fetcher_azure import synth_az_tts_sentence
from tts_handling.sentence_detector import is_sentence


class AnkiAddSentenceTTS:
    def __init__(self):
        # No longer rely on local media dir; we'll upload via AnkiConnect
        pass

    def insert_tts_audio(self, deck_name: str):
        """
        Main method to fetch missing TTS audio for a specific deck.
        Uses AnkiConnect's `storeMediaFile` to upload audio, avoiding
        local media-dir path assumptions and permission issues.
        """
        print(f"--- Starting TTS Sync for Deck: {deck_name} ---")

        notes = anki.find_notes_by_deck(deck_name)
        notes_info = anki.notes_info(notes)

        for note in tqdm(notes_info, desc=f"Processing {deck_name}"):
            note_id = note["noteId"]
            fields = note["fields"]

            sentence = fields.get("Sentence", {}).get("value", "").strip()
            sentence_audio = fields.get("SentenceAudio", {}).get("value", "").strip()

            if not sentence or sentence_audio or not is_sentence(sentence):
                continue

            filename = f"azure_{note_id}.mp3"

            # Generate audio into a temporary file
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp_path = tmp.name
            try:
                success = synth_az_tts_sentence(text=sentence, output_path=tmp_path)
                if not success or not os.path.exists(tmp_path):
                    print(f"[TTS] Generation failed for note {note_id}")
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                    continue

                # Read and base64-encode
                with open(tmp_path, "rb") as f:
                    data = f.read()
                b64 = base64.b64encode(data).decode("ascii")

                # Upload to Anki via storeMediaFile
                try:
                    anki.invoke(
                        "storeMediaFile",
                        {"filename": filename, "data": b64},
                    )
                except Exception as e:
                    print(f"[Anki] Failed to store media for note {note_id}: {e}")
                    continue

                # Update the note field to reference the uploaded audio
                try:
                    anki.update_note(
                        note_id,
                        fields={"SentenceAudio": f"[sound:{filename}]"},
                    )
                except Exception as e:
                    print(f"[Anki] Failed to update note {note_id}: {e}")
            finally:
                if os.path.exists(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except Exception:
                        pass

        print(f"--- Sync Complete for {deck_name} ---")