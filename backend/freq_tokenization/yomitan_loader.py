import json
import re
import zipfile

from dataclasses import dataclass
from typing import Dict


@dataclass
class FrequencyEntry:
    source: str
    value: int


def load_yomitan_frequency(
    zip_path: str,
    source_name: str,
    jlpt_mode: bool = False
) -> Dict[str, FrequencyEntry]:

    frequency_index = {}

    jlpt_map = {
        "N5": 1,
        "N4": 2,
        "N3": 3,
        "N2": 4,
        "N1": 5
    }

    with zipfile.ZipFile(zip_path, "r") as archive:

        meta_files = [

            f for f in archive.namelist()

            if re.match(r"term_meta_bank_\d+\.json", f)
        ]

        for file_name in meta_files:

            with archive.open(file_name) as f:

                bank_data = json.load(f)

                for entry in bank_data:

                    if len(entry) < 3:
                        continue

                    if entry[1] != "freq":
                        continue

                    word = entry[0]
                    raw_value = entry[2]

                    # Some frequency dictionaries use:
                    # {"reading": "...", "frequency": ...}
                    # or {"value": ...}

                    if isinstance(raw_value, dict):

                        raw_value = raw_value.get(
                            "value",
                            raw_value.get("frequency")
                        )

                    # JLPT handling
                    if jlpt_mode:

                        raw_value = str(raw_value).upper()

                        if raw_value not in jlpt_map:
                            continue

                        value = jlpt_map[raw_value]

                    elif isinstance(raw_value, (int, float)):

                        value = int(raw_value)

                    else:
                        continue

                    current = frequency_index.get(word)

                    # Keep lowest rank
                    if current is None or value < current.value:

                        frequency_index[word] = FrequencyEntry(
                            source=source_name,
                            value=value
                        )

    return frequency_index