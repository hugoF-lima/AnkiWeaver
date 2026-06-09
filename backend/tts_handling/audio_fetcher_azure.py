import os
from pathlib import Path
import hashlib
import requests
from tqdm import tqdm
from dotenv import load_dotenv
from typing import Optional


#This goes for the .env file to retrieve keys and etc
env_path = Path(__file__).resolve().parent.parent.parent / '.env'

# 2. Load the file
load_dotenv(dotenv_path=env_path)

# 3. Grab ONLY what you want
AZURE_SPEECH_KEY = os.getenv("AZURE_SPEECH_KEY")


AZURE_SPEECH_REGION = "brazilsouth"

AZURE_TTS_VOICES = [
    {"id": "ja-JP-NanamiNeural", "label": "Nanami"},
    {"id": "ja-JP-KeitaNeural", "label": "Keita"},
    {"id": "ja-JP-AoiNeural", "label": "Aoi"},
    {"id": "ja-JP-DaichiNeural", "label": "Daichi"},
    {"id": "ja-JP-MayuNeural", "label": "Mayu"},
    {"id": "ja-JP-NaokiNeural", "label": "Naoki"},
    {"id": "ja-JP-ShioriNeural", "label": "Shiori"},
]

#old path, i needed a script to figure out where the Anki2 might live.
#AUDIO_CACHE_DIR = os.path.expanduser("~/.local/share/Anki2/hugol/collection.media/")

#Ensure dir is valid
AUDIO_CACHE_DIR = os.path.expanduser("~/.var/app/net.ankiweb.Anki/data/Anki2/hugol/collection.media/")

VOICE_NAME = AZURE_TTS_VOICES[0]["id"]  # safe default

def audio_filename(expression, reading):
    key = f"{expression}|{reading}"
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()[:10]
    return f"jp_tts_{digest}.mp3"

def synth_az_tts_sentence(
    text,
    output_path,
    azure_speech_key: Optional[str] = None,
    azure_speech_region: Optional[str] = None,
    voice_name: Optional[str] = None,
):
    output_path = str(output_path)

    # Cache hit
    if os.path.exists(output_path):
        return True

    key = (azure_speech_key or AZURE_SPEECH_KEY or "").strip()
    region = (azure_speech_region or AZURE_SPEECH_REGION or "").strip()
    voice = (voice_name or VOICE_NAME or "").strip()
    if not key or not region or not voice:
        return False

    endpoint = (
        f"https://{region}.tts.speech.microsoft.com/"
        "cognitiveservices/v1"
    )

    ssml = f"""
    <speak version="1.0" xml:lang="ja-JP">
      <voice name="{voice}">
        {text}
      </voice>
    </speak>
    """.strip()

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        "User-Agent": "AnkiTTS"
    }

    r = requests.post(
        endpoint,
        headers=headers,
        data=ssml.encode("utf-8"),
        timeout=(3, 10)
    )

    if r.status_code != 200 or not r.content:
        return False

    with open(output_path, "wb") as f:
        f.write(r.content)

    return True


def synthesize_azure_tts(
    text,
    filename,
    azure_speech_key: Optional[str] = None,
    azure_speech_region: Optional[str] = None,
    voice_name: Optional[str] = None,
):
    path = os.path.join(AUDIO_CACHE_DIR, filename)

    # Cache hit
    if os.path.exists(path):
        return True

    key = (azure_speech_key or AZURE_SPEECH_KEY or "").strip()
    region = (azure_speech_region or AZURE_SPEECH_REGION or "").strip()
    voice = (voice_name or VOICE_NAME or "").strip()
    if not key or not region or not voice:
        return False

    endpoint = (
        f"https://{region}.tts.speech.microsoft.com/"
        "cognitiveservices/v1"
    )

    ssml = f"""
    <speak version="1.0" xml:lang="ja-JP">
        <voice name="{voice}">
            {text}
        </voice>
    </speak>
    """.strip()

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        "User-Agent": "AnkiTTS"
    }

    r = requests.post(
        endpoint,
        headers=headers,
        data=ssml.encode("utf-8"),
        timeout=(3, 10)
    )

    if r.status_code != 200 or not r.content:
        return False

    with open(path, "wb") as f:
        f.write(r.content)

    return True

def resolve_audio_entry(entry):
    expression = entry["Expression"]
    reading = entry["Reading"]

    filename = audio_filename(expression, reading)

    ok = synthesize_azure_tts(reading, filename)

    if ok:
        entry["Audio"] = {
            "status": "resolved",
            "filename": filename
        }
    else:
        entry["Audio"] = {
            "status": "unavailable"
        }

def resolve_audio_batch(structures):
    if not isinstance(structures, list):
        raise TypeError("resolve_audio_batch expects a list")

    # 1️⃣ Unique keys
    unique_keys = {
        (e["Expression"], e["Reading"])
        for e in structures
    }

    resolved = {}

    # 2️⃣ Generate audio once per unique word
    for expression, reading in unique_keys:
        dummy = {
            "Expression": expression,
            "Reading": reading
        }

        resolve_audio_entry(dummy)
        resolved[(expression, reading)] = dummy["Audio"]

    # 3️⃣ Apply to all entries
    for entry in tqdm(structures, desc="Fetching audio"):
        key = (entry["Expression"], entry["Reading"])
        entry["Audio"] = resolved.get(
            key, {"status": "unavailable"}
        )
