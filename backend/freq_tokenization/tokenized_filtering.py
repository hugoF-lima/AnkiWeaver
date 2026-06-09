from __future__ import annotations


import csv
import json
import sys
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set
from sudachipy import dictionary, tokenizer

from freq_tokenization.yomitan_loader import FrequencyEntry


# -----------------------------
# DATA MODELS
# -----------------------------

@dataclass
class TokenEntry:

    surface: str
    dictionary_form: str
    reading: str
    pos: str
    kana: Optional[str] = None
    translation: str = ""
    sentence: str = ""
    sentence_translation: str = ""
    expression_audio: str = ""
    sentence_audio: str = ""

    occurrences: int = 1

    frequency: Optional[int] = None
    frequency_source: Optional[str] = None

    jlpt_level: Optional[int] = None
    tags: Set[str] = field(default_factory=set)


# -----------------------------
# SUDACHIPY SETUP
# -----------------------------

tokenizer_obj = dictionary.Dictionary().create()

SPLIT_MODE = tokenizer.Tokenizer.SplitMode.A

_lemma_reading_cache: dict[str, str] = {}

def _derive_reading_katakana(text: str, fallback: str = "") -> str:
    key = (text or "").strip()
    if not key:
        return (fallback or "").strip()
    cached = _lemma_reading_cache.get(key)
    if cached is not None:
        return cached
    try:
        morphemes = tokenizer_obj.tokenize(key, SPLIT_MODE)
        morphemes = [m for m in morphemes if m.part_of_speech()[0] not in {"補助記号", "空白"}]
        reading = "".join(m.reading_form() for m in morphemes).strip()
        if not reading:
            reading = (fallback or "").strip()
    except Exception:
        reading = (fallback or "").strip()
    _lemma_reading_cache[key] = reading
    return reading


def _pick_head_morpheme(morphemes: list[Any]) -> Any:
    for m in morphemes:
        try:
            pos0 = m.part_of_speech()[0]
        except Exception:
            pos0 = ""
        if pos0 in {"補助記号", "空白", "助動詞", "助詞"}:
            continue
        return m
    return morphemes[0] if morphemes else None


# -----------------------------
# TOKENIZATION
# -----------------------------

def build_token_table(text: str) -> List[TokenEntry]:

    morphemes = tokenizer_obj.tokenize(text, SPLIT_MODE)

    temp_tokens = []

    for m in morphemes:

        pos = m.part_of_speech()[0]

        if pos in ["補助記号", "空白"]:
            continue

        dictionary_form = m.dictionary_form() or m.surface()
        reading_katakana = _derive_reading_katakana(dictionary_form, fallback=m.reading_form())
        token = TokenEntry(
            surface=m.surface(),
            dictionary_form=dictionary_form,
            reading=reading_katakana,
            pos=pos,
            kana=_katakana_to_hiragana(reading_katakana)
        )

        temp_tokens.append(token)

    # Count occurrences by dictionary form
    counts = Counter(t.dictionary_form for t in temp_tokens)

    # Deduplicate
    unique_tokens = {}

    for token in temp_tokens:

        key = token.dictionary_form

        if key not in unique_tokens:

            token.occurrences = counts[key]

            unique_tokens[key] = token

    return list(unique_tokens.values())


# -----------------------------
# ENRICHMENT
# -----------------------------

def enrich_with_frequency(
    tokens: List[TokenEntry],
    frequency_index: Dict[str, FrequencyEntry]
):

    for token in tokens:

        entry = frequency_index.get(token.dictionary_form)

        if entry:

            token.frequency = entry.value
            token.frequency_source = entry.source


def enrich_with_jlpt_level(
    tokens: List[TokenEntry],
    jlpt_index: Dict[str, FrequencyEntry]
):
    for token in tokens:
        entry = jlpt_index.get(token.dictionary_form)
        if entry:
            token.jlpt_level = entry.value


# -----------------------------
# SORTING
# -----------------------------

def sort_by_frequency(
    tokens: List[TokenEntry]
) -> List[TokenEntry]:

    return sorted(
        tokens,
        key=lambda t: t.frequency if t.frequency is not None else 999999
    )


