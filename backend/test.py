import anki
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from tts_handling.sentence_detector import is_sentence
import traceback
import re

def find_notes_by_deck(deck_name: str) -> List[int]:
    """
    Return all note IDs in a deck.
    """
    note_ids = anki.invoke(
        "findNotes",
        {"query": f'deck:"{deck_name}"'}
    )
    # AnkiConnect returns a list; coerce defensively
    return list(note_ids or [])

def _get_deck_notes_info(deck_name: str) -> List[Dict[str, Any]]:
    note_ids = anki.invoke("findNotes", {"query": f'deck:"{deck_name}"'})
    note_ids = list(note_ids or [])
    if not note_ids:
        return []
    return anki.invoke("notesInfo", {"notes": note_ids})

def _get_note_field(note: Dict[str, Any], field_name: str) -> str:
    fields = note.get("fields") or {}
    field = fields.get(field_name) or {}
    value = field.get("value") if isinstance(field, dict) else None
    if value is None:
        return ""
    return str(value).strip()

def get_missing_audio(deck: str, limit: int = 50):
    try:
        notes = _get_deck_notes_info(deck)
        missing_entries: List[Dict[str, Any]] = []
        total_missing_count = 0

        for note in notes:
            note_id = note.get("noteId")
            if not note_id:
                continue
            
            sentence = _get_note_field(note, "Sentence")
            sentence_audio = _get_note_field(note, "SentenceAudio")
            word = _get_note_field(note, "Expression") or sentence

            # REASONING:
            # 1. Strip HTML tags from the audio field (Anki fields are often HTML)
            # 2. Check if it contains the pattern [sound:...]
            has_audio = bool(re.search(r'\[sound:.*?\]', sentence_audio))
            
            # Ensure sentence actually has text and NO audio tag
            #is_missing = bool(sentence.strip()) and not has_audio
            
            # if not has_audio:
            #     print(f"DEBUG: Note {note_id} has no audio. Sentence: '{sentence[:20]}...' | is_sentence: {is_sentence(sentence)}")

            # Optional: Keep your is_sentence check if you only want long strings
            if not has_audio and is_sentence(sentence):
                total_missing_count += 1
                if len(missing_entries) < limit:
                    missing_entries.append({
                        "noteId": int(note_id),
                        "word": word,
                        "sentence": sentence,
                        "filename": f"azure_{note_id}.mp3",
                    })

        return {"missing": missing_entries, "totalMissing": total_missing_count}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# volume = get_missing_audio("JLPT Test")

# print("This is weird", volume)

#1768194317223

#result = anki.invoke("findNotes", {"query": "譲歩"})
#print(f"Notes found globally: {result}")

def get_notes(deck: str, limit: int = 100, offset: int = 0):
    #anki.invoke("sync")
    #print(f"get_notes -> deck={deck!r} limit={limit} offset={offset}")
    try:
        return anki.get_notes(deck, limit=limit, offset=offset)
    except Exception as e:
        # print the full traceback to the uvicorn console so we can see the root cause
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

resultme = get_notes(deck="JLPT N2 Vocab")
print(resultme[50])