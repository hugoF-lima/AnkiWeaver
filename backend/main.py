from pathlib import Path
import traceback
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anki
from . import anki, sentences
from typing import Optional
import deepl
from fastapi.responses import Response
import base64

DEEPL_AUTH_KEY = "YOUR_DEEPL_AUTHENTICATION_KEY" 

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define a Pydantic model for the incoming request body
class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "en-US" # Assuming English US as default target

@app.post("/api/notes/{note_id}/translate")
def translate_sentence(note_id: str, request: TranslateRequest):
    try:
        translator = deepl.Translator(DEEPL_AUTH_KEY)
        
        # Translate the text using the DeepL client library
        # Source language is automatically detected (None)
        result = translator.translate_text(
            request.text, 
            target_lang=request.target_lang
        )
        
        # Return the translated text
        return {"translated_text": result.text}
        
    except Exception as e:
        traceback.print_exc()
        # Catch specific DeepL exceptions for better error handling if needed
        if isinstance(e, deepl.DeepLException):
             raise HTTPException(status_code=400, detail=f"DeepL API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@app.get("/api/decks")
def get_decks():
    try:
        print("DECKS LISTED:")
        return anki.invoke("deckNames", {})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sentences")
def get_sentences(word: str, page: int = 0, per_page: int = 10):
    try:
        print(f"get_sentences -> word={word!r} page={page} per_page={per_page}")
        return sentences.search_sentences(word, page=page, per_page=per_page)
    except Exception as e:
        traceback.print_exc()
        # Return JSON error so client sees structured info instead of HTML
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/notes")
def get_notes(deck: str, limit: int = 30, offset: int = 0):
    try:
        return anki.get_notes(deck, limit=limit, offset=offset)
    except Exception as e:
        # print the full traceback to the uvicorn console so we can see the root cause
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/media/{filename}")
def get_media_file(filename: str):
    """
    Serve Anki media by filename (via AnkiConnect retrieveMediaFile -> base64).
    """
    try:
        print("GET MEDIA:", filename)
        result = anki.invoke("retrieveMediaFile", {"filename": filename})
        if isinstance(result, str):
            try:
                data = base64.b64decode(result)
                return Response(content=data, media_type="audio/mpeg")
            except Exception as e:
                print("Failed to decode media:", e)
                raise HTTPException(status_code=500, detail="Failed to decode media")
        raise HTTPException(status_code=404, detail="Media not found")
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/anki/version")
def anki_version():
    try:
        return {"version": anki.invoke("version")}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    
class UpdatePayload(BaseModel):
    jp: str
    en: Optional[str] = None
    sentence_audio: Optional[str] = None

@app.post("/api/notes/{note_id}/update")
def update_note_endpoint(note_id: int, payload: UpdatePayload):
    try:
        print(f"update_note_endpoint called: note_id={note_id}, payload={payload}")
        anki.update_note(note_id, payload.jp, payload.en, payload.sentence_audio)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}

@app.post("/api/notes/{note_id}/open")
def view_note_in_gui_endpoint(note_id: int):
    anki.view_note_in_gui(note_id)
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)