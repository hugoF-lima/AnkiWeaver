import sys
import types


def install():
    if "python_multipart" not in sys.modules:
        python_multipart = types.ModuleType("python_multipart")
        python_multipart.__version__ = "0.0.13"
        sys.modules["python_multipart"] = python_multipart

    if "multipart" not in sys.modules:
        multipart = types.ModuleType("multipart")
        multipart_multipart = types.ModuleType("multipart.multipart")

        def parse_options_header(value):
            return value, {}

        multipart_multipart.parse_options_header = parse_options_header
        multipart.__version__ = "0.0.0"
        multipart.multipart = multipart_multipart
        sys.modules["multipart"] = multipart
        sys.modules["multipart.multipart"] = multipart_multipart

    if "tqdm" not in sys.modules:
        tqdm_mod = types.ModuleType("tqdm")

        def tqdm(iterable=None, *args, **kwargs):
            return iterable if iterable is not None else []

        tqdm_mod.tqdm = tqdm
        sys.modules["tqdm"] = tqdm_mod

    if "dotenv" not in sys.modules:
        dotenv = types.ModuleType("dotenv")

        def load_dotenv(dotenv_path=None, *args, **kwargs):
            return False

        dotenv.load_dotenv = load_dotenv
        sys.modules["dotenv"] = dotenv

    if "deepl" not in sys.modules:
        deepl = types.ModuleType("deepl")

        class DeepLException(Exception):
            pass

        class Translator:
            def __init__(self, auth_key):
                self.auth_key = auth_key

            def translate_text(self, text, target_lang=None):
                if isinstance(text, list):
                    return [types.SimpleNamespace(text=str(t)) for t in text]
                return types.SimpleNamespace(text=str(text))

        deepl.DeepLException = DeepLException
        deepl.Translator = Translator
        sys.modules["deepl"] = deepl

    if "sudachipy" not in sys.modules:
        sudachipy = types.ModuleType("sudachipy")
        sudachipy_dictionary = types.ModuleType("sudachipy.dictionary")
        sudachipy_tokenizer = types.ModuleType("sudachipy.tokenizer")

        class _SplitMode:
            A = object()
            B = object()
            C = object()

        class Tokenizer:
            SplitMode = _SplitMode

        class FakeMorpheme:
            def __init__(self, surface, dictionary_form=None, reading_form=None, pos0="名詞"):
                self._surface = surface
                self._dictionary_form = dictionary_form if dictionary_form is not None else surface
                self._reading_form = reading_form if reading_form is not None else surface
                self._pos0 = pos0

            def surface(self):
                return self._surface

            def dictionary_form(self):
                return self._dictionary_form

            def reading_form(self):
                return self._reading_form

            def part_of_speech(self):
                return [self._pos0]

        class FakeTokenizerObj:
            def tokenize(self, text, mode):
                t = str(text or "")
                out = []
                count = t.count("催された")
                for _ in range(max(1, count) if "催された" in t else 1):
                    if "催された" in t:
                        out.extend(
                            [
                                FakeMorpheme("催された", dictionary_form="催す", reading_form="モヨス", pos0="動詞"),
                                FakeMorpheme("れ", dictionary_form="れる", reading_form="レル", pos0="助動詞"),
                                FakeMorpheme("た", dictionary_form="た", reading_form="タ", pos0="助動詞"),
                            ]
                        )
                    else:
                        if not t.strip():
                            return []
                        out.append(FakeMorpheme(t.strip(), dictionary_form=t.strip(), reading_form=t.strip(), pos0="名詞"))
                return out

        class Dictionary:
            def create(self):
                return FakeTokenizerObj()

        sudachipy_dictionary.Dictionary = Dictionary
        sudachipy_tokenizer.Tokenizer = Tokenizer

        sudachipy.dictionary = sudachipy_dictionary
        sudachipy.tokenizer = sudachipy_tokenizer
        sys.modules["sudachipy"] = sudachipy
        sys.modules["sudachipy.dictionary"] = sudachipy_dictionary
        sys.modules["sudachipy.tokenizer"] = sudachipy_tokenizer
