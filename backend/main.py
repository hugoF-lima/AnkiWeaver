from pathlib import Path
import traceback
import logging
from logging.handlers import RotatingFileHandler
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional, Set
import deepl

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = PROJECT_ROOT / "log"
LOG_PATH = LOG_DIR / "application.log"

LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH.touch(exist_ok=True)

logger = logging.getLogger("ankiweaver")
logger.setLevel(logging.INFO)

_file_handler = RotatingFileHandler(LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S"))

if not any(isinstance(h, RotatingFileHandler) and getattr(h, "baseFilename", "") == str(LOG_PATH) for h in logger.handlers):
    logger.addHandler(_file_handler)

import anki
import sentences

from fastapi.responses import Response
import base64
from requests import post
import mimetypes
import os
import hashlib
import time
from dotenv import load_dotenv
import re
import requests
import tempfile

from tts_handling.anki_add_sentence_tts import AnkiAddSentenceTTS
from tts_handling.audio_fetcher_azure import AZURE_TTS_VOICES, VOICE_NAME, synth_az_tts_sentence, AZURE_SPEECH_REGION
from tts_handling.audio_fetcher_elevenlabs import (
    ELEVEN_LABS_DEFAULT_MODEL_ID,
    ELEVENLABS_TTS_VOICES,
    synth_elevenlabs_tts,
)
from tts_handling.sentence_detector import is_sentence
from freq_tokenization.yomitan_loader import load_yomitan_frequency
from freq_tokenization.tokenized_filtering import (
    build_token_table,
    build_token_table_from_csv,
    build_token_table_from_json,
    infer_csv_columns,
    enrich_with_frequency,
    enrich_with_jlpt_level,
    sort_by_frequency,
    filter_tokens,
)

#@app.get("/api/sentences")
# async def get_sentences(word: str):
#     # ... your logic
#     return {"sentences": []}

import json
from fastapi.encoders import jsonable_encoder

# Point to .env file (legacy fallback) and to settings storage (profiles + keys + misc)
env_path = Path(__file__).resolve().parent.parent / ".env"
settings_path = Path(__file__).resolve().parent / "profiles.json"

# 2. Load the file (legacy fallback; keys can also be stored per settings profile)
load_dotenv(dotenv_path=env_path)

app = FastAPI()

@app.on_event("startup")
def _startup_log():
    logger.info("Application started")

class MappingEntry(BaseModel):
    anki_field: str
    internal_field: str
    active: bool

class EnvPayload(BaseModel):
    AZURE_SPEECH_KEY: str = ""
    DEEPL_AUTH_KEY: str = ""
    ELEVEN_LABS_SPEECH_KEY: str = ""

class SettingsProfile(BaseModel):
    name: str
    env: EnvPayload = EnvPayload()
    languageOverride: str = "auto"  # "auto" | "jp" | "en"
    selectedNoteType: str = ""
    databasePath: str = "backend/data/tatoeba-multi-lang.db"
    mappings: Dict[str, List[MappingEntry]] = {}

@app.get("/api/settings/profiles")
def get_profiles():
    return _read_settings()

@app.post("/api/settings/profiles")
def save_profiles(store: Dict[str, Any]):
    try:
        _write_settings(store)
        return {"ok": True}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

class ActiveProfileRequest(BaseModel):
    profileId: str

@app.post("/api/settings/active-profile")
def set_active_profile(req: ActiveProfileRequest):
    try:
        settings = _read_settings()
        profile_id = (req.profileId or "").strip()
        if not profile_id:
            raise HTTPException(status_code=400, detail="profileId required")
        if profile_id not in settings.get("profiles", {}):
            raise HTTPException(status_code=404, detail="profile not found")
        settings["activeProfileId"] = profile_id
        _write_settings(settings)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/anki/models")
def get_models():
    try:
        return anki.get_model_names()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/anki/models/{model_name}/fields")
def get_model_fields(model_name: str):
    try:
        return anki.get_model_field_names(model_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _read_env():
    if not env_path.exists(): return {}
    with env_path.open("r", encoding="utf-8") as f:
        out = {}
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"): continue
            if "=" not in line: continue
            key, value = line.split("=", 1)
            out[key.strip()] = value.strip().strip('"')
        return out

def _write_env(values: dict):
    lines = []
    existing = _read_env()
    existing.update(values)
    for k, v in existing.items():
        lines.append(f'{k}="{v}"' if " " in v or v == "" else f"{k}={v}")
    env_path.write_text("\n".join(lines), encoding="utf-8")

def _migrate_legacy_store(data: Any) -> Dict[str, Any]:
    if isinstance(data, dict) and data.get("profiles") and data.get("activeProfileId") is not None:
        return data

    if isinstance(data, dict) and all(isinstance(v, list) for v in data.values()):
        legacy_mappings = data
        return {
            "activeProfileId": "default",
            "profiles": {
                "default": {
                    "name": "Default",
                    "env": _read_env(),
                    "languageOverride": "auto",
                    "selectedNoteType": "",
                    "databasePath": _default_database_path_setting(),
                    "mappings": legacy_mappings,
                }
            },
        }

    return {
        "activeProfileId": "default",
        "profiles": {
            "default": {
                "name": "Default",
                "env": _read_env(),
                "languageOverride": "auto",
                "selectedNoteType": "",
                "databasePath": _default_database_path_setting(),
                "mappings": {},
            }
        },
    }

def _read_settings() -> Dict[str, Any]:
    if not settings_path.exists():
        return _migrate_legacy_store({})
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
        return _migrate_legacy_store(data)
    except Exception:
        return _migrate_legacy_store({})

def _write_settings(store: Dict[str, Any]):
    data = jsonable_encoder(store)
    settings_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

def _get_active_profile() -> Dict[str, Any]:
    settings = _read_settings()
    profiles = settings.get("profiles", {}) or {}
    active_id = settings.get("activeProfileId") or "default"
    return profiles.get(active_id) or profiles.get("default") or {}

def _default_database_path_setting() -> str:
    default_db_path = sentences.get_default_db_path().resolve()
    try:
        return default_db_path.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(default_db_path)

def _get_active_database_path() -> str:
    active = _get_active_profile()
    raw = str(active.get("databasePath") or "").strip()
    if raw:
        return raw
    return _default_database_path_setting()

def _to_project_relative_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(PROJECT_ROOT).as_posix()
    except ValueError:
        return str(resolved)

@app.post("/api/settings/database/upload")
async def upload_database_file(file: UploadFile = File(...)):
    filename = Path(file.filename or "database.db").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".db", ".sqlite", ".sqlite3"}:
        raise HTTPException(status_code=400, detail="Unsupported database file type")

    target_dir = PROJECT_ROOT / "backend" / "data" / "imported_databases"
    target_dir.mkdir(parents=True, exist_ok=True)

    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).stem).strip("._-") or "database"
    target_path = target_dir / f"{safe_stem}_{int(time.time() * 1000)}{suffix}"

    try:
        contents = await file.read()
        target_path.write_bytes(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"ok": True, "databasePath": _to_project_relative_path(target_path)}

def _get_active_env() -> Dict[str, str]:
    active = _get_active_profile()
    env_from_profile = active.get("env") or {}
    if isinstance(env_from_profile, EnvPayload):
        env_from_profile = env_from_profile.model_dump()
    out: Dict[str, str] = {}
    for k in ["AZURE_SPEECH_KEY", "DEEPL_AUTH_KEY", "ELEVEN_LABS_SPEECH_KEY"]:
        out[k] = str(env_from_profile.get(k) or "").strip()
    return out

class ValidateKeyRequest(BaseModel):
    provider: str
    key: str

@app.get("/api/settings/env")
def get_env():
    env = _get_active_env()
    return {
        "AZURE_SPEECH_KEY": env.get("AZURE_SPEECH_KEY", ""),
        "DEEPL_AUTH_KEY": env.get("DEEPL_AUTH_KEY", ""),
        "ELEVEN_LABS_SPEECH_KEY": env.get("ELEVEN_LABS_SPEECH_KEY", ""),
    }

@app.post("/api/settings/env")
def set_env(payload: EnvPayload):
    try:
        settings = _read_settings()
        profiles = settings.get("profiles", {}) or {}
        active_id = settings.get("activeProfileId") or "default"
        if active_id not in profiles:
            profiles[active_id] = {
                "name": "Default",
                "env": {},
                "languageOverride": "auto",
                "databasePath": _default_database_path_setting(),
                "mappings": {},
            }
        active = profiles[active_id]
        active["env"] = payload.model_dump()
        settings["profiles"] = profiles
        _write_settings(settings)
        return {"ok": True}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/settings/validate-key")
def validate_key(req: ValidateKeyRequest):
    provider = req.provider.strip().upper()
    key = req.key.strip()
    if not key:
        return {"ok": False, "message": "key empty"}

    if provider == "AZURE":
        endpoint = (os.getenv("AZURE_REGION_ENDPOINT") or "").strip()
        if not endpoint:
            region = (os.getenv("AZURE_SPEECH_REGION") or AZURE_SPEECH_REGION or "").strip()
            if not region:
                region = "brazilsouth"
            endpoint = f"https://{region}.api.cognitive.microsoft.com"
        url = f"{endpoint.rstrip('/')}/sts/v1.0/issueToken"
        # Use a shorter connect/read timeout tuple to avoid long blocking waits
        r = requests.post(url, headers={"Ocp-Apim-Subscription-Key": key}, timeout=(3, 5))
        return {"ok": r.status_code == 200, "status": r.status_code, "endpoint": endpoint}

    if provider == "DEEPL":
        def _check(base_url: str):
            return requests.get(
                f"{base_url.rstrip('/')}/v2/usage",
                headers={"Authorization": f"DeepL-Auth-Key {key}"},
                timeout=10,
            )

        bases = []
        if key.endswith(":fx"):
            bases = ["https://api-free.deepl.com", "https://api.deepl.com"]
        else:
            bases = ["https://api.deepl.com", "https://api-free.deepl.com"]

        last_status = None
        last_body = None
        for base in bases:
            try:
                r = _check(base)
                last_status = r.status_code
                if r.status_code == 200:
                    return {"ok": True, "status": r.status_code, "base": base}
                last_body = (r.text or "")[:200]
            except Exception as e:
                last_body = str(e)[:200]

        return {"ok": False, "status": last_status, "message": last_body}

    if provider == "ELEVEN":
        r = requests.get(
            "https://api.elevenlabs.io/v1/user",
            headers={"xi-api-key": key},
            timeout=(3, 5),
        )
        return {"ok": r.status_code == 200, "status": r.status_code}

    return {"ok": False, "message": "unknown provider"}

