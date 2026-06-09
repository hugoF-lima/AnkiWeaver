from sudachipy import dictionary
from sudachipy import tokenizer

tokenizer_obj = dictionary.Dictionary().create()
mode = tokenizer.Tokenizer.SplitMode.C

def is_sentence(text: str) -> bool:
    text = text.strip()
    if not text:
        return False

    # Quick punctuation check
    if any(p in text for p in "。！？、"):
        return True

    morphemes = tokenizer_obj.tokenize(text, mode)

    # Single content word → probably vocab, not sentence
    if len(morphemes) <= 1:
        return False

    # Check for particles, auxiliaries, symbols
    for m in morphemes:
        pos = m.part_of_speech()
        if pos[0] in {"助詞", "助動詞", "記号"}:
            return True

    return False
