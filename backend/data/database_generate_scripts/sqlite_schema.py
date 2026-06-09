import sqlite3
from tatoebatools import tatoeba

DB_PATH = "tatoeba-multi-lang.db"

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

# ---------- create tables ----------
cur.executescript("""
DROP TABLE IF EXISTS sentences;
DROP TABLE IF EXISTS audio;
DROP TABLE IF EXISTS links;

CREATE TABLE sentences (
    id INTEGER PRIMARY KEY,
    lang TEXT NOT NULL,
    text TEXT NOT NULL
);

CREATE INDEX idx_sentences_lang ON sentences(lang);

CREATE TABLE audio (
    sentence_id INTEGER,
    audio_id INTEGER,
    PRIMARY KEY (sentence_id, audio_id)
);

CREATE TABLE links (
    sentence_id INTEGER,
    translation_id INTEGER,
    PRIMARY KEY (sentence_id, translation_id)
);

CREATE INDEX idx_links_sentence_id ON links(sentence_id);
CREATE INDEX idx_links_translation_id ON links(translation_id);
""")

conn.commit()

# ---------- import sentences ----------
print("Importing sentences (JP + EN + PT)...")

sentence_rows = []

for lang in ("jpn", "eng", "por"):
    for s in tatoeba.sentences_detailed(lang):
        sentence_rows.append((s.sentence_id, lang, s.text))

        if len(sentence_rows) >= 5000:
            cur.executemany(
                "INSERT OR IGNORE INTO sentences VALUES (?, ?, ?)",
                sentence_rows
            )
            conn.commit()
            sentence_rows.clear()

# flush remainder
if sentence_rows:
    cur.executemany(
        "INSERT OR IGNORE INTO sentences VALUES (?, ?, ?)",
        sentence_rows
    )
    conn.commit()

# ---------- import audio ----------
print("Importing JP audio metadata...")

audio_rows = []

for a in tatoeba.sentences_with_audio("jpn"):
    audio_rows.append((a.sentence_id, a.audio_id))

    if len(audio_rows) >= 5000:
        cur.executemany(
            "INSERT OR IGNORE INTO audio VALUES (?, ?)",
            audio_rows
        )
        conn.commit()
        audio_rows.clear()

if audio_rows:
    cur.executemany(
        "INSERT OR IGNORE INTO audio VALUES (?, ?)",
        audio_rows
    )
    conn.commit()

# ---------- import links (JP -> EN, JP -> PT) ----------
link_rows = []

for source_lang, target_lang in (("jpn", "eng"), ("jpn", "por")):
    print(f"Importing {source_lang.upper()} → {target_lang.upper()} links...")

    for l in tatoeba.links(source_lang, target_lang):
        link_rows.append((l.sentence_id, l.translation_id))

        if len(link_rows) >= 5000:
            cur.executemany(
                "INSERT OR IGNORE INTO links VALUES (?, ?)",
                link_rows
            )
            conn.commit()
            link_rows.clear()

if link_rows:
    cur.executemany(
        "INSERT OR IGNORE INTO links VALUES (?, ?)",
        link_rows
    )
    conn.commit()

conn.close()
print("Done.")
