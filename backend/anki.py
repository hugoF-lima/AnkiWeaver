import logging
import requests
from typing import Any, Dict, List

ANKI_CONNECT_URL = "http://localhost:8765"
FIELDS = {
    "expression": "Expression",
    "reading": "Reading",
    "glossary": "Glossary",
    "expression_audio": "Audio",
    "sentence": "Sentence",
    "translation": "SentenceTranslation",
    "sentence_audio": "SentenceAudio",
}

logger = logging.getLogger("ankiweaver")

def invoke(action, params):
    if action in {"multi", "addNotes", "updateNoteFields", "storeMediaFile"}:
        logger.info("AnkiConnect call action=%s", action)

    try:
        r = requests.post(
            ANKI_CONNECT_URL,
            json={"action": action, "version": 6, "params": params},
            timeout=15,
        )
    except requests.RequestException as e:
        logger.exception("AnkiConnect request failed action=%s", action)
        raise RuntimeError(f"AnkiConnect request failed: {e}") from e

    try:
        res = r.json()
    except Exception as e:
        logger.error(
            "AnkiConnect invalid JSON action=%s status=%s body=%s",
            action,
            r.status_code,
            (r.text or "")[:200],
        )
        raise RuntimeError("AnkiConnect returned invalid JSON") from e

    if res.get("error"):
        logger.error("AnkiConnect error action=%s error=%s", action, res.get("error"))
        raise RuntimeError(res["error"])

    return res.get("result")

#TODO: Try to open in browser instead.
def view_note_in_gui(note_id):
    invoke(
        "guiBrowse",
        {"query": f"nid:{note_id}"}
    )

def get_notes(deck_name, limit=30, offset=0):
    note_ids = invoke(
        "findNotes",
        {"query": f'deck:"{deck_name}"'}
    )
    note_ids = list(reversed(note_ids))[offset:offset + limit]

    return invoke(
        "notesInfo",
        {"notes": note_ids}
    )

def find_notes_by_deck(deck_name: str) -> List[int]:
    """
    Return all note IDs in a deck.
    """
    note_ids = invoke(
        "findNotes",
        {"query": f'deck:"{deck_name}"'}
    )
    # AnkiConnect returns a list; coerce defensively
    return list(note_ids or [])

def get_model_names() -> List[str]:
    """
    Return all model (Note Type) names.
    """
    return invoke("modelNames", {})

def get_model_field_names(model_name: str) -> List[str]:
    """
    Return all field names for a specific model.
    """
    return invoke("modelFieldNames", {"modelName": model_name})

def notes_info(note_ids: List[int]) -> List[Dict[str, Any]]:
    """
    Return notesInfo for a list of note IDs.
    """
    if not note_ids:
        return []
    return invoke(
        "notesInfo",
        {"notes": note_ids}
    )

def update_note(
    note_id,
    jp=None,
    en=None,
    glossary=None,
    sentence_audio=None,
    expression_audio=None,
    audio_id=None,
    mapping=None,
):
    def normalize_audio_id(raw):
        if raw is None:
            return None
        s = str(raw).strip()
        if not s:
            return None
        if s.lower() in {"undefined", "null", "none"}:
            return None
        if s.startswith("tatoeba_"):
            s = s[len("tatoeba_"):]
        if s.endswith(".mp3"):
            s = s[:-4]
        return s

    base = normalize_audio_id(audio_id) if audio_id is not None else None

    # Build only the fields we intend to update
    fields: Dict[str, Any] = {}
    
    # Use mapping if provided, otherwise fallback to default FIELDS
    def get_field_name(internal_key):
        if mapping is not None:
            # If mapping is provided, ONLY use what's in it. 
            # If it's missing, it means the field is disabled.
            return mapping.get(internal_key)
        return FIELDS.get(internal_key)

    sentence_field = get_field_name("sentence")
    if jp is not None and sentence_field:
        fields[sentence_field] = jp
        
    translation_field = get_field_name("translation")
    if en is not None and translation_field:
        fields[translation_field] = en

    glossary_field = get_field_name("glossary")
    if glossary is not None and glossary_field:
        fields[glossary_field] = glossary

    def sound_wrap(raw):
        s = str(raw or "").strip()
        if not s:
            return None
        if "[sound:" in s:
            return s
        if not s.lower().endswith(".mp3"):
            return f"[sound:{s}.mp3]"
        return f"[sound:{s}]"

    sentence_audio_field = get_field_name("sentence_audio")
    if sentence_audio is not None and sentence_audio_field:
        wrapped = sound_wrap(sentence_audio)
        if wrapped:
            fields[sentence_audio_field] = wrapped

    expression_audio_field = get_field_name("expression_audio")
    if expression_audio is not None and expression_audio_field:
        wrapped = sound_wrap(expression_audio)
        if wrapped:
            fields[expression_audio_field] = wrapped
        
    filename = None
    if base and sentence_audio_field and sentence_audio is None:
        filename = f"tatoeba_{base}.mp3"
        invoke(
            "storeMediaFile",
            {
                "filename": filename,
                "url": f"https://tatoeba.org/en/audio/download/{base}",
            },
        )
        fields[sentence_audio_field] = f"[sound:{filename}]"

    if fields:
        invoke(
            "updateNoteFields",
            {
                "note": {
                    "id": note_id,
                    "fields": fields,
                }
            },
        )

    return {"ok": True, "storedAudio": bool(filename), "filename": filename}