#@app.post()
def add_tts_audio(targetdeck):
    tts_instance = AnkiAddSentenceTTS()
    tts_instance.insert_tts_audio(targetdeck)

# Define a Pydantic model for the incoming request body
class TranslateRequest(BaseModel):
    text: str
    target_lang: str = "en-US" # Assuming English US as default target

@app.post("/api/notes/{note_id}/translate")
def translate_sentence(note_id: str, request: TranslateRequest):
    try:
        key = _get_active_env().get("DEEPL_AUTH_KEY", "")
        if not key:
            logger.warning("DeepL translate rejected: missing key note_id=%s", note_id)
            raise HTTPException(status_code=400, detail="DEEPL_AUTH_KEY is not set for the active profile")
        translator = deepl.Translator(key)
        logger.info("Translation started note_id=%s target=%s chars=%s", note_id, request.target_lang, len(request.text or ""))
        
        # Translate the text using the DeepL client library
        # Source language is automatically detected (None)
        result = translator.translate_text(
            request.text, 
            target_lang=request.target_lang
        )
        
        # Return the translated text
        logger.info("Translation completed note_id=%s target=%s out_chars=%s", note_id, request.target_lang, len(result.text or ""))
        return {"translated_text": result.text}
        
    except Exception as e:
        logger.exception("Translation failed note_id=%s target=%s", note_id, getattr(request, "target_lang", ""))
        # Catch specific DeepL exceptions for better error handling if needed
        if isinstance(e, deepl.DeepLException):
             raise HTTPException(status_code=400, detail=f"DeepL API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


class BatchTranslateRequest(BaseModel):
    texts: List[str] = []
    target_lang: str = "en-US"


@app.post("/api/tokenize/translate")
def tokenize_translate(request: BatchTranslateRequest):
    try:
        key = _get_active_env().get("DEEPL_AUTH_KEY", "")
        if not key:
            logger.warning("DeepL batch translate rejected: missing key target=%s", request.target_lang)
            raise HTTPException(status_code=400, detail="DEEPL_AUTH_KEY is not set for the active profile")
        texts = [str(t or "").strip() for t in (request.texts or []) if str(t or "").strip()]
        if not texts:
            return {"ok": True, "translations": []}

        translator = deepl.Translator(key)
        logger.info("Translation enrichment started target=%s count=%s", request.target_lang, len(texts))
        result = translator.translate_text(texts, target_lang=request.target_lang)
        if isinstance(result, list):
            out = [r.text for r in result]
        else:
            out = [result.text]
        logger.info("Translation enrichment completed target=%s count=%s", request.target_lang, len(out))
        return {"ok": True, "translations": out}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Translation enrichment failed target=%s", getattr(request, "target_lang", ""))
        if isinstance(e, deepl.DeepLException):
            raise HTTPException(status_code=400, detail=f"DeepL API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@app.get("/api/decks")
def get_decks():
    try:
        settings = _read_settings()
        active_profile_id = settings.get("activeProfileId") or "default"
        active = (settings.get("profiles", {}) or {}).get(active_profile_id) or {}
        mappings = active.get("mappings") or {}
        if not mappings:
            # If no profiles defined, return all decks but maybe warn?
            # For now, let's return all decks to avoid breaking the app before profiles are set.
            return anki.invoke("deckNames", {})
        
        # Get all decks
        all_decks = anki.invoke("deckNames", {})
        valid_decks = []
        
        # A deck is valid if it contains at least one note of a type we have a profile for
        for deck in all_decks:
            # Check note types in this deck
            # findModelsNamesFromIDs is not directly available for decks, 
            # but we can find notes and get their models.
            note_ids = anki.invoke("findNotes", {"query": f'deck:"{deck}"'})
            if not note_ids:
                continue
            
            # Just check the first note's model for efficiency
            first_note = anki.invoke("notesInfo", {"notes": [note_ids[0]]})
            if first_note and first_note[0].get("modelName") in mappings:
                valid_decks.append(deck)
        
        return valid_decks
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sentences")
def get_sentences(word: str, page: int = 0, per_page: int = 10, random: bool = False):
    try:
        logger.info("Sentence lookup started word=%s page=%s per_page=%s random=%s", word, page, per_page, bool(random))
        out = sentences.search_sentences(
            word,
            page=page,
            per_page=per_page,
            randomize=bool(random),
            db_path=_get_active_database_path(),
        )
        logger.info("Sentence lookup completed word=%s count=%s", word, len(out or []))
        return out
    except Exception as e:
        traceback.print_exc()
        logger.exception("Sentence lookup failed word=%s", word)
        # Return JSON error so client sees structured info instead of HTML
        raise HTTPException(status_code=500, detail=str(e))


class BatchSentencesRequest(BaseModel):
    words: List[str] = []
    per_word: int = 1
    random: bool = False


@app.post("/api/sentences/batch")
def get_sentences_batch(request: BatchSentencesRequest):
    try:
        per_word = int(request.per_word or 1)
        if per_word <= 0:
            per_word = 1

        words = [str(w or "").strip() for w in (request.words or []) if str(w or "").strip()]
        seen: Set[str] = set()
        unique: List[str] = []
        for w in words:
            if w in seen:
                continue
            seen.add(w)
            unique.append(w)

        randomize = bool(getattr(request, "random", False))
        logger.info("Sentence batch lookup started words=%s per_word=%s random=%s", len(unique), per_word, randomize)
        results: List[Dict[str, Any]] = []
        error_count = 0
        db_path = _get_active_database_path()
        for w in unique:
            try:
                hits = sentences.search_sentences(w, page=0, per_page=per_word, randomize=randomize, db_path=db_path)
                if isinstance(hits, list) and len(hits) > 0:
                    s = hits[0] or {}
                    results.append(
                        {
                            "word": w,
                            "jp": s.get("jp") or "",
                            "en": s.get("en") or "",
                            "pt": s.get("pt") or "",
                            "has_audio": bool(s.get("has_audio")),
                            "audio_id": s.get("audio_id"),
                        }
                    )
                else:
                    results.append({"word": w, "jp": "", "en": "", "pt": "", "has_audio": False, "audio_id": None})
            except Exception as e:
                error_count += 1
                results.append({"word": w, "jp": "", "en": "", "pt": "", "has_audio": False, "audio_id": None, "error": str(e)})

        logger.info("Sentence batch lookup completed words=%s errors=%s", len(unique), error_count)
        return {"ok": True, "results": results}
    except Exception as e:
        traceback.print_exc()
        logger.exception("Sentence batch lookup failed")
        raise HTTPException(status_code=500, detail=str(e))

#This function populates the wordGrid.tsx, through useAnkiDeck.ts
# @app.get("/api/notes")
# def get_notes(deck: str, limit: int = 20, offset: int = 0):
#     print(f"get_notes -> deck={deck!r} limit={limit} offset={offset}")
#     try:
#         return anki.get_notes(deck, limit=limit, offset=offset)
#     except Exception as e:
#         # print the full traceback to the uvicorn console so we can see the root cause
#         traceback.print_exc()
#         raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/decks/{deck}/language")
def get_deck_language(deck: str):
    try:
        active = _get_active_profile()
        override = (active.get("languageOverride") or "").strip().lower()
        if override in ("jp", "en"):
            return {"language": override}

        # Fetch a few notes to detect language
        note_ids = anki.invoke("findNotes", {"query": f'deck:"{deck}"'})
        if not note_ids:
            return {"language": "en"} # Default

        # Sample up to 5 notes
        sample_ids = note_ids[:5]
        notes_info = anki.invoke("notesInfo", {"notes": sample_ids})
        
        if not notes_info:
            return {"language": "en"}

        model_name = notes_info[0].get("modelName")
        mapping = _get_profile_mapping(model_name)
        expr_field = mapping.get("expression") if mapping else "Expression"

        text = ""
        for note in notes_info:
            fields = note.get("fields", {})
            if expr_field in fields:
                text += fields[expr_field].get("value", "")
            else:
                # Fallback to all fields if expression not found
                for field_info in fields.values():
                    text += field_info.get("value", "")

        # Detect Japanese: Hiragana (3040-309F), Katakana (30A0-30FF), Kanji (4E00-9FAF)
        if re.search(r'[\u3040-\u30ff\u4e00-\u9faf]', text):
            return {"language": "jp"}
        
        return {"language": "en"}
    except Exception as e:
        traceback.print_exc()
        return {"language": "en"}

def _get_profile_mapping(model_name: str):
    active = _get_active_profile()
    mappings = active.get("mappings") or {}
    profile = mappings.get(model_name)
    if not profile:
        return None
    out: Dict[str, str] = {}
    for m in profile:
        internal_field = (m.get("internal_field") or "").strip()
        anki_field = (m.get("anki_field") or "").strip()
        active_flag = bool(m.get("active"))
        if active_flag and internal_field and anki_field:
            out[internal_field] = anki_field
    return out or None

def _infer_mapping_from_note_fields(field_names: List[str]) -> Dict[str, str]:
    names = [str(x) for x in (field_names or []) if str(x)]
    lower = {n.lower(): n for n in names}

    def pick_exact(*candidates: str) -> Optional[str]:
        for c in candidates:
            if c.lower() in lower:
                return lower[c.lower()]
        return None

    def pick_regex(pattern: str) -> Optional[str]:
        rx = re.compile(pattern, re.IGNORECASE)
        for n in names:
            if rx.search(n):
                return n
        return None

    mapping: Dict[str, str] = {}

    expression = pick_exact("Expression", "Word", "Kanji") or pick_regex(r"(expression|word|kanji)") or (names[0] if names else None)
    if expression:
        mapping["expression"] = expression

    reading = pick_exact("Reading", "Kana") or pick_regex(r"(reading|kana)") or None
    if reading:
        mapping["reading"] = reading

    glossary = pick_exact("Glossary") or pick_regex(r"(glossary|meaning|definition)") or None
    if glossary:
        mapping["glossary"] = glossary

    sentence = pick_exact("Sentence") or pick_regex(r"sentence") or None
    if sentence:
        mapping["sentence"] = sentence

    translation = pick_exact("SentenceTranslation") or pick_regex(r"sentence.*translat") or pick_regex(r"(translat|meaning|definition)") or None
    if translation:
        mapping["translation"] = translation

    sentence_audio = pick_exact("SentenceAudio") or pick_regex(r"sentence.*audio") or None
    if sentence_audio:
        mapping["sentence_audio"] = sentence_audio

    expression_audio = pick_exact("Audio", "WordAudio", "ExpressionAudio") or pick_regex(r"^(word)?audio$") or None
    if expression_audio:
        mapping["expression_audio"] = expression_audio

    return mapping

_deck_expression_cache: Dict[str, Dict[str, Any]] = {}

def _get_deck_expression_set(deck_name: str, mapping: Dict[str, str]) -> Set[str]:
    now = int(__import__("time").time())
    cached = _deck_expression_cache.get(deck_name)
    if cached and (now - int(cached.get("ts") or 0) <= 60):
        exprs = cached.get("exprs")
        if isinstance(exprs, set):
            return exprs

    note_ids = anki.invoke("findNotes", {"query": f'deck:"{deck_name}"'})
    note_ids = list(note_ids or [])
    if not note_ids:
        exprs = set()
        _deck_expression_cache[deck_name] = {"ts": now, "exprs": exprs}
        return exprs

    notes = anki.invoke("notesInfo", {"notes": note_ids})
    expr_field = (mapping or {}).get("expression") or "Expression"
    exprs: Set[str] = set()
    for n in notes or []:
        try:
            v = _get_note_field(n, expr_field)
            v = (v or "").strip()
            if v:
                exprs.add(v)
        except Exception:
            continue

    _deck_expression_cache[deck_name] = {"ts": now, "exprs": exprs}
    return exprs

@app.get("/api/notes")
def get_notes(deck: str, limit: int = 50, offset: int = 0, sort: str = "most_recent", filters: str = ""):
    try:
        # 1. Build the Anki query based on filters
        query = f'deck:"{deck}"'
        
        # We need to know the mapping to apply filters correctly
        # Get first note to find the model
        temp_ids = anki.invoke("findNotes", {"query": f'deck:"{deck}"'})
        if not temp_ids:
            return {"notes": [], "total": 0, "mapping": None}
        
        first_note = anki.invoke("notesInfo", {"notes": [temp_ids[0]]})
        model_name = first_note[0].get("modelName")
        mapping = _get_profile_mapping(model_name)
        if not mapping:
            note_fields = first_note[0].get("fields") or {}
            field_names = list(note_fields.keys()) if isinstance(note_fields, dict) else []
            mapping = _infer_mapping_from_note_fields(field_names)
        
        if filters:
            filter_list = [x.strip() for x in filters.split(",") if x.strip()]
            defaults = {
                "sentence_audio": "SentenceAudio",
                "sentence": "Sentence",
                "translation": "SentenceTranslation",
            }

            for f in filter_list:
                internal_key: Optional[str] = None
                negate_empty = False
                audio_sound_check: Optional[bool] = None  # True => must contain [sound:], False => must NOT contain [sound:]

                if f == "missing_audio":
                    internal_key = "sentence_audio"
                    audio_sound_check = False
                elif f == "missing_sentence":
                    internal_key = "sentence"
                elif f == "missing_translation":
                    internal_key = "translation"
                elif f == "contains_audio":
                    internal_key = "sentence_audio"
                    audio_sound_check = True
                elif f == "contains_sentence":
                    internal_key = "sentence"
                    negate_empty = True
                elif f == "contains_translation":
                    internal_key = "translation"
                    negate_empty = True

                if not internal_key:
                    continue

                anki_field = mapping.get(internal_key) if isinstance(mapping, dict) else defaults.get(internal_key)

                if not anki_field:
                    continue

                if audio_sound_check is not None:
                    # Use a regex check for actual Anki sound references like: [sound:filename.mp3]
                    # This avoids mismatches where the field is non-empty but contains no sound tag.
                    sound_query = f'{anki_field}:re:\\[sound:'
                    query += f' "{sound_query}"' if audio_sound_check else f' -"{sound_query}"'
                else:
                    if negate_empty:
                        query += f' -"{anki_field}:"'
                    else:
                        query += f' "{anki_field}:"'

        # 2. Get ALL Note IDs for this deck to find the total count
        all_ids = list(anki.invoke("findNotes", {"query": query}) or [])

        # 3. Handle sorting
        # 'most_recent'/'oldest' are based on noteId ordering (stable + fast)
        if sort in ["most_recent", "oldest"]:
            try:
                all_ids.sort()
            except Exception:
                all_ids = sorted([int(x) for x in all_ids])
            if sort == "most_recent":
                all_ids.reverse()

        # 'asc'/'desc' sort by expression field (locale/field dependent)
        if sort in ["asc", "desc"] and mapping:
            notes_info = anki.invoke("notesInfo", {"notes": all_ids})
            
            def get_sort_value(note):
                fields = note.get("fields", {})
                # Use expression mapping if available
                expr_field = mapping.get("expression")
                if expr_field and expr_field in fields:
                    return fields[expr_field].get("value", "")
                
                # Fallback
                for field in ["Expression", "Word", "Kanji"]:
                    if field in fields:
                        return fields[field].get("value", "")
                if fields:
                    first_field = list(fields.values())[0]
                    return first_field.get("value", "")
                return ""

            notes_info.sort(key=get_sort_value, reverse=(sort == "desc"))
            all_ids = [n["noteId"] for n in notes_info]

        total_count = len(all_ids)

        # 4. Slice the IDs based on pagination
        paged_ids = all_ids[offset : offset + limit]

        if not paged_ids:
            return {"notes": [], "total": total_count, "mapping": mapping}

        # 5. Fetch detailed info ONLY for the current page
        notes_info = anki.invoke("notesInfo", {"notes": paged_ids})
        
        id_to_note = {n["noteId"]: n for n in notes_info}
        sorted_notes_info = [id_to_note[nid] for nid in paged_ids if nid in id_to_note]

        return {
            "notes": sorted_notes_info,
            "total": total_count,
            "mapping": mapping # Send mapping to frontend
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/notes/{note_id}")
def get_note(note_id: int):
    try:
        logger.info("API: get_note called for %s", note_id)
        notes_info = anki.invoke("notesInfo", {"notes": [note_id]})
        if not notes_info:
            raise HTTPException(status_code=404, detail="note not found")

        note = notes_info[0]
        model_name = note.get("modelName")
        mapping = _get_profile_mapping(model_name)
        if not mapping:
            note_fields = note.get("fields") or {}
            field_names = list(note_fields.keys()) if isinstance(note_fields, dict) else []
            mapping = _infer_mapping_from_note_fields(field_names)

        logger.info("API: get_note returning note %s (model=%s)", note.get('noteId'), model_name)
        return {"note": note, "mapping": mapping}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/note-ids")
def get_note_ids(deck: str, limit: int = 500, offset: int = 0, sort: str = "most_recent", filters: str = ""):
    try:
        query = f'deck:"{deck}"'

        temp_ids = anki.invoke("findNotes", {"query": f'deck:"{deck}"'})
        if not temp_ids:
            return {"noteIds": [], "total": 0, "mapping": None}

        first_note = anki.invoke("notesInfo", {"notes": [temp_ids[0]]})
        model_name = first_note[0].get("modelName")
        mapping = _get_profile_mapping(model_name)
        if not mapping:
            note_fields = first_note[0].get("fields") or {}
            field_names = list(note_fields.keys()) if isinstance(note_fields, dict) else []
            mapping = _infer_mapping_from_note_fields(field_names)

        if filters:
            filter_list = [x.strip() for x in filters.split(",") if x.strip()]
            defaults = {
                "sentence_audio": "SentenceAudio",
                "sentence": "Sentence",
                "translation": "SentenceTranslation",
            }

            for f in filter_list:
                internal_key: Optional[str] = None
                negate_empty = False
                audio_sound_check: Optional[bool] = None

                if f == "missing_audio":
                    internal_key = "sentence_audio"
                    audio_sound_check = False
                elif f == "missing_sentence":
                    internal_key = "sentence"
                elif f == "missing_translation":
                    internal_key = "translation"
                elif f == "contains_audio":
                    internal_key = "sentence_audio"
                    audio_sound_check = True
                elif f == "contains_sentence":
                    internal_key = "sentence"
                    negate_empty = True
                elif f == "contains_translation":
                    internal_key = "translation"
                    negate_empty = True

                if not internal_key:
                    continue

                anki_field = mapping.get(internal_key) if isinstance(mapping, dict) else defaults.get(internal_key)
                if not anki_field:
                    continue

                if audio_sound_check is not None:
                    sound_query = f'{anki_field}:re:\\[sound:'
                    query += f' "{sound_query}"' if audio_sound_check else f' -"{sound_query}"'
                else:
                    if negate_empty:
                        query += f' -"{anki_field}:"'
                    else:
                        query += f' "{anki_field}:"'

        all_ids = list(anki.invoke("findNotes", {"query": query}) or [])

        if sort in ["most_recent", "oldest"]:
            try:
                all_ids.sort()
            except Exception:
                all_ids = sorted([int(x) for x in all_ids])
            if sort == "most_recent":
                all_ids.reverse()

        if sort in ["asc", "desc"] and mapping:
            notes_info = anki.invoke("notesInfo", {"notes": all_ids})

            def get_sort_value(note):
                fields = note.get("fields", {})
                expr_field = mapping.get("expression")
                if expr_field and expr_field in fields:
                    return fields[expr_field].get("value", "")
                for field in ["Expression", "Word", "Kanji"]:
                    if field in fields:
                        return fields[field].get("value", "")
                if fields:
                    first_field = list(fields.values())[0]
                    return first_field.get("value", "")
                return ""

            notes_info.sort(key=get_sort_value, reverse=(sort == "desc"))
            all_ids = [n["noteId"] for n in notes_info]

        total_count = len(all_ids)
        paged_ids = all_ids[offset : offset + limit]
        return {"noteIds": paged_ids, "total": total_count, "mapping": mapping}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

#@app.get("api/collections-media-path")
def get_media_path():
    # 1. Get the path from AnkiConnect
    response = post('http://127.0.0.1:8765', json={
        "action": "getMediaDirPath",
        "version": 6
    }).json()

    media_path_str = response['result']
    media_path = Path(media_path_str)

    #profile_name = media_path.parent.name 
    
    return str(media_path)


#Potentially redundant code bellow:
def retrieve_system_path():
    try:
        # Ask AnkiConnect for the real path
        path_str = anki.invoke("getMediaDirPath", {})
        return Path(path_str)
    except Exception:
        # Fallback if Anki is closed during startup
        return None

# Initial check (seems to not interfer with the rest)
ANKI_MEDIA_PATH = retrieve_system_path()

@app.get("/media/{filename}")
def get_media_file(filename: str):
    """
    Serves media directly from Anki. 
    Uses the API for the data, but the detected path for debugging.
    """
    try:
        # DEBUG: Now you can print exactly where the file is supposed to be
        if ANKI_MEDIA_PATH:
            print(f"Searching for {filename} in: {ANKI_MEDIA_PATH}")
        
        # 2. Ask AnkiConnect for the content (The "Waiter" fetches the "Pizza")
        result = anki.invoke("retrieveMediaFile", {"filename": filename})
        
        if isinstance(result, str):
            data = base64.b64decode(result)
            
            # 3. Dynamic MIME Type (Crucial for multi-platform media)
            # This ensures images look like images and audio looks like audio
            mime_type, _ = mimetypes.guess_type(filename)
            
            return Response(
                content=data, 
                media_type=mime_type or "application/octet-stream"
            )
        
        raise HTTPException(status_code=404, detail="Media not found in Anki")

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

def _get_deck_notes_info(deck_name: str) -> List[Dict[str, Any]]:
    #anki.invoke("sync")
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

def _note_has_anki_sound_reference(sentence_audio_value: str) -> bool:
    # Anki sound refs are usually like: [sound:filename.mp3]
    return "[sound:" in (sentence_audio_value or "")

class VoicePreviewRequest(BaseModel):
    text: str = "こんにちは"
    voiceName: Optional[str] = None

class PreviewAudioRequest(BaseModel):
    noteId: int

class GenerateNoteAudioRequest(BaseModel):
    noteId: int
    voiceName: Optional[str] = None
    generateSentenceAudio: bool = True
    generateExpressionAudio: bool = False

class GenerateMissingAudioRequest(BaseModel):
    deckName: str

class ImportRecordsRequest(BaseModel):
    deckName: str
    records: List[Dict[str, Any]]

# This matches the { fields: [...] } structure from your frontend fetch
class ClearFieldsRequest(BaseModel):
    fields: List[str]
    
@app.get("/api/tts/voice")
def get_tts_voice():
    return _get_available_tts_voices()

@app.post("/api/tts/voice-preview")
def voice_preview(request: VoicePreviewRequest):
    try:
        media_dir = Path(anki.invoke("getMediaDirPath", {}))
        env = _get_active_env()
        resolved_voice = _resolve_tts_voice(request.voiceName)
        voice = resolved_voice["voice_name"]
        logger.info("Audio preview started voice=%s chars=%s", voice, len(request.text or ""))
        digest = hashlib.md5(request.text.encode("utf-8") + voice.encode("utf-8")).hexdigest()[:10]
        filename = f"tts_voice_preview_{digest}.mp3"
        output_path = media_dir / filename
        _synth_tts_audio(request.text, output_path, voice, env)
        logger.info("Audio preview completed voice=%s filename=%s", voice, filename)
        return {"audioUrl": f"/media/{filename}", "voiceName": voice}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Audio preview failed")
        raise HTTPException(status_code=500, detail=str(e))


class GenerateTextAudioItem(BaseModel):
    rowId: int
    text: str


class GenerateTextAudioBatchRequest(BaseModel):
    items: List[GenerateTextAudioItem] = []
    voiceName: Optional[str] = None


def _resolve_tts_voice(voice_name: Optional[str]) -> Dict[str, str]:
    raw = str(voice_name or "").strip()
    if not raw:
        available = _get_available_tts_voices()
        default_voice = str(available.get("defaultVoiceName") or available.get("voiceName") or "").strip()
        if default_voice:
            raw = default_voice
        else:
            return {"provider": "azure", "voice_id": VOICE_NAME, "voice_name": VOICE_NAME}
    if raw.startswith("azure:"):
        resolved = raw.split(":", 1)[1].strip() or VOICE_NAME
        return {"provider": "azure", "voice_id": resolved, "voice_name": resolved}
    if raw.startswith("elevenlabs:"):
        resolved = raw.split(":", 1)[1].strip()
        return {"provider": "elevenlabs", "voice_id": resolved, "voice_name": raw}
    return {"provider": "azure", "voice_id": raw, "voice_name": raw}


def _get_available_tts_voices() -> Dict[str, Any]:
    env = _get_active_env()
    voices: List[Dict[str, str]] = []

    # Only expose Azure voices when an AZURE key is configured for the active profile
    has_azure_key = bool(str(env.get("AZURE_SPEECH_KEY", "")).strip())
    if has_azure_key:
        for voice in AZURE_TTS_VOICES:
            voices.append(
                {
                    "id": f"azure:{voice['id']}",
                    "label": f"{voice['label']} ({voice['id']})",
                    "provider": "azure",
                }
            )

    # Only expose ElevenLabs voices when an Eleven key is configured
    eleven_key = str(env.get("ELEVEN_LABS_SPEECH_KEY", "")).strip()
    if eleven_key:
        for voice in ELEVENLABS_TTS_VOICES:
            voices.append(
                {
                    "id": f"elevenlabs:{voice['id']}",
                    "label": f"{voice['label']} (ElevenLabs)",
                    "provider": "elevenlabs",
                }
            )

    # If no voices available, return empty arrays so frontend can hide TTS UIs
    if not voices:
        return {"voiceName": "", "defaultVoiceName": "", "voices": []}

    default_voice = voices[0]["id"]
    return {"voiceName": default_voice, "defaultVoiceName": default_voice, "voices": voices}


def _synth_tts_audio(text: str, output_path: Path, voice_name: Optional[str], env: Dict[str, str]) -> Dict[str, str]:
    resolved = _resolve_tts_voice(voice_name)
    provider = resolved["provider"]

    if provider == "elevenlabs":
        key = env.get("ELEVEN_LABS_SPEECH_KEY", "")
        if not key:
            raise HTTPException(status_code=400, detail="ELEVEN_LABS_SPEECH_KEY is not set for the active profile")
        ok = synth_elevenlabs_tts(
            text=text,
            output_path=str(output_path),
            elevenlabs_api_key=key,
            voice_id=resolved["voice_id"],
            model_id=ELEVEN_LABS_DEFAULT_MODEL_ID,
        )
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to generate ElevenLabs audio")
        return resolved

    key = env.get("AZURE_SPEECH_KEY", "")
    if not key:
        raise HTTPException(status_code=400, detail="AZURE_SPEECH_KEY is not set for the active profile")
    ok = synth_az_tts_sentence(
        text=text,
        output_path=str(output_path),
        azure_speech_key=key,
        voice_name=resolved["voice_id"],
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to generate Azure audio")
    return resolved


@app.post("/api/tts/generate-text-audio-batch")
def generate_text_audio_batch(request: GenerateTextAudioBatchRequest):
    try:
        env = _get_active_env()
        media_dir = Path(anki.invoke("getMediaDirPath", {}))
        resolved_voice = _resolve_tts_voice(request.voiceName)
        voice = resolved_voice["voice_name"]
        logger.info("Audio batch started voice=%s items=%s", voice, len(request.items or []))

        results: List[Dict[str, Any]] = []
        for item in (request.items or []):
            row_id = int(item.rowId)
            text = str(item.text or "").strip()
            if not text:
                continue

            digest = hashlib.md5(text.encode("utf-8") + voice.encode("utf-8")).hexdigest()[:10]
            filename = f"tts_text_{digest}.mp3"
            output_path = media_dir / filename
            if not output_path.exists():
                _synth_tts_audio(text, output_path, voice, env)

            results.append({"rowId": row_id, "filename": filename})

        logger.info("Audio batch completed voice=%s generated=%s", voice, len(results))
        return {"ok": True, "results": results, "voiceName": voice}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Audio batch failed")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/tts/missing-audio")
def get_missing_audio(deck: str, limit: int = 50):
    try:
        logger.info("Missing audio scan started deck=%s limit=%s", deck, limit)
        notes = _get_deck_notes_info(deck)
        if not notes:
            logger.info("Missing audio scan completed deck=%s totalMissing=0", deck)
            return {"missing": [], "totalMissing": 0}
            
        # Use mapping from the first note
        model_name = notes[0].get("modelName")
        mapping = _get_profile_mapping(model_name)
        
        def get_mapped_field(note, internal_key, default_name):
            if mapping and internal_key in mapping:
                return _get_note_field(note, mapping[internal_key])
            return _get_note_field(note, default_name)

        missing_entries: List[Dict[str, Any]] = []
        total_missing_count = 0

        for note in notes:
            note_id = note.get("noteId")
            if not note_id:
                continue
            
            sentence = get_mapped_field(note, "sentence", "Sentence")
            sentence_audio = get_mapped_field(note, "sentence_audio", "SentenceAudio")
            word = get_mapped_field(note, "expression", "Expression") or sentence

            # REASONING:
            # 1. Strip HTML tags from the audio field (Anki fields are often HTML)
            # 2. Check if it contains the pattern [sound:...]
            has_audio = bool(re.search(r'\[sound:.*?\]', sentence_audio))
            
            # Ensure sentence actually has text and NO audio tag
            if not has_audio and is_sentence(sentence):
                total_missing_count += 1
                if len(missing_entries) < limit:
                    missing_entries.append({
                        "noteId": int(note_id),
                        "word": word,
                        "sentence": sentence,
                        "filename": f"azure_{note_id}.mp3",
                    })

        logger.info("Missing audio scan completed deck=%s totalMissing=%s returned=%s", deck, total_missing_count, len(missing_entries))
        return {"missing": missing_entries, "totalMissing": total_missing_count}
    except Exception as e:
        traceback.print_exc()
        logger.exception("Missing audio scan failed deck=%s", deck)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts/preview-audio")
def preview_audio(request: PreviewAudioRequest):
    try:
        logger.info("Audio note preview started note_id=%s", request.noteId)
        notes = anki.invoke("notesInfo", {"notes": [request.noteId]})
        if not notes:
            raise HTTPException(status_code=404, detail="Note not found")

        note = notes[0]
        model_name = note.get("modelName")
        mapping = _get_profile_mapping(model_name)
        
        sentence = ""
        if mapping and "sentence" in mapping:
            sentence = _get_note_field(note, mapping["sentence"])
        else:
            sentence = _get_note_field(note, "Sentence")

        if not sentence:
            raise HTTPException(status_code=400, detail="Note has no Sentence text")

        media_dir = Path(anki.invoke("getMediaDirPath", {}))
        filename = f"azure_{request.noteId}.mp3"
        output_path = media_dir / filename
        key = _get_active_env().get("AZURE_SPEECH_KEY", "")
        ok = synth_az_tts_sentence(text=sentence, output_path=str(output_path), azure_speech_key=key)
        if not ok:
            raise HTTPException(status_code=500, detail="Failed to generate preview audio")

        logger.info("Audio note preview completed note_id=%s filename=%s", request.noteId, filename)
        return {"audioUrl": f"/media/{filename}"}
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Audio note preview failed note_id=%s", getattr(request, "noteId", None))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts/generate-note-audio")
def generate_note_audio(request: GenerateNoteAudioRequest):
    try:
        logger.info(
            "Audio generate started note_id=%s voice=%s sentence=%s expression=%s",
            request.noteId,
            (request.voiceName or VOICE_NAME or "").strip(),
            bool(request.generateSentenceAudio),
            bool(request.generateExpressionAudio),
        )
        notes = anki.invoke("notesInfo", {"notes": [request.noteId]})
        if not notes:
            raise HTTPException(status_code=404, detail="Note not found")

        note = notes[0]
        model_name = note.get("modelName")
        mapping = _get_profile_mapping(model_name)

        media_dir = Path(anki.invoke("getMediaDirPath", {}))
        env = _get_active_env()
        resolved_voice = _resolve_tts_voice(request.voiceName)
        voice = resolved_voice["voice_name"]
        note_fields = note.get("fields") or {}

        response: Dict[str, Any] = {"ok": True, "voiceName": voice}
        fields_to_update: Dict[str, str] = {}

        if request.generateSentenceAudio:
            if mapping is not None and "sentence_audio" not in mapping:
                raise HTTPException(status_code=400, detail="SentenceAudio field is disabled in mapping")

            sentence_field = mapping.get("sentence") if mapping else "Sentence"
            sentence_audio_field = mapping.get("sentence_audio") if mapping else "SentenceAudio"

            sentence = _get_note_field(note, sentence_field)
            if not sentence:
                raise HTTPException(status_code=400, detail="Note has no Sentence text")

            existing_audio = _get_note_field(note, sentence_audio_field)
            already_had_sentence_audio = bool(re.search(r"\[sound:.*?\]", existing_audio or ""))
            response["alreadyHadSentenceAudio"] = already_had_sentence_audio
            response["alreadyHadAudio"] = already_had_sentence_audio

            if not already_had_sentence_audio:
                sentence_filename = f"azure_{request.noteId}.mp3"
                output_path = media_dir / sentence_filename
                _synth_tts_audio(sentence, output_path, voice, env)
                fields_to_update[sentence_audio_field] = f"[sound:{sentence_filename}]"
                response["filename"] = sentence_filename
                response["audioUrl"] = f"/media/{sentence_filename}"
                response["sentenceFilename"] = sentence_filename
                response["sentenceAudioUrl"] = f"/media/{sentence_filename}"

        if request.generateExpressionAudio:
            if mapping is not None and "expression_audio" not in mapping:
                raise HTTPException(status_code=400, detail="ExpressionAudio field is disabled in mapping")

            expression_audio_field: Optional[str] = None
            if mapping and "expression_audio" in mapping:
                expression_audio_field = mapping["expression_audio"]
            else:
                for candidate in ("Audio", "WordAudio", "ExpressionAudio"):
                    if candidate in note_fields:
                        expression_audio_field = candidate
                        break

            if not expression_audio_field or expression_audio_field not in note_fields:
                raise HTTPException(status_code=400, detail="ExpressionAudio field not found on this note type")

            expression = ""
            if mapping and "expression" in mapping:
                expression = _get_note_field(note, mapping["expression"])
            if not expression:
                for candidate in ("Expression", "Word", "Kanji"):
                    expression = _get_note_field(note, candidate)
                    if expression:
                        break
            if not expression:
                if isinstance(note_fields, dict) and note_fields:
                    first_val = next(iter(note_fields.values()))
                    if isinstance(first_val, dict):
                        expression = str(first_val.get("value") or "").strip()

            if not expression:
                raise HTTPException(status_code=400, detail="Note has no Expression text")

            existing_audio = _get_note_field(note, expression_audio_field)
            already_had_expression_audio = bool(re.search(r"\[sound:.*?\]", existing_audio or ""))
            response["alreadyHadExpressionAudio"] = already_had_expression_audio

            if not already_had_expression_audio:
                expression_filename = f"azure_expr_{request.noteId}.mp3"
                output_path = media_dir / expression_filename
                _synth_tts_audio(expression, output_path, voice, env)
                fields_to_update[expression_audio_field] = f"[sound:{expression_filename}]"
                response["expressionFilename"] = expression_filename
                response["expressionAudioUrl"] = f"/media/{expression_filename}"

        if fields_to_update:
            anki.invoke(
                "updateNoteFields",
                {"note": {"id": int(request.noteId), "fields": fields_to_update}},
            )

        logger.info("Audio generate completed note_id=%s updated_fields=%s", request.noteId, len(fields_to_update))
        response["updatedFields"] = list(fields_to_update.keys())
        return response
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Audio generate failed note_id=%s", getattr(request, "noteId", None))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts/generate-missing-audio")
def generate_missing_audio(request: GenerateMissingAudioRequest):
    try:
        logger.info("Missing audio generate started deck=%s", request.deckName)
        notes = _get_deck_notes_info(request.deckName)
        if not notes:
            logger.info("Missing audio generate completed deck=%s updated=0 missingFound=0", request.deckName)
            return {"updated": 0, "missingFound": 0}
            
        media_dir = Path(anki.invoke("getMediaDirPath", {}))
        
        # Use mapping from the first note
        model_name = notes[0].get("modelName")
        mapping = _get_profile_mapping(model_name)
        
        def get_mapped_field(note, internal_key, default_name):
            if mapping and internal_key in mapping:
                return _get_note_field(note, mapping[internal_key])
            return _get_note_field(note, default_name)

        missing_notes: List[Dict[str, Any]] = []
        for note in notes:
            note_id = note.get("noteId")
            if note_id is None:
                continue
            sentence = get_mapped_field(note, "sentence", "Sentence")
            sentence_audio = get_mapped_field(note, "sentence_audio", "SentenceAudio")
            if sentence and (not sentence_audio) and is_sentence(sentence):
                missing_notes.append(note)

        actions: List[Dict[str, Any]] = []
        generated = 0

        sentence_audio_field = "SentenceAudio"
        if mapping and "sentence_audio" in mapping:
            sentence_audio_field = mapping["sentence_audio"]

        for note in missing_notes:
            note_id = int(note.get("noteId"))
            sentence = get_mapped_field(note, "sentence", "Sentence")
            filename = f"azure_{note_id}.mp3"
            output_path = media_dir / filename

            key = _get_active_env().get("AZURE_SPEECH_KEY", "")
            ok = synth_az_tts_sentence(text=sentence, output_path=str(output_path), azure_speech_key=key)
            if not ok:
                continue

            generated += 1
            actions.append({
                "action": "updateNoteFields",
                "params": {
                    "note": {
                        "id": note_id,
                        "fields": {
                            sentence_audio_field: f"[sound:{filename}]"
                        }
                    }
                }
            })

        if actions:
            anki.invoke("multi", {"actions": actions})

        logger.info("Missing audio generate completed deck=%s updated=%s missingFound=%s", request.deckName, generated, len(missing_notes))
        return {"updated": generated, "missingFound": len(missing_notes)}
    except Exception as e:
        traceback.print_exc()
        logger.exception("Missing audio generate failed deck=%s", getattr(request, "deckName", None))
        raise HTTPException(status_code=500, detail=str(e))

def _normalize_import_record(record: Dict[str, Any]) -> Dict[str, Any]:
    # Support multiple possible input key spellings
    expression = record.get("Expression") or record.get("expression") or record.get("word") or record.get("Word") or ""
    sentence = record.get("Sentence") or record.get("sentence") or record.get("jp") or record.get("JP") or ""
    translation = record.get("SentenceTranslation") or record.get("sentenceTranslation") or record.get("translation") or record.get("en") or record.get("EN") or ""
    sentence_audio = record.get("SentenceAudio") or record.get("sentence_audio") or record.get("audio") or record.get("Audio") or ""
    return {
        "expression": str(expression).strip(),
        "sentence": str(sentence).strip(),
        "translation": str(translation).strip(),
        "sentenceAudio": str(sentence_audio).strip(),
    }

_frequency_index_cache: Optional[Dict[str, Any]] = None

def _get_frequency_index() -> Dict[str, Any]:
    global _frequency_index_cache
    if _frequency_index_cache is not None:
        return _frequency_index_cache
    try:
        default_zip = Path(__file__).resolve().parent / "freq_tokenization" / "アニメとドラマの頻度リスト.zip"
        zip_path = str(default_zip) if default_zip.exists() else ""
        if not zip_path:
            zip_path = (os.getenv("YOMITAN_FREQ_ZIP_PATH") or "").strip()

        if zip_path and Path(zip_path).exists():
            _frequency_index_cache = load_yomitan_frequency(
                zip_path=zip_path,
                source_name="anime_freq",
                jlpt_mode=False,
            )
        else:
            _frequency_index_cache = {}
    except Exception:
        traceback.print_exc()
        _frequency_index_cache = {}
    return _frequency_index_cache or {}

_jlpt_index_cache: Optional[Dict[str, Any]] = None

def _get_jlpt_index() -> Dict[str, Any]:
    global _jlpt_index_cache
    if _jlpt_index_cache is not None:
        return _jlpt_index_cache
    try:
        default_zip = Path(__file__).resolve().parent / "freq_tokenization" / "Jisho_JLPT_Tags.zip"
        zip_path = str(default_zip) if default_zip.exists() else ""
        if not zip_path:
            zip_path = (os.getenv("YOMITAN_JLPT_ZIP_PATH") or "").strip()

        if zip_path and Path(zip_path).exists():
            _jlpt_index_cache = load_yomitan_frequency(
                zip_path=zip_path,
                source_name="jlpt",
                jlpt_mode=True,
            )
        else:
            _jlpt_index_cache = {}
    except Exception:
        traceback.print_exc()
        _jlpt_index_cache = {}
    return _jlpt_index_cache or {}

@app.post("/api/tokenize/preview")
async def tokenize_preview(deckName: str = Form(...), file: UploadFile = File(...), columnMapping: Optional[str] = Form(None), csvDelimiter: Optional[str] = Form(None)):
    try:
        if not deckName:
            raise HTTPException(status_code=400, detail="deckName required")
        if file is None:
            raise HTTPException(status_code=400, detail="file required")

        filename = (file.filename or "").strip()
        suffix = Path(filename).suffix.lower()
        if suffix not in {".csv", ".txt", ".json"}:
            raise HTTPException(status_code=400, detail="Only .csv, .txt, and .json are supported")

        logger.info("Import started deck=%s file=%s type=%s", deckName, filename, suffix.lstrip("."))
        raw = await file.read()
        if not raw:
            return {"ok": True, "rows": [], "tagCounts": {}, "total": 0, "duplicateCount": 0}

        mapping_obj: Optional[Dict[str, Any]] = None
        if columnMapping:
            try:
                mapping_obj = json.loads(columnMapping)
                if not isinstance(mapping_obj, dict):
                    mapping_obj = None
            except Exception:
                mapping_obj = None

        if mapping_obj:
            for k, v in list(mapping_obj.items()):
                if v is None:
                    continue
                if isinstance(v, str) and v.strip().isdigit():
                    mapping_obj[k] = int(v.strip())

        tokens = []
        if suffix == ".txt":
            text = raw.decode("utf-8", errors="replace")
            tokens = build_token_table(text)
        else:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(raw)
                tmp_path = tmp.name
            try:
                if suffix == ".csv":
                    csv_map = infer_csv_columns(tmp_path)
                    vocab_col = None
                    kana_col = None
                    translation_col = None
                    sentence_col = None
                    sentence_translation_col = None
                    expression_audio_col = None
                    sentence_audio_col = None

                    if mapping_obj:
                        vocab_col = mapping_obj.get("expression")
                        kana_col = mapping_obj.get("reading")
                        translation_col = mapping_obj.get("glossary")
                        sentence_col = mapping_obj.get("sentence")
                        sentence_translation_col = mapping_obj.get("translation")
                        expression_audio_col = mapping_obj.get("expression_audio")
                        sentence_audio_col = mapping_obj.get("sentence_audio")
                    else:
                        vocab_col = csv_map.get("vocab")
                        kana_col = csv_map.get("kana")
                        translation_col = csv_map.get("translation")

                    if vocab_col is None or vocab_col == "":
                        raise HTTPException(status_code=400, detail="Could not infer vocab column from CSV")
                    tokens = build_token_table_from_csv(
                        tmp_path,
                        vocab_column=vocab_col,
                        kana_column=kana_col,
                        translation_column=translation_col,
                        sentence_column=sentence_col,
                        sentence_translation_column=sentence_translation_col,
                        expression_audio_column=expression_audio_col,
                        sentence_audio_column=sentence_audio_col,
                        delimiter=(csvDelimiter or None),
                    )
                else:
                    tokens = build_token_table_from_json(tmp_path, mapping=mapping_obj)
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        freq_index = _get_frequency_index()
        if freq_index:
            try:
                enrich_with_frequency(tokens, freq_index)
            except Exception:
                traceback.print_exc()

        jlpt_index = _get_jlpt_index()
        if jlpt_index:
            try:
                enrich_with_jlpt_level(tokens, jlpt_index)
            except Exception:
                traceback.print_exc()

        tokens = filter_tokens(tokens)

        def _token_sort_key(t: Any):
            tags = set(getattr(t, "tags", None) or [])
            is_content = "CONTENT" in tags
            jlpt_level = getattr(t, "jlpt_level", None)
            has_jlpt = jlpt_level is not None
            try:
                jlpt_num = int(jlpt_level) if has_jlpt else 999
            except Exception:
                jlpt_num = 999
            too_common = "TOO_COMMON" in tags
            is_funcish = bool({"FUNC", "AFFIX", "OTHER"} & tags)
            freq = getattr(t, "frequency", None)
            try:
                freq_num = int(freq) if freq is not None else 999999
            except Exception:
                freq_num = 999999
            entry = (getattr(t, "dictionary_form", "") or getattr(t, "surface", "") or "").strip()
            return (
                not is_content,          # expressions first
                not has_jlpt,            # JLPT first
                jlpt_num,                # N5..N1 (1..5)
                too_common,              # push TOO_COMMON down
                is_funcish,              # push grammar/affix/other down
                freq_num,                # then frequency
                entry,
            )

        tokens.sort(key=_token_sort_key)

        dup_set: Set[str] = set()
        try:
            deck_ids = anki.invoke("findNotes", {"query": f'deck:"{deckName}"'})
            deck_ids = list(deck_ids or [])
            if deck_ids:
                first = anki.invoke("notesInfo", {"notes": [deck_ids[0]]})
                first_note = first[0] if first else None
                field_names = list((first_note.get("fields") or {}).keys()) if first_note else []
                model_name = first_note.get("modelName") if first_note else None
                deck_mapping = _get_profile_mapping(model_name) if model_name else None
                if not deck_mapping:
                    deck_mapping = _infer_mapping_from_note_fields(field_names)
                dup_set = _get_deck_expression_set(deckName, deck_mapping or {})
        except Exception:
            traceback.print_exc()
            dup_set = set()

        rows: List[Dict[str, Any]] = []
        tag_counts: Dict[str, int] = {}
        duplicate_count = 0
        row_id = 0

        for t in tokens:
            entry = (getattr(t, "dictionary_form", "") or getattr(t, "surface", "") or "").strip()
            if not entry:
                continue
            reading = (getattr(t, "kana", "") or getattr(t, "reading", "") or "").strip()
            translation = (getattr(t, "translation", "") or "").strip()
            tags = set(getattr(t, "tags", None) or [])
            in_deck = entry in dup_set
            if in_deck:
                tags.add("IN_DECK")
                duplicate_count += 1
            tag_list = sorted([str(x) for x in tags if x])
            for tag in tag_list:
                tag_counts[tag] = int(tag_counts.get(tag, 0)) + 1

            rows.append(
                {
                    "rowId": row_id,
                    "entry": entry,
                    "reading": reading,
                    "translation": translation,
                    "sentence": (getattr(t, "sentence", "") or "").strip(),
                    "sentenceTranslation": (getattr(t, "sentence_translation", "") or "").strip(),
                    "audioFilename": (getattr(t, "expression_audio", "") or "").strip(),
                    "sentenceAudioFilename": (getattr(t, "sentence_audio", "") or "").strip(),
                    "tags": tag_list,
                    "inDeck": in_deck,
                    "occurrences": int(getattr(t, "occurrences", 1) or 1),
                    "frequency": getattr(t, "frequency", None),
                    "jlptLevel": getattr(t, "jlpt_level", None),
                }
            )
            row_id += 1

        logger.info("Imported %s entries deck=%s", len(rows), deckName)
        if duplicate_count:
            logger.warning("%s duplicates skipped deck=%s", duplicate_count, deckName)

        return {
            "ok": True,
            "rows": rows,
            "tagCounts": tag_counts,
            "total": len(rows),
            "duplicateCount": duplicate_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Import failed deck=%s", deckName)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cards/import/preview")
def cards_import_preview(request: ImportRecordsRequest):
    try:
        logger.info("Import preview started deck=%s records=%s", request.deckName, len(request.records or []))
        normalized = [_normalize_import_record(r) for r in request.records or []]
        wanted = {r["expression"] for r in normalized if r["expression"]}
        if not wanted:
            return {"matches": [], "notFoundCount": 0}

        notes = _get_deck_notes_info(request.deckName)
        expr_to_note: Dict[str, int] = {}
        for note in notes:
            note_id = note.get("noteId")
            if note_id is None:
                continue
            expr = _get_note_field(note, "Expression")
            if expr and expr not in expr_to_note:
                expr_to_note[expr] = int(note_id)

        matches: List[Dict[str, Any]] = []
        for r in normalized:
            expr = r["expression"]
            if not expr or expr not in expr_to_note:
                continue
            note_id = expr_to_note[expr]
            matches.append({
                "noteId": note_id,
                "word": expr,
                "previewSentence": r["sentence"],
                "previewTranslation": r["translation"],
            })

        # notFoundCount is based on unique expressions
        not_found_count = len(wanted) - len({m["word"] for m in matches})
        logger.info("Import preview completed deck=%s matches=%s notFound=%s", request.deckName, len(matches), not_found_count)
        return {"matches": matches, "notFoundCount": not_found_count}
    except Exception as e:
        traceback.print_exc()
        logger.exception("Import preview failed deck=%s", getattr(request, "deckName", ""))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/cards/import/apply")
def cards_import_apply(request: ImportRecordsRequest):
    try:
        logger.info("Import apply started deck=%s records=%s", request.deckName, len(request.records or []))
        normalized = [_normalize_import_record(r) for r in request.records or []]
        wanted = {r["expression"] for r in normalized if r["expression"]}
        if not wanted:
            return {"updated": 0, "notFoundCount": 0}

        notes = _get_deck_notes_info(request.deckName)
        if not notes:
            return {"updated": 0, "notFoundCount": len(wanted)}
            
        model_name = notes[0].get("modelName")
        mapping = _get_profile_mapping(model_name)
        
        expr_to_note: Dict[str, int] = {}
        for note in notes:
            note_id = note.get("noteId")
            if note_id is None:
                continue
            
            # Find expression using mapping or default
            expr_field = mapping.get("expression") if mapping else "Expression"
            expr = _get_note_field(note, expr_field)
            if not expr and not mapping:
                expr = _get_note_field(note, "Kanji") or _get_note_field(note, "Word")
                
            if expr and expr not in expr_to_note:
                expr_to_note[expr] = int(note_id)

        actions: List[Dict[str, Any]] = []
        for r in normalized:
            expr = r["expression"]
            if not expr or expr not in expr_to_note:
                continue

            note_id = expr_to_note[expr]
            fields_to_update: Dict[str, Any] = {}
            
            sentence_field = mapping.get("sentence") if mapping else "Sentence"
            translation_field = mapping.get("translation") if mapping else "SentenceTranslation"
            sentence_audio_field = mapping.get("sentence_audio") if mapping else "SentenceAudio"

            if r["sentence"]:
                fields_to_update[sentence_field] = r["sentence"]
            if r["translation"]:
                fields_to_update[translation_field] = r["translation"]
            if r["sentenceAudio"]:
                # If it's already a sound ref, keep it; otherwise treat it as filename
                s = r["sentenceAudio"]
                if "[sound:" in s:
                    fields_to_update[sentence_audio_field] = s
                else:
                    fields_to_update[sentence_audio_field] = f"[sound:{s}]"

            if fields_to_update:
                actions.append({
                    "action": "updateNoteFields",
                    "params": {
                        "note": {
                            "id": note_id,
                            "fields": fields_to_update
                        }
                    }
                })

        if not actions:
            return {"updated": 0, "notFoundCount": len(wanted)}

        anki.invoke("multi", {"actions": actions})

        not_found_count = len(wanted) - len({r["expression"] for r in normalized if r["expression"] and r["expression"] in expr_to_note})
        logger.info("Import apply completed deck=%s updated=%s notFound=%s", request.deckName, len(actions), not_found_count)
        return {"updated": len(actions), "notFoundCount": not_found_count}
    except Exception as e:
        traceback.print_exc()
        logger.exception("Import apply failed deck=%s", getattr(request, "deckName", ""))
        raise HTTPException(status_code=500, detail=str(e))


class AddImportedCardsRequest(BaseModel):
    deckName: str
    records: List[Dict[str, Any]] = []


@app.post("/api/cards/import/add")
def cards_import_add(request: AddImportedCardsRequest):
    try:
        logger.info("Import add started deck=%s records=%s", request.deckName, len(request.records or []))
        profile = _get_active_profile()
        model_name = (profile.get("selectedNoteType") or "").strip()
        if not model_name:
            raise HTTPException(status_code=400, detail="No selected Note Type in Settings (Mapping tab)")

        field_names = anki.get_model_field_names(model_name)
        field_set = set([str(x) for x in (field_names or []) if str(x)])
        if not field_set:
            raise HTTPException(status_code=400, detail="Selected Note Type has no fields")

        mapping = _get_profile_mapping(model_name)
        if not mapping:
            mapping = _infer_mapping_from_note_fields(list(field_set))

        expr_field = mapping.get("expression") or "Expression"
        existing_exprs = _get_deck_expression_set(request.deckName, mapping)

        def sound_wrap(value: str) -> Optional[str]:
            s = str(value or "").strip()
            if not s:
                return None
            if "[sound:" in s:
                return s
            if not s.lower().endswith(".mp3"):
                s = f"{s}.mp3"
            return f"[sound:{s}]"

        def maybe_store_tatoeba(audio_id: str) -> Optional[str]:
            base = str(audio_id or "").strip()
            if not base:
                return None
            lowered = base.lower()
            if lowered in {"undefined", "null", "none"}:
                return None

            # If provided as a [sound:...] tag, extract the inner filename/id
            if base.startswith("[sound:"):
                inner = base[len("[sound:") :]
                if inner.endswith("]"):
                    inner = inner[:-1]
                base = inner.strip()

            # If it already includes the tatoeba_ prefix, strip it
            if base.startswith("tatoeba_"):
                base = base[len("tatoeba_") :]

            # Remove .mp3 suffix if present
            if base.lower().endswith(".mp3"):
                base = base[:-4]

            base = base.strip()
            if not base.isdigit():
                return None

            filename = f"tatoeba_{base}.mp3"
            try:
                anki.invoke(
                    "storeMediaFile",
                    {"filename": filename, "url": f"https://tatoeba.org/en/audio/download/{base}"},
                )
            except Exception:
                traceback.print_exc()
                logger.warning("Tatoeba audio download failed audio_id=%s", base)
                return None
            return f"[sound:{filename}]"

        notes_payload: List[Dict[str, Any]] = []
        skipped_existing = 0
        skipped_missing_expr = 0
        skipped_existing_other_deck = 0
        skipped_existing_other_deck_top_deck = ""
        skipped_existing_other_deck_other_count = 0

        for rec in (request.records or []):
            entry = str(rec.get("entry") or rec.get("expression") or "").strip()
            if not entry:
                skipped_missing_expr += 1
                continue
            if entry in existing_exprs:
                skipped_existing += 1
                continue

            fields: Dict[str, Any] = {}

            if expr_field in field_set:
                fields[expr_field] = entry

            reading_field = mapping.get("reading")
            if reading_field and reading_field in field_set:
                reading = str(rec.get("reading") or "").strip()
                if reading:
                    fields[reading_field] = reading

            glossary_field = mapping.get("glossary")
            if glossary_field and glossary_field in field_set:
                glossary = str(rec.get("glossary") or rec.get("translation") or "").strip()
                if glossary:
                    fields[glossary_field] = glossary

            sentence_field = mapping.get("sentence")
            if sentence_field and sentence_field in field_set:
                sentence = str(rec.get("sentence") or "").strip()
                if sentence:
                    fields[sentence_field] = sentence

            sentence_tr_field = mapping.get("translation")
            if sentence_tr_field and sentence_tr_field in field_set:
                sentence_tr = str(rec.get("sentenceTranslation") or "").strip()
                if sentence_tr:
                    fields[sentence_tr_field] = sentence_tr

            expr_audio_field = mapping.get("expression_audio")
            if expr_audio_field and expr_audio_field in field_set:
                expr_audio = rec.get("audioFilename") or rec.get("audio") or ""
                wrapped = sound_wrap(str(expr_audio))
                if wrapped:
                    fields[expr_audio_field] = wrapped

            sentence_audio_field = mapping.get("sentence_audio")
            if sentence_audio_field and sentence_audio_field in field_set:
                raw = rec.get("sentenceAudioFilename") or rec.get("sentenceAudio") or ""
                raw_s = str(raw or "").strip()
                stored = maybe_store_tatoeba(raw_s)
                if stored:
                    fields[sentence_audio_field] = stored
                else:
                    wrapped = sound_wrap(raw_s)
                    if wrapped:
                        fields[sentence_audio_field] = wrapped

            if not fields:
                continue

            notes_payload.append(
                {
                    "deckName": request.deckName,
                    "modelName": model_name,
                    "fields": fields,
                    "options": {"allowDuplicate": False},
                }
            )

        if not notes_payload:
            logger.info(
                "Import add completed deck=%s added=0 skippedExisting=%s skippedMissingExpression=%s",
                request.deckName,
                skipped_existing,
                skipped_missing_expr,
            )
            return {
                "ok": True,
                "added": 0,
                "skippedExisting": skipped_existing,
                "skippedExistingOtherDeck": 0,
                "skippedExistingOtherDeckTopDeck": "",
                "skippedExistingOtherDeckOtherCount": 0,
                "skippedMissingExpression": skipped_missing_expr,
            }

        def _escape_anki_query_value(s: str) -> str:
            return str(s or "").replace("\\", "\\\\").replace('"', '\\"')

        def _escape_anki_query_field(s: str) -> str:
            return str(s or "").replace("\\", "\\\\").replace('"', '\\"')

        can_add = None
        try:
            can_add = anki.invoke("canAddNotes", {"notes": notes_payload})
        except Exception:
            can_add = None

        to_add = notes_payload
        blocked: List[Dict[str, Any]] = []
        if isinstance(can_add, list) and len(can_add) == len(notes_payload) and all(isinstance(x, bool) for x in can_add):
            to_add = []
            for i, ok in enumerate(can_add):
                if ok:
                    to_add.append(notes_payload[i])
                else:
                    blocked.append(notes_payload[i])

        skipped_existing_other_deck = len(blocked)
        if skipped_existing_other_deck:
            deck_counts: Dict[str, int] = {}
            for n in blocked[:50]:
                fields = n.get("fields") or {}
                entry = str(fields.get(expr_field) or "").strip()
                if not entry:
                    continue
                q = f"\"{_escape_anki_query_field(expr_field)}\":\"{_escape_anki_query_value(entry)}\""
                try:
                    note_ids = anki.invoke("findNotes", {"query": q}) or []
                    note_ids = [int(x) for x in note_ids if x is not None]
                except Exception:
                    continue
                if not note_ids:
                    continue
                try:
                    notes_info = anki.invoke("notesInfo", {"notes": note_ids}) or []
                    card_ids: List[int] = []
                    for ni in notes_info:
                        for cid in (ni.get("cards") or []):
                            try:
                                card_ids.append(int(cid))
                            except Exception:
                                continue
                    card_ids = list(dict.fromkeys(card_ids))
                    if not card_ids:
                        continue
                    cards_info = anki.invoke("cardsInfo", {"cards": card_ids}) or []
                    seen_decks: Set[str] = set()
                    for ci in cards_info:
                        dn = str(ci.get("deckName") or "").strip()
                        if not dn:
                            continue
                        if dn == request.deckName:
                            continue
                        seen_decks.add(dn)
                    if not seen_decks:
                        continue
                    picked = sorted(seen_decks)[0]
                    deck_counts[picked] = int(deck_counts.get(picked, 0)) + 1
                except Exception:
                    continue

            if deck_counts:
                top_deck, top_count = max(deck_counts.items(), key=lambda kv: kv[1])
                skipped_existing_other_deck_top_deck = top_deck
                skipped_existing_other_deck_other_count = max(0, skipped_existing_other_deck - int(top_count))
            else:
                skipped_existing_other_deck_top_deck = ""
                skipped_existing_other_deck_other_count = 0

        result = anki.invoke("addNotes", {"notes": to_add}) if to_add else []
        note_ids = [x for x in (result or []) if x]
        logger.info(
            "Import add completed deck=%s added=%s attempted=%s skippedExisting=%s skippedMissingExpression=%s",
            request.deckName,
            len(note_ids),
            len(notes_payload),
            skipped_existing,
            skipped_missing_expr,
        )
        return {
            "ok": True,
            "added": len(note_ids),
            "attempted": len(notes_payload),
            "skippedExisting": skipped_existing,
            "skippedExistingOtherDeck": skipped_existing_other_deck,
            "skippedExistingOtherDeckTopDeck": skipped_existing_other_deck_top_deck,
            "skippedExistingOtherDeckOtherCount": skipped_existing_other_deck_other_count,
            "skippedMissingExpression": skipped_missing_expr,
            "noteIds": note_ids,
        }
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        logger.exception("Import add failed deck=%s", getattr(request, "deckName", ""))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/anki/version")
def anki_version():
    try:
        return {"version": anki.invoke("version")}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    
class UpdatePayload(BaseModel):
    jp: Optional[str] = None
    en: Optional[str] = None
    glossary: Optional[str] = None
    sentence_audio: Optional[str] = None
    expression_audio: Optional[str] = None

class OpenBrowseRequest(BaseModel):
    noteIds: List[int]

@app.post("/api/notes/{note_id}/update")
def update_note_endpoint(note_id: int, payload: UpdatePayload):
    try:
        logger.info("Note update started note_id=%s", note_id)
        
        # Get model name to find mapping
        note_info = anki.invoke("notesInfo", {"notes": [note_id]})
        mapping = None
        if note_info and note_info[0]:
            model_name = note_info[0].get("modelName")
            mapping = _get_profile_mapping(model_name)

            note_fields = note_info[0].get("fields") or {}
            field_names = list(note_fields.keys()) if isinstance(note_fields, dict) else []
            inferred = _infer_mapping_from_note_fields(field_names)
            mapping = {**(inferred or {}), **(mapping or {})}

        if (
            payload.jp is None
            and payload.en is None
            and payload.glossary is None
            and payload.sentence_audio is None
            and payload.expression_audio is None
        ):
            raise HTTPException(status_code=400, detail="No fields to update")

        # Detect if sentence_audio is actually a Tatoeba audio id (numeric or tatoeba_xxx)
        audio_id_param = None
        sentence_audio_for_update = payload.sentence_audio
        if payload.sentence_audio:
            raw = str(payload.sentence_audio or "").strip()
            # ignore explicit [sound:...] tags
            if raw and not raw.startswith("[sound:"):
                # patterns: numeric ("12345"), numeric.mp3 ("12345.mp3"), or tatoeba_12345(.mp3)
                import re

                if re.fullmatch(r"\d+", raw) or re.fullmatch(r"\d+\.mp3", raw) or re.fullmatch(r"tatoeba_\d+", raw) or re.fullmatch(r"tatoeba_\d+\.mp3", raw):
                    audio_id_param = raw
                    # clear sentence_audio so `anki.update_note` will handle storing the Tatoeba media
                    sentence_audio_for_update = None

        anki.update_note(
            note_id,
            jp=payload.jp,
            en=payload.en,
            glossary=payload.glossary,
            sentence_audio=sentence_audio_for_update,
            expression_audio=payload.expression_audio,
            audio_id=audio_id_param,
            mapping=mapping,
        )
        logger.info("Note update completed note_id=%s", note_id)
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.exception("Note update failed note_id=%s", note_id)
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}

