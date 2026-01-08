import requests

ANKI_CONNECT_URL = "http://localhost:8765"
FIELDS = {
    "expression": "Expression",
    "sentence": "Sentence",
    "translation": "SentenceTranslation",
    "sentence_audio": "SentenceAudio",
}

def invoke(action, params):
    print("INVOKE CALLED:", action)
    print("PARAMS:", params)

    res = requests.post(
        ANKI_CONNECT_URL,
        json={
            "action": action,
            "version": 6,
            "params": params
        }
    ).json()

    if res.get("error"):
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

def update_note(note_id, jp, en, audio_id=None):
    actions = []

    filename = None
    # Normalize audio_id only if provided
    if audio_id:
        base = audio_id
        if base.startswith("tatoeba_"):
            base = base[len("tatoeba_"):]
        if base.endswith(".mp3"):
            base = base[:-4]
        filename = f"tatoeba_{base}.mp3"
        media_action = {
            "action": "storeMediaFile",
            "params": {
                "filename": filename,
                "url": f"https://tatoeba.org/en/audio/download/{base}"
            }
        }
        actions.append(media_action)

    # Build only the fields we intend to update
    fields = {FIELDS["sentence"]: jp}
    if en is not None:
        fields[FIELDS["translation"]] = en
    if filename:
        fields[FIELDS["sentence_audio"]] = f"[sound:{filename}]"

    note_update_action = {
        "action": "updateNoteFields",
        "params": {
            "note": {
                "id": note_id,
                "fields": fields
            }
        }
    }
    actions.append(note_update_action)

    payload = {"action": "multi", "version": 6, "params": {"actions": actions}}
    response = requests.post(ANKI_CONNECT_URL, json=payload).json()
    return response