# -----------------------------
# DISPLAY
# -----------------------------

def print_table(tokens: List[TokenEntry], out=None):
    if out is None:
        out = sys.stdout

    for token in tokens:

        dictionary_form = token.dictionary_form or token.surface or ""
        frequency = token.frequency if token.frequency is not None else ""
        jlpt = ""
        jlpt_tag = _jlpt_tag_from_value(token.jlpt_level)
        if jlpt_tag is not None:
            jlpt = jlpt_tag.replace("JLPT_", "")
        pos = token.pos or ""
        kana = token.kana or _katakana_to_hiragana(token.reading or "")
        tags = ""
        if token.tags:
            tags = "|".join(sorted(token.tags))
        else:
            tags = "|".join(sorted(_compute_tags(token)))
        translation = token.translation or ""

        print(
            f"{dictionary_form:<15}"
            f"freq={frequency:<8}"
            f"jlpt={jlpt:<3}"
            f"occ={token.occurrences:<5}"
            f"pos={pos}"
            f" kana={kana}"
            f" tags={tags}"
            f" translation={translation}"
            ,
            file=out
        )


def _is_hiragana_char(c: str) -> bool:
    o = ord(c)
    return 0x3041 <= o <= 0x309F


def _is_katakana_char(c: str) -> bool:
    o = ord(c)
    if 0x30A0 <= o <= 0x30FF:
        return True
    if 0x31F0 <= o <= 0x31FF:
        return True
    if 0xFF66 <= o <= 0xFF9F:
        return True
    return o in (0xFF70,)


def _is_kanji_char(c: str) -> bool:
    o = ord(c)
    if 0x4E00 <= o <= 0x9FFF:
        return True
    if 0x3400 <= o <= 0x4DBF:
        return True
    return o in (0x3005,)


def _katakana_to_hiragana(text: str) -> str:
    if not text:
        return ""

    out = []
    for c in text:
        o = ord(c)
        if 0x30A1 <= o <= 0x30F6:
            out.append(chr(o - 0x60))
        else:
            out.append(c)
    return "".join(out)


def _script_tag(text: str) -> str:
    if not text:
        return "SCRIPT_MIX"

    if all(_is_katakana_char(c) for c in text):
        return "SCRIPT_KATA"
    if all(_is_hiragana_char(c) for c in text):
        return "SCRIPT_HIRA"
    if all(_is_kanji_char(c) for c in text):
        return "SCRIPT_KANJI"
    return "SCRIPT_MIX"


def _type_tag(pos: str) -> str:
    if pos in {"助詞", "助動詞", "接続詞", "連体詞", "代名詞"}:
        return "FUNC"
    if pos in {"接頭辞", "接尾辞"}:
        return "AFFIX"
    if pos in {"名詞", "動詞", "形容詞", "副詞", "形状詞"}:
        return "CONTENT"
    return "OTHER"


def _jlpt_tag_from_value(value: Optional[int]) -> Optional[str]:
    if value is None:
        return None
    if 1 <= value <= 5:
        n = 6 - value
        return f"JLPT_N{n}"
    return None


def _default_too_common_lemmas() -> set[str]:
    return {
        "する",
        "ある",
        "いる",
        "なる",
        "できる",
        "いう",
        "行う",
        "と",
        "の",
        "で",
        "は",
        "が",
        "に",
        "へ",
        "を",
        "て",
        "た",
        "だ",
        "ない"
    }


def _compute_tags(
    token: TokenEntry,
    too_common_occurrences: int = 10,
    too_common_lemmas: set[str] | None = None
) -> Set[str]:
    if too_common_lemmas is None:
        too_common_lemmas = _default_too_common_lemmas()

    tags: Set[str] = set()

    tags.add(_script_tag(token.dictionary_form))
    tags.add(_type_tag(token.pos or ""))

    jlpt_tag = _jlpt_tag_from_value(token.jlpt_level)
    if jlpt_tag is None:
        tags.add("REF_MISSING")
    else:
        tags.add("REF_PRESENT")
        tags.add(jlpt_tag)

    if token.occurrences >= too_common_occurrences or token.dictionary_form in too_common_lemmas:
        tags.add("TOO_COMMON")

    return tags


