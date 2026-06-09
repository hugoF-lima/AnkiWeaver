

  # AnkiWeaver

Your intermediate layer for batch generating Sentences, Translations and filling missing audios for your Anki Decks. Using a real world database (tatoeba) created with tatoebatools, it supports enriched batch operations, context-enrichment bulk actions and TTS generation.

#Requirements:

DEEPL_API_KEY (for one click translations) 
ELEVEN_LABS_API_KEY (for Eleven Labs voice models)
AZURE_API_KEY (for Azure TTS voice models).
Tatoeba Database (an SQLite database created with tatoebatools).
You can download a pre-made one here:
<link_here>

Hook it up at Settings > Mapping > Database Path. 

This project currently supports only Japanese as a source language (With English and Portuguese translations). Contributors are welcome to add support for other languages.



# Unit Tests Report

If you came looking for the unit test reports, they are present on backend/unit_tests


  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.
  

  ```bash
    python -m uvicorn backend.main:app --reload --port 8000
  ```
