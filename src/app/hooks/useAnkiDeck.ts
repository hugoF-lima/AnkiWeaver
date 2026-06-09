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
  const [version, setVersion] = useState(0); // Trigger for re-fetching

  const refreshDecks = useCallback(() => {
    setVersion(v => v + 1);
  }, []);

  useEffect(() => {
    async function fetchDecks() {
      try {
        setLoadingDecks(true);
        const url = `/api/decks`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

        const result = await res.json();
        if (!Array.isArray(result)) throw new Error('API did not return an array of deck names');

        setDeckNames(result);
        setError(null);
      } catch (err: any) {
        setError(String(err));
      } finally {
        setLoadingDecks(false);
      }
    }
    fetchDecks();
  }, [version]); // Runs on mount and whenever version changes

  return { deckNames, loadingDecks, error, refreshDecks };
}

export function useAnkiDeck(deckName: string | undefined, currentPage: number = 0, sort: string = 'most_recent', filters: string[] = [], pageSize: number = 16) {
  const [cards, setCards] = useState<Card[]>([]);
  const [totalCards, setTotalCards] = useState(0); // New state for the count
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<'jp' | 'en'>('en');
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const fetchLanguage = useCallback(async () => {
    if (!deckName) return;
    try {
      const res = await fetch(`/api/decks/${encodeURIComponent(deckName)}/language`);
      if (res.ok) {
        const data = await res.json();
        setLanguage(data.language);
      }
    } catch (err) {
      console.error('Failed to fetch deck language:', err);
    }
  }, [deckName]);

  const fetchDeck = useCallback(async () => {
    if (!deckName) return;
    setLoading(true);
    setError(null);

    const offset = currentPage * pageSize;
    
    const filterQuery = filters.join(',');
    const url = `/api/notes?deck=${encodeURIComponent(deckName)}&limit=${pageSize}&offset=${offset}&sort=${sort}&filters=${filterQuery}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const data = await res.json(); // Now expects { notes: [], total: number, mapping: {} }

      setTotalCards(data.total || 0);
      const activeMapping = (data.mapping !== undefined ? (data.mapping || {}) : mapping);
      if (data.mapping !== undefined) setMapping(activeMapping);

      const mapped = (data.notes || []).map((note: any) => {
        const fields: Field[] = Object.entries(note.fields ?? {}).map(([label, v]: any) => ({
          label,
          value: (v && (v.value ?? v)) || ''
        }));
        
        // Use mapping for 'word' if available, otherwise fallback to common names
        const expressionField = activeMapping.expression;
        let expr = '';
        if (expressionField) {
          expr = fields.find(f => f.label === expressionField)?.value ?? '';
        } else {
          expr = fields.find(f => /Expression|Word|Kanji/i.test(f.label))?.value ?? fields[0]?.value ?? '';
        }

        return { 
          word: expr, 
          fields, 
          examples: [], 
          noteId: note.noteId ?? note.id 
        };
      });

      setCards(mapped);
    } catch (err: any) {
      console.error('fetchDeck failed:', err);
      setError(err.message || String(err));
      setCards([]);
      setTotalCards(0);
    } finally {
      setLoading(false);
    }
  }, [deckName, currentPage, sort, filters, pageSize]); // Re-fetch when page, deck, sort, filters, or pageSize change

  useEffect(() => { 
    fetchDeck();
  }, [fetchDeck]);

  useEffect(() => {
    fetchLanguage();
  }, [fetchLanguage]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchDeck(), fetchLanguage()]);
  }, [fetchDeck, fetchLanguage]);

  return { cards, totalCards, loading, error, language, mapping, refresh, setCards }
}

// export function useAnkiDeck(deckName: string | undefined) {
//   const [cards, setCards] = useState<Card[]>([]);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);

//   const fetchDeck = useCallback(async () => {
//     if (!deckName) return;
//     setLoading(true);
//     setError(null);

//     //const base = import.meta.env.DEV ? 'http://localhost:8000' : '';
//     //const url = `${base}/api/notes?deck=${encodeURIComponent(deckName)}&limit=50`;

//     //this limiting here, and at the backend get_notes, can hide words in larger decks, need to fix it.
//     const url = `/api/notes?deck=${encodeURIComponent(deckName)}&limit=100`;
    
//     try {
//       const res = await fetch(url);
      
//       // Check if the HTTP request actually succeeded (e.g., not a 404 or 500)
//       if (!res.ok) {
//         throw new Error(`Server responded with status ${res.status}`);
//       }

//       const notes = await res.json(); // Use .json() directly instead of .text() + JSON.parse()

//       const mapped = (notes || []).map((note: any) => {
//         const fields: Field[] = Object.entries(note.fields ?? {}).map(([label, v]: any) => ({
//           label,
//           value: (v && (v.value ?? v)) || ''
//         }));
        
//         const expr = fields.find(f => /Expression/i.test(f.label))?.value ?? fields[0]?.value ?? '';
//         return { 
//           word: expr, 
//           fields, 
//           examples: [], 
//           noteId: note.noteId ?? note.id 
//         };
//       });

//       setCards(mapped);
//     } catch (err: any) {
//       console.error('fetchDeck failed:', err);
//       // This will now catch BOTH network errors (CORS) and parsing errors
//       setError(err.message || String(err));
//     } finally {
//       setLoading(false);
//     }
//   }, [deckName]);


//   useEffect(() => { fetchDeck() }, [fetchDeck])

//   return { cards, loading, error, refresh: fetchDeck, setCards }
// }
