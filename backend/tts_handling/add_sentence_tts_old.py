from pathlib import Path
from tqdm import tqdm
import anki
import os
from backend.tts_handling.audio_fetcher_azure import synth_az_tts_sentence
from sentence_detector import is_sentence

#The main class for handling audio

""" AUDIO_DIR = Path(
    "~/.var/app/net.ankiweb.Anki/data/Anki2/hugol/collection.media"
).expanduser() """

current_deck = "JLPT Test"

def retrieve_system_path():
    try:
        # Ask AnkiConnect for the real path
        path_str = anki.invoke("getMediaDirPath", {})
        return Path(path_str)
    except Exception:
        # Fallback if Anki is closed during startup
        return None
    
AUDIO_DIR = retrieve_system_path()

notes = anki.find_notes_by_deck(current_deck)
notes_info = anki.notes_info(notes)

for note in tqdm(notes_info, desc="Fixing SentenceAudio"):
    note_id = note["noteId"]
    fields = note["fields"]

    sentence = fields["Sentence"]["value"].strip()
    sentence_audio = fields["SentenceAudio"]["value"].strip()

    if not sentence:
        continue

    if sentence_audio:
        continue

    if not is_sentence(sentence):
        continue

    filename = f"azure_{note_id}.mp3"
    filepath = AUDIO_DIR / filename

    ok = synth_az_tts_sentence(
        text=sentence,
        output_path=str(filepath)
    )

    if not ok or not filepath.exists():
        print(f"[TTS] failed to produce audio for note {note_id}")
        continue

    anki.update_note(
        note_id,
        fields={
            "SentenceAudio": f"[sound:{filename}]"
        }
    )
