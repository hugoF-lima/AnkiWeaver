import sqlite3

DB_PATH = "tatoeba-multi-lang.db"

def generate_ngrams(text, min_n=2, max_n=3):
    ngrams = []
    length = len(text)
    for n in range(min_n, max_n + 1):
        for i in range(length - n + 1):
            chunk = text[i:i+n]
            if not chunk.isspace():
                ngrams.append(chunk)
    return " ".join(ngrams)

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

print("Recreating FTS5 table (manual n-grams)...")

cur.execute("DROP TABLE IF EXISTS sentences_fts")

cur.execute("""
CREATE VIRTUAL TABLE sentences_fts
USING fts5(text)
""")

conn.commit()

print("Populating FTS5 index with JP n-grams from multi-lang DB...")

batch = []

for sid, text in cur.execute(
    "SELECT id, text FROM sentences WHERE lang = 'jpn'"
):
    ngram_text = generate_ngrams(text)
    batch.append((sid, ngram_text))

    if len(batch) >= 1000:
        cur.executemany(
            "INSERT INTO sentences_fts(rowid, text) VALUES (?, ?)",
            batch
        )
        conn.commit()
        batch.clear()

if batch:
    cur.executemany(
        "INSERT INTO sentences_fts(rowid, text) VALUES (?, ?)",
        batch
    )
    conn.commit()

conn.close()
print("FTS5 n-gram index complete.")
