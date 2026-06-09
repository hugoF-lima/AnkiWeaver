import os
from pathlib import Path
from tqdm import tqdm

# Assuming your local modules are structured like this
import anki 
from tts_handling.audio_fetcher_azure import synth_az_tts_sentence
from tts_handling.sentence_detector import is_sentence

class AnkiAddSentenceTTS:
    def __init__(self):
        self.audio_dir = self._retrieve_system_path()

    def _retrieve_system_path(self):
        """Internal helper to locate Anki's media folder."""
        try:
            path_str = anki.invoke("getMediaDirPath", {})
            return Path(path_str)
        except Exception as e:
            print(f"[Anki] Could not connect to AnkiConnect: {e}")
            return None

    def insert_tts_audio(self, deck_name: str):
        """
        Main method to fetch missing TTS audio for a specific deck.
        """
        if not self.audio_dir:
            print("[Error] Media directory not found. Is Anki running?")
            return

        print(f"--- Starting TTS Sync for Deck: {deck_name} ---")
        
        notes = anki.find_notes_by_deck(deck_name)
        notes_info = anki.notes_info(notes)

        for note in tqdm(notes_info, desc=f"Processing {deck_name}"):
            note_id = note["noteId"]
            fields = note["fields"]

            # Safely get field values
            sentence = fields.get("Sentence", {}).get("value", "").strip()
            sentence_audio = fields.get("SentenceAudio", {}).get("value", "").strip()

            # Skip if no text, already has audio, or isn't a valid sentence
            if not sentence or sentence_audio or not is_sentence(sentence):
                continue

            filename = f"azure_{note_id}.mp3"
            filepath = self.audio_dir / filename

            # Generate audio via Azure
            success = synth_az_tts_sentence(
                text=sentence,
                output_path=str(filepath)
            )

            if not success or not filepath.exists():
                print(f"[TTS] Failed for note {note_id}")
                continue

            # Update Anki with the new sound reference
            anki.update_note(
                note_id,
                fields={
                    "SentenceAudio": f"[sound:{filename}]"
                }
            )
        
        print(f"--- Sync Complete for {deck_name} ---")