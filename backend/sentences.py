from pathlib import Path
import logging
import sqlite3
import traceback

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(__file__).parent / "data"

logger = logging.getLogger("ankiweaver")

def get_default_db_path() -> Path:
    preferred = DATA_DIR / "tatoeba-multi-lang.db"
    if preferred.exists():
        return preferred
    fallback = DATA_DIR / "tatoeba.db"
    return fallback

def resolve_db_path(configured_path: str = "") -> Path:
    raw = str(configured_path or "").strip()
    if raw:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = PROJECT_ROOT / candidate
        return candidate.resolve()
    return get_default_db_path().resolve()

def search_sentences(word, page=0, per_page=10, randomize: bool = False, db_path: str = ""):
    resolved_db_path = resolve_db_path(db_path)
    try:
      if not resolved_db_path.exists():
        raise FileNotFoundError(f"Sentence database not found: {resolved_db_path}")
      conn = sqlite3.connect(resolved_db_path)
      try:
        cur = conn.cursor()
        offset = page * per_page

        order_by = "ORDER BY has_audio DESC"
        if randomize:
          # Randomize while still preferring entries that have audio
          order_by = "ORDER BY has_audio DESC, RANDOM()"

        cur.execute("""
      SELECT
        s.id,
        s.text,
        (
          SELECT MIN(t.text)
          FROM links l
          JOIN sentences t ON t.id = l.translation_id
          WHERE l.sentence_id = s.id
            AND t.lang = 'eng'
        ) AS en,
        (
          SELECT MIN(t.text)
          FROM links l
          JOIN sentences t ON t.id = l.translation_id
          WHERE l.sentence_id = s.id
            AND t.lang = 'por'
        ) AS pt,
        (
          SELECT MIN(a.audio_id)
          FROM audio a
          WHERE a.sentence_id = s.id
        ) AS audio_id,
        EXISTS(
          SELECT 1
          FROM audio a
          WHERE a.sentence_id = s.id
        ) AS has_audio
      FROM sentences s
      WHERE s.lang = 'jpn'
        AND s.text LIKE ?
      {order_by}
      LIMIT ? OFFSET ?
      """.format(order_by=order_by), (f"%{word}%", per_page, offset))

        rows = cur.fetchall()
      finally:
        try:
          conn.close()
        except Exception:
          pass
    except Exception:
       logger.exception(
         "SQLite sentence lookup failed word=%s page=%s per_page=%s randomize=%s db=%s",
         word,
         page,
         per_page,
         bool(randomize),
         str(resolved_db_path),
       )
       traceback.print_exc()
       raise

    return [
    {
        "jp": jp,
        "en": en or "",
        "pt": pt or "",
        "has_audio": bool(has_audio),
        "audio_id": audio_id
    }
    for _, jp, en, pt, audio_id, has_audio in rows
]