@app.post("/api/notes/{note_id}/open")
def view_note_in_gui_endpoint(note_id: int):
    anki.view_note_in_gui(note_id)
    return {"status": "ok"}

@app.post("/api/notes/open-browse")
def open_notes_in_browser(req: OpenBrowseRequest):
    note_ids = [int(x) for x in (req.noteIds or []) if x is not None]
    note_ids = list(dict.fromkeys(note_ids))
    if not note_ids:
        raise HTTPException(status_code=400, detail="noteIds required")

    max_notes = 500
    opened = note_ids[:max_notes]
    query = " OR ".join([f"nid:{nid}" for nid in opened])
    anki.invoke("guiBrowse", {"query": query})
    logger.info("Open browse completed opened=%s totalRequested=%s truncated=%s", len(opened), len(note_ids), len(note_ids) > max_notes)
    return {"ok": True, "opened": len(opened), "totalRequested": len(note_ids), "truncated": len(note_ids) > max_notes}

@app.post("/api/notes/{note_id}/clear-sentence")
def clear_sentence_fields(note_id: int, request: ClearFieldsRequest):
    try:
        logger.info("Clear fields started note_id=%s fields=%s", note_id, len(request.fields or []))
        # 1. Get current note info to verify fields exist
        note_info = anki.invoke("notesInfo", {"notes": [note_id]})
        if not note_info or not note_info[0]:
            raise HTTPException(status_code=404, detail="Note not found in Anki")
            
        existing_fields = list(note_info[0].get("fields", {}).keys())

        # Build a normalization map for robust matching (handles spaces/underscores/casing)
        def _normalize(name: str) -> str:
            import re
            return re.sub(r"[^0-9a-z]", "", (name or "").lower())

        normalized_to_actual = { _normalize(name): name for name in existing_fields }

        # 2. Match requested fields against existing fields using normalization
        valid_fields = []
        for f in (request.fields or []):
            if not f:
                continue
            # direct exact match first
            if f in existing_fields:
                valid_fields.append(f)
                continue
            # normalized match
            norm = _normalize(f)
            matched = normalized_to_actual.get(norm)
            if matched:
                valid_fields.append(matched)

        if not valid_fields:
            return {"ok": True, "message": "No valid fields found to clear"}

        update_fields = {field: "" for field in valid_fields}

        anki.invoke("updateNoteFields", {
            "note": {
                "id": note_id,
                "fields": update_fields
            }
        })
        logger.info("Clear fields completed note_id=%s cleared=%s", note_id, len(valid_fields))
        return {"ok": True, "cleared": valid_fields}
        
    except Exception as e:
        traceback.print_exc()
        logger.exception("Clear fields failed note_id=%s", note_id)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
