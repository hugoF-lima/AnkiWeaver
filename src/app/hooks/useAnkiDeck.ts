import { useCallback, useEffect, useState } from 'react'

export type Field = { label: string; value: string }
export type Card = {
  word: string
  fields: Field[]
  examples: { sentence: string; translation: string }[]
  noteId?: number
}

export function listAnkiDecks() {
  const [deckNames, setDeckNames] = useState<string[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDecks() {
      try {
        setLoadingDecks(true);
        const base = import.meta.env.DEV ? 'http://localhost:8000' : '';
        const url = `${base}/api/decks`;
        
        const res = await fetch(url);

        if (!res.ok) {
           throw new Error(`HTTP error! status: ${res.status}`);
        }

        const result = await res.json();

        if (!Array.isArray(result)) {
            throw new Error('API did not return an array of deck names');
        }

        setDeckNames(result);
        setError(null);
      } catch (err: any) {
        console.error("Failed to fetch Anki decks:", err);
        setError(String(err));
      } finally {
        setLoadingDecks(false);
      }
    }
    fetchDecks();
  }, []);

  return { deckNames, loadingDecks, error };
}


export function useAnkiDeck(deckName: string | undefined) {
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

 
  const fetchDeck = useCallback(async () => {
    if (!deckName) return;
    setLoading(true);
    setError(null);

    try {
      const base = import.meta.env.DEV ? 'http://localhost:8000' : '';
      const url = `${base}/api/notes?deck=${encodeURIComponent(deckName)}&limit=50`;
      console.log('fetchDeck -> request', { url });

      try {
        const res = await fetch(url);
        console.log('fetchDeck -> response', {
          deckName,
          status: res.status,
          url: res.url,
          contentType: res.headers.get('content-type'),
        });

        const text = await res.text();

        const notes = JSON.parse(text);
        console.log('fetchDeck -> parsed notes sample', notes?.slice?.(0, 3));
        const mapped = (notes || []).map((note: any) => {
          const fields: Field[] = Object.entries(note.fields ?? {}).map(([label, v]: any) => ({
            label,
            value: (v && (v.value ?? v)) || ''
          }));
          const expr = fields.find(f => /Expression|expression/i.test(f.label))?.value ?? fields[0]?.value ?? '';
          return { word: expr, fields, examples: [], noteId: note.noteId ?? note.id ?? undefined };
        });
        setCards(mapped);
      } catch (err) {
        console.error('fetchDeck -> JSON parse failed', { deckName, status: res.status, textSnippet: text.slice(0, 2000) });
        setError(`Invalid JSON response (${res.status})`);
      }
    } catch (err: any) {
      console.error('fetchDeck -> fetch failed', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [deckName]);


  useEffect(() => { fetchDeck() }, [fetchDeck])

  return { cards, loading, error, refresh: fetchDeck, setCards }
}