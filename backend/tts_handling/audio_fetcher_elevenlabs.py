import os
from typing import Dict, List, Optional

import requests


ELEVEN_LABS_DEFAULT_MODEL_ID = "eleven_multilingual_v2"
ELEVEN_LABS_DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"

# Curated Japanese-capable voices (eleven_multilingual_v2); static list avoids slow /v1/voices API calls.
ELEVENLABS_TTS_VOICES = [
    {"id": "EXAVITQu4vr4xnSDxMaL", "label": "Sarah"},
    {"id": "pNInz6obpgDQGcFmaJgB", "label": "Adam"},
]


def list_elevenlabs_voices(api_key: Optional[str]) -> List[Dict[str, str]]:
    key = (api_key or os.getenv("ELEVEN_LABS_SPEECH_KEY") or "").strip()
    if not key:
        return []

    try:
        response = requests.get(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": key},
            timeout=10,
        )
        if response.status_code != 200:
            return []
        data = response.json() if response.content else {}
        voices = data.get("voices") if isinstance(data, dict) else []
        out: List[Dict[str, str]] = []
        for voice in voices or []:
            voice_id = str(voice.get("voice_id") or "").strip()
            name = str(voice.get("name") or voice_id).strip()
            if not voice_id:
                continue
            out.append({"voice_id": voice_id, "name": name})
        return out
    except Exception:
        return []


def synth_elevenlabs_tts(
    text: str,
    output_path: str,
    elevenlabs_api_key: Optional[str] = None,
    voice_id: Optional[str] = None,
    model_id: Optional[str] = None,
) -> bool:
    output_path = str(output_path)
    if os.path.exists(output_path):
        return True

    key = (elevenlabs_api_key or os.getenv("ELEVEN_LABS_SPEECH_KEY") or "").strip()
    resolved_voice_id = (voice_id or ELEVEN_LABS_DEFAULT_VOICE_ID or "").strip()
    resolved_model_id = (model_id or ELEVEN_LABS_DEFAULT_MODEL_ID or "").strip()
    if not key or not resolved_voice_id or not resolved_model_id or not str(text or "").strip():
        return False

    response = requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{resolved_voice_id}",
        headers={
            "xi-api-key": key,
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
        },
        json={
            "text": text,
            "model_id": resolved_model_id,
        },
        timeout=(5, 30),
    )

    if response.status_code != 200 or not response.content:
        return False

    with open(output_path, "wb") as file_obj:
        file_obj.write(response.content)

    return True