def _normalize_column_name(name: str) -> str:
    return (name or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")


def _column_score(header: str, sample_values: list[str]) -> dict[str, int]:
    h = _normalize_column_name(header)
    score = {"vocab": 0, "kana": 0, "translation": 0}

    vocab_names = {"kanji", "vocab", "word", "expression", "term", "front", "japanese", "jp"}
    kana_names = {"kana", "reading", "yomi", "yomigana", "pronunciation", "furigana"}
    translation_names = {"english", "meaning", "translation", "definition", "gloss", "back", "en"}

    if h in vocab_names:
        score["vocab"] += 5
    if h in kana_names:
        score["kana"] += 5
    if h in translation_names:
        score["translation"] += 5

    for v in sample_values:
        if not v:
            continue

        has_ascii = any("A" <= c <= "Z" or "a" <= c <= "z" for c in v)
        has_kanji = any(_is_kanji_char(c) for c in v)
        all_kanaish = all(_is_hiragana_char(c) or _is_katakana_char(c) or c in {"ー", "・"} for c in v)

        if has_ascii:
            score["translation"] += 1
        if has_kanji:
            score["vocab"] += 1
        if all_kanaish:
            score["kana"] += 1

    return score


def infer_csv_columns(csv_path: str, sample_size: int = 50) -> dict[str, Optional[str]]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(8192)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t", "|"])
        except Exception:
            dialect = csv.get_dialect("excel")

        reader = csv.DictReader(f, dialect=dialect)
        if not reader.fieldnames:
            return {"vocab": None, "kana": None, "translation": None}

        fieldnames = list(reader.fieldnames)
        samples = []
        for _, row in zip(range(sample_size), reader):
            samples.append(row)

    per_col_scores = []
    for col in fieldnames:
        values = [str(r.get(col, "") or "") for r in samples]
        per_col_scores.append((col, _column_score(col, values)))

    chosen: dict[str, Optional[str]] = {"vocab": None, "kana": None, "translation": None}
    used = set()
    for key in ("vocab", "kana", "translation"):
        best_col = None
        best_score = -1
        for col, score in per_col_scores:
            if col in used:
                continue
            if score[key] > best_score:
                best_score = score[key]
                best_col = col
        if best_col is not None and best_score > 0:
            chosen[key] = best_col
            used.add(best_col)

    return chosen


def build_token_table_from_csv(
    csv_path: str,
    vocab_column: Any,
    kana_column: Optional[Any] = None,
    translation_column: Optional[Any] = None,
    sentence_column: Optional[Any] = None,
    sentence_translation_column: Optional[Any] = None,
    expression_audio_column: Optional[Any] = None,
    sentence_audio_column: Optional[Any] = None,
    delimiter: Optional[str] = None,
) -> List[TokenEntry]:
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(8192)
        f.seek(0)
        if delimiter and len(delimiter) == 1:
            delim = delimiter
        else:
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t", "|"])
                delim = dialect.delimiter
            except Exception:
                delim = ","

        reader = csv.reader(f, delimiter=delim)
        all_rows = list(reader)

    if not all_rows:
        return []

    header = [str(x or "").strip() for x in (all_rows[0] or [])]
    mapping_values = [
        vocab_column,
        kana_column,
        translation_column,
        sentence_column,
        sentence_translation_column,
        expression_audio_column,
        sentence_audio_column,
    ]
    header_looks_present = any(isinstance(v, str) and v in header for v in mapping_values if v)

    data_rows = all_rows[1:] if header_looks_present else all_rows
    header_index: dict[str, int] = {h: i for i, h in enumerate(header)} if header_looks_present else {}

    def _coerce_index(col: Any) -> Optional[int]:
        if col is None:
            return None
        if isinstance(col, int):
            return col
        if isinstance(col, str):
            s = col.strip()
            if s.isdigit():
                return int(s)
        return None

    def _get_cell(row: list[Any], col: Any) -> str:
        if col is None:
            return ""
        idx = _coerce_index(col)
        if idx is None:
            if isinstance(col, str) and col in header_index:
                idx = header_index[col]
            else:
                return ""
        if idx < 0 or idx >= len(row):
            return ""
        return str(row[idx] or "").strip()

    temp_tokens: list[TokenEntry] = []
    for row in data_rows:
        vocab = _get_cell(row, vocab_column)
        if not vocab:
            continue

        kana = _get_cell(row, kana_column) if kana_column is not None else ""
        translation = _get_cell(row, translation_column) if translation_column is not None else ""
        sentence = _get_cell(row, sentence_column) if sentence_column is not None else ""
        sentence_translation = (
            _get_cell(row, sentence_translation_column) if sentence_translation_column is not None else ""
        )
        expression_audio = _get_cell(row, expression_audio_column) if expression_audio_column is not None else ""
        sentence_audio = _get_cell(row, sentence_audio_column) if sentence_audio_column is not None else ""

        morphemes = tokenizer_obj.tokenize(vocab, SPLIT_MODE)
        morphemes = [m for m in morphemes if m.part_of_speech()[0] not in {"補助記号", "空白"}]

        if not morphemes:
            pos = ""
            dictionary_form = vocab
            reading = kana
        else:
            head = _pick_head_morpheme(morphemes) or morphemes[0]
            pos = head.part_of_speech()[0]
            dictionary_form = head.dictionary_form() or vocab
            reading = _derive_reading_katakana(dictionary_form, fallback=head.reading_form())

        token = TokenEntry(
            surface=vocab,
            dictionary_form=dictionary_form,
            reading=reading,
            pos=pos,
            kana=kana or _katakana_to_hiragana(reading),
            translation=translation,
            sentence=sentence,
            sentence_translation=sentence_translation,
            expression_audio=expression_audio,
            sentence_audio=sentence_audio,
        )
        temp_tokens.append(token)

    counts = Counter(t.dictionary_form for t in temp_tokens)
    unique_tokens: dict[str, TokenEntry] = {}
    for token in temp_tokens:
        key = token.dictionary_form
        if key not in unique_tokens:
            token.occurrences = counts[key]
            unique_tokens[key] = token

    return list(unique_tokens.values())


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        parts = [_as_text(v) for v in value]
        parts = [p for p in parts if p]
        return "; ".join(parts)
    if isinstance(value, dict):
        for k in ("text", "value", "meaning", "gloss", "definition"):
            if k in value:
                return _as_text(value.get(k))
        return ""
    return ""


def _get_by_dotted_path(obj: Any, path: Any) -> Any:
    if obj is None:
        return None
    if not path or not isinstance(path, str):
        return None
    parts = [p for p in path.split(".") if p]
    if not parts:
        return None

    def walk(node: Any, idx: int) -> Any:
        if idx >= len(parts):
            return node
        key = parts[idx]
        if isinstance(node, dict):
            return walk(node.get(key), idx + 1)
        if isinstance(node, list):
            for item in node:
                v = walk(item, idx)
                if v is None:
                    continue
                if isinstance(v, str) and not v.strip():
                    continue
                return v
            return None
        return None

    return walk(obj, 0)


def _collect_by_dotted_path(obj: Any, path: Any) -> list[Any]:
    if obj is None:
        return []
    if not path or not isinstance(path, str):
        return []
    parts = [p for p in path.split(".") if p]
    if not parts:
        return []

    def walk(node: Any, idx: int) -> list[Any]:
        if idx >= len(parts):
            return [node]
        key = parts[idx]
        if isinstance(node, dict):
            if key not in node:
                return []
            return walk(node.get(key), idx + 1)
        if isinstance(node, list):
            out: list[Any] = []
            for item in node:
                out.extend(walk(item, idx))
            return out
        return []

    return walk(obj, 0)


def _extract_structured_entry(obj: Any) -> Optional[tuple[str, str, str]]:
    if isinstance(obj, list):
        if not obj:
            return None
        first = obj[0]
        if isinstance(first, str):
            vocab = first.strip()
            if not vocab:
                return None
            reading = _as_text(obj[1]) if len(obj) > 1 else ""
            translation = _as_text(obj[2]) if len(obj) > 2 else ""
            return vocab, reading, translation
        return None

    if not isinstance(obj, dict):
        return None

    vocab = ""
    reading = ""
    translation = ""

    for raw_key, raw_value in obj.items():
        key = _normalize_column_name(str(raw_key))
        if key in {"kanji", "vocab", "word", "expression", "term", "front", "japanese", "jp", "surface", "contents"}:
            if not vocab:
                vocab = _as_text(raw_value)
        elif key in {"kana", "reading", "yomi", "yomigana", "pronunciation", "furigana"}:
            if not reading:
                reading = _as_text(raw_value)
        elif key in {"english", "meaning", "translation", "definition", "gloss", "back", "en", "glossary"}:
            if not translation:
                translation = _as_text(raw_value)

    vocab = (vocab or "").strip()
    reading = (reading or "").strip()
    translation = (translation or "").strip()

    if not vocab:
        return None

    return vocab, reading, translation


def _walk_json(obj: Any, max_nodes: int = 250000) -> list[Any]:
    stack = [obj]
    out: list[Any] = []
    seen = 0
    while stack and seen < max_nodes:
        current = stack.pop()
        out.append(current)
        seen += 1
        if isinstance(current, dict):
            for v in current.values():
                stack.append(v)
        elif isinstance(current, list):
            for v in current:
                stack.append(v)
    return out


def build_token_table_from_json(json_path: str, max_records: int = 100000, mapping: Optional[Dict[str, Any]] = None) -> List[TokenEntry]:
    with open(json_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    temp_tokens: list[TokenEntry] = []
    record_count = 0

    if mapping and isinstance(mapping, dict):
        expr_path = mapping.get("expression")
        if isinstance(expr_path, str) and "." in expr_path:
            vocabs_raw = _collect_by_dotted_path(data, expr_path)
            vocab_list = [_as_text(v) for v in vocabs_raw]
            if any(vocab_list):
                reading_path = mapping.get("reading")
                glossary_path = mapping.get("glossary")
                sentence_path = mapping.get("sentence")
                translation_path = mapping.get("translation")
                expression_audio_path = mapping.get("expression_audio")
                sentence_audio_path = mapping.get("sentence_audio")

                readings = [_as_text(v) for v in _collect_by_dotted_path(data, reading_path)] if isinstance(reading_path, str) else []
                glossaries = [_as_text(v) for v in _collect_by_dotted_path(data, glossary_path)] if isinstance(glossary_path, str) else []
                sentences = [_as_text(v) for v in _collect_by_dotted_path(data, sentence_path)] if isinstance(sentence_path, str) else []
                translations = [_as_text(v) for v in _collect_by_dotted_path(data, translation_path)] if isinstance(translation_path, str) else []
                expression_audios = [_as_text(v) for v in _collect_by_dotted_path(data, expression_audio_path)] if isinstance(expression_audio_path, str) else []
                sentence_audios = [_as_text(v) for v in _collect_by_dotted_path(data, sentence_audio_path)] if isinstance(sentence_audio_path, str) else []

                for i, vocab in enumerate(vocab_list):
                    if not vocab:
                        continue
                    reading = readings[i] if i < len(readings) else ""
                    translation = glossaries[i] if i < len(glossaries) else ""
                    sentence_val = sentences[i] if i < len(sentences) else ""
                    sentence_translation_val = translations[i] if i < len(translations) else ""
                    expression_audio_val = expression_audios[i] if i < len(expression_audios) else ""
                    sentence_audio_val = sentence_audios[i] if i < len(sentence_audios) else ""

                    morphemes = tokenizer_obj.tokenize(vocab, SPLIT_MODE)
                    morphemes = [m for m in morphemes if m.part_of_speech()[0] not in {"補助記号", "空白"}]

                    if not morphemes:
                        pos = ""
                        derived_reading = reading
                        dictionary_form = vocab
                    else:
                        head = _pick_head_morpheme(morphemes) or morphemes[0]
                        pos = head.part_of_speech()[0]
                        dictionary_form = head.dictionary_form() or vocab
                        derived_reading = _derive_reading_katakana(dictionary_form, fallback=head.reading_form())

                    token = TokenEntry(
                        surface=vocab,
                        dictionary_form=dictionary_form,
                        reading=derived_reading or reading,
                        pos=pos,
                        kana=reading.strip() or _katakana_to_hiragana(derived_reading),
                        translation=translation,
                        sentence=sentence_val,
                        sentence_translation=sentence_translation_val,
                        expression_audio=expression_audio_val,
                        sentence_audio=sentence_audio_val,
                    )
                    temp_tokens.append(token)
                    record_count += 1
                    if record_count >= max_records:
                        break

                counts = Counter(t.dictionary_form for t in temp_tokens)
                unique_tokens: dict[str, TokenEntry] = {}
                for token in temp_tokens:
                    key = token.dictionary_form
                    if key not in unique_tokens:
                        token.occurrences = counts[key]
                        unique_tokens[key] = token

                return list(unique_tokens.values())

    for node in _walk_json(data):
        if isinstance(node, list) and node and all(isinstance(x, str) for x in node):
            for s in node:
                vocab = s.strip()
                if not vocab:
                    continue
                morphemes = tokenizer_obj.tokenize(vocab, SPLIT_MODE)
                morphemes = [m for m in morphemes if m.part_of_speech()[0] not in {"補助記号", "空白"}]

                if not morphemes:
                    pos = ""
                    derived_reading = ""
                    dictionary_form = vocab
                else:
                    head = _pick_head_morpheme(morphemes) or morphemes[0]
                    pos = head.part_of_speech()[0]
                    dictionary_form = head.dictionary_form() or vocab
                    derived_reading = _derive_reading_katakana(dictionary_form, fallback=head.reading_form())

                token = TokenEntry(
                    surface=vocab,
                    dictionary_form=dictionary_form,
                    reading=derived_reading,
                    pos=pos,
                    kana=_katakana_to_hiragana(derived_reading),
                    translation=""
                )
                temp_tokens.append(token)
                record_count += 1
                if record_count >= max_records:
                    break
            if record_count >= max_records:
                break

        extracted = None
        if mapping and isinstance(node, dict):
            vocab_key = mapping.get("expression")
            reading_key = mapping.get("reading")
            glossary_key = mapping.get("glossary")
            if vocab_key:
                vocab_raw = _get_by_dotted_path(node, vocab_key) if isinstance(vocab_key, str) and "." in vocab_key else node.get(vocab_key)
                reading_raw = _get_by_dotted_path(node, reading_key) if isinstance(reading_key, str) and "." in reading_key else node.get(reading_key)
                glossary_raw = _get_by_dotted_path(node, glossary_key) if isinstance(glossary_key, str) and "." in glossary_key else node.get(glossary_key)
                extracted = (_as_text(vocab_raw), _as_text(reading_raw), _as_text(glossary_raw))
        elif mapping and isinstance(node, list):
            vocab_i = mapping.get("expression")
            reading_i = mapping.get("reading")
            glossary_i = mapping.get("glossary")
            if isinstance(vocab_i, int) and 0 <= vocab_i < len(node):
                extracted = (_as_text(node[vocab_i]), _as_text(node[reading_i]) if isinstance(reading_i, int) and 0 <= reading_i < len(node) else "", _as_text(node[glossary_i]) if isinstance(glossary_i, int) and 0 <= glossary_i < len(node) else "")

        if extracted is None:
            extracted = _extract_structured_entry(node)
        if extracted is None:
            continue

        vocab, reading, translation = extracted
        if not vocab:
            continue

        morphemes = tokenizer_obj.tokenize(vocab, SPLIT_MODE)
        morphemes = [m for m in morphemes if m.part_of_speech()[0] not in {"補助記号", "空白"}]

        if not morphemes:
            pos = ""
            derived_reading = reading
            dictionary_form = vocab
        else:
            head = _pick_head_morpheme(morphemes) or morphemes[0]
            pos = head.part_of_speech()[0]
            dictionary_form = head.dictionary_form() or vocab
            derived_reading = _derive_reading_katakana(dictionary_form, fallback=head.reading_form())

        sentence_val = ""
        sentence_translation_val = ""
        expression_audio_val = ""
        sentence_audio_val = ""
        if mapping and isinstance(node, dict):
            sentence_key = mapping.get("sentence")
            sentence_translation_key = mapping.get("translation")
            expression_audio_key = mapping.get("expression_audio")
            sentence_audio_key = mapping.get("sentence_audio")

            sentence_val = _as_text(_get_by_dotted_path(node, sentence_key) if isinstance(sentence_key, str) and "." in sentence_key else node.get(sentence_key))
            sentence_translation_val = _as_text(_get_by_dotted_path(node, sentence_translation_key) if isinstance(sentence_translation_key, str) and "." in sentence_translation_key else node.get(sentence_translation_key))
            expression_audio_val = _as_text(_get_by_dotted_path(node, expression_audio_key) if isinstance(expression_audio_key, str) and "." in expression_audio_key else node.get(expression_audio_key))
            sentence_audio_val = _as_text(_get_by_dotted_path(node, sentence_audio_key) if isinstance(sentence_audio_key, str) and "." in sentence_audio_key else node.get(sentence_audio_key))

        token = TokenEntry(
            surface=vocab,
            dictionary_form=dictionary_form,
            reading=derived_reading or reading,
            pos=pos,
            kana=reading.strip() or _katakana_to_hiragana(derived_reading),
            translation=translation,
            sentence=sentence_val,
            sentence_translation=sentence_translation_val,
            expression_audio=expression_audio_val,
            sentence_audio=sentence_audio_val,
        )
        temp_tokens.append(token)
        record_count += 1
        if record_count >= max_records:
            break

    counts = Counter(t.dictionary_form for t in temp_tokens)
    unique_tokens: dict[str, TokenEntry] = {}
    for token in temp_tokens:
        key = token.dictionary_form
        if key not in unique_tokens:
            token.occurrences = counts[key]
            unique_tokens[key] = token

    return list(unique_tokens.values())



def filter_tokens(
    tokens: list[TokenEntry],
    hide_pos: set[str] | None = None,
    remove_katakana: bool = False,
    require_frequency: bool = False,
    tag_tokens: bool = True,
    exclude_tags: set[str] | None = None,
    require_tags: set[str] | None = None,
    too_common_occurrences: int = 10,
    too_common_lemmas: set[str] | None = None,
    min_occurrences: int = 1,
) -> list[TokenEntry]:

    if hide_pos is None:
        hide_pos = set()
    if exclude_tags is None:
        exclude_tags = set()

    if require_tags is None:
        require_tags = set()

    if too_common_lemmas is None:
        too_common_lemmas = _default_too_common_lemmas()


    filtered = []

    for token in tokens:
        if tag_tokens:
            token.tags = _compute_tags(
                token,
                too_common_occurrences=too_common_occurrences,
                too_common_lemmas=too_common_lemmas
            )

        # POS filtering
        if token.pos in hide_pos:
            continue

        # occurrence threshold
        if token.occurrences < min_occurrences:
            continue

        # skip tokens without frequency
        if require_frequency and token.frequency is None:
            continue

        # katakana detection
        if remove_katakana:
            if tag_tokens:
                is_kata = "SCRIPT_KATA" in token.tags
            else:
                is_kata = _script_tag(token.dictionary_form) == "SCRIPT_KATA"
            if is_kata:
                continue

        if exclude_tags and (token.tags & exclude_tags):
            continue

        if require_tags and not require_tags.issubset(token.tags):
            continue

        filtered.append(token)

    return filtered


# -----------------------------
# EXAMPLE
# -----------------------------

# if __name__ == "__main__":

#     text = """
#     私は日本語を勉強しています。
#     日本語は面白いです。
#     勉強は大切です。
#     """

#     # Example frequency data
#     frequency_index = {

#         "日本語": FrequencyEntry(
#             source="jlpt",
#             value=300
#         ),

#         "勉強": FrequencyEntry(
#             source="jlpt",
#             value=120
#         ),

#         "面白い": FrequencyEntry(
#             source="jlpt",
#             value=500
#         )
#     }

#     tokens = build_token_table(text)

#     enrich_with_frequency(tokens, frequency_index)

#     sorted_tokens = sort_by_frequency(tokens)

#     print_table(sorted_tokens)
