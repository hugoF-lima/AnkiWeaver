from pathlib import Path
import sqlite3
import traceback

DB_PATH = Path(__file__).parent / "data" / "tatoeba.db"

def search_sentences(word, page=0, per_page=10):
    try:
      conn = sqlite3.connect(DB_PATH)
      cur = conn.cursor()

      offset = page * per_page

      cur.execute("""
      SELECT
        s.id,
        s.text,
        MIN(e.text) AS en,
        a.audio_id,
        a.sentence_id IS NOT NULL AS has_audio
      FROM sentences s
      LEFT JOIN links l ON l.sentence_id = s.id
      LEFT JOIN sentences e ON e.id = l.translation_id AND e.lang = 'eng'
      LEFT JOIN audio a ON a.sentence_id = s.id
      WHERE s.lang = 'jpn'
        AND s.text LIKE ?
      GROUP BY s.id
      ORDER BY has_audio DESC
      LIMIT ? OFFSET ?
      """, (f"%{word}%", per_page, offset))

      rows = cur.fetchall()
      conn.close()
    except Exception:
       traceback.print_exc()
       raise

    return [
    {
        "jp": jp,
        "en": en or "",
        "has_audio": bool(has_audio),
        "audio_id": audio_id
    }
    for _, jp, en, audio_id, has_audio in rows
]