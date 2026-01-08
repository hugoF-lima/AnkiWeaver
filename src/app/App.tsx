import { useEffect, useRef, useState } from 'react';
import { WordGrid } from './components/WordGrid';
import { CardContext } from './components/CardContext';
import { ExampleSentences } from './components/ExampleSentences';
import { Header } from './components/Header';
import type { Card } from './hooks/useAnkiDeck';
import { useAnkiDeck } from './hooks/useAnkiDeck';
import { fetchSentencesFor } from './hooks/useSentences';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';


export default function App() {
  // 1. Initialize state for the selected deck nam 
  // We use the VITE_ANKI_DECK environment variable as the initial default value if present.
  const initialDeckName = (import.meta.env.VITE_ANKI_DECK as string) ?? 'JLPT N3 Usage';
  const [selectedDeckName, setSelectedDeckName] = useState<string | undefined>(initialDeckName);

  // 2. Use the state variable in useAnkiDeck hook call
  const { cards, loading, error, refresh, setCards } = useAnkiDeck(selectedDeckName);

  const [currentPage, setCurrentPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeBox, setActiveBox] = useState<'card' | 'examples' | null>(null);
  const CardContextScrollRef = useRef<HTMLDivElement>(null);
  const examplesScrollRef = useRef<HTMLDivElement>(null);

  const cardsPerPage = 16;
  // Ensure totalPages recalculates correctly when `cards` changes (e.g. when a new deck is selected)
  const totalPages = Math.max(1, Math.ceil(cards.length / cardsPerPage));

  const prevDeckRef = useRef<string | undefined>(undefined);
  
  useEffect(() => {
    const start = currentPage * cardsPerPage;
    const pageCount = Math.max(0, Math.min(cardsPerPage, cards.length - start));
  
    // If the deck changed, reset page/index
    if (prevDeckRef.current !== selectedDeckName) {
      setCurrentPage(0);
      setSelectedIndex(0);
    } else {
      // Otherwise only fix out-of-range index
      if (selectedIndex >= pageCount) setSelectedIndex(0);
    }
  
    prevDeckRef.current = selectedDeckName;
  }, [cards, selectedDeckName]);
  
  // Ensure selection stays valid when cards or page change (only clamp out-of-range)
  useEffect(() => {
    const start = currentPage * cardsPerPage;
    const pageCount = Math.max(0, Math.min(cardsPerPage, cards.length - start));
    // If the selected index is out of range, clamp it to 0 (keep page intact)
    if (selectedIndex > 0 && selectedIndex >= pageCount) {
      setSelectedIndex(0);
    }
  }, [cards, currentPage, selectedIndex]);

  const getCurrentPageCards = () => {
    const start = currentPage * cardsPerPage;
    return cards.slice(start, start + cardsPerPage);
  };

  const currentCards = getCurrentPageCards();
  const currentCard = currentCards[selectedIndex] ?? null;

  // fetch example sentences for the selected card when it lacks examples
  useEffect(() => {
    let canceled = false;
    async function fetchIfNeeded(card: Card | null) {
      if (!card || (card.examples && card.examples.length > 0)) return;
      try {
        const sents = await fetchSentencesFor(card.word, 5);
        if (canceled) return;
        const examples = sents.map(s => ({ sentence: s.jp, translation: s.en, audioId: s.audio_id, hasAudio: s.has_audio,}));
        // update the global cards with these examples
        setCards(prev => {
          const copy = prev.map(c => {
            if ((c.noteId ?? c.word) === (card.noteId ?? card.word)) {
              return { ...c, examples };
            }
            return c;
          });
          return copy;
        });
        // Debug: log that we just added examples for this card
        console.log('App: added examples for', card.word);
      } catch (err) {
        console.error('Failed to fetch sentences for', card?.word, err);
      }
    }
    fetchIfNeeded(currentCard);
    return () => { canceled = true; }
  }, [currentCard, setCards]);

  // Pagination Handlers
  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
      setSelectedIndex(0);
    }
  };

  const handlePrevious = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
      setSelectedIndex(0);
    }
  };

  // Card Update Handler
  const handleUpdateCard = async (
    jp: string,
    en: string,
    sentence_audio?: string,
    explicitNoteId?: number
  ) => {
    const noteId = explicitNoteId ?? currentCard?.noteId;
    console.log('App: handleUpdateCard called', { noteId, explicitNoteId, jp, en, sentence_audio });
    if (!noteId) {
      toast.error('Cannot update: no selected Anki note.');
      return;
    }
    const payload = { jp, en, sentence_audio: sentence_audio ? String(sentence_audio) : undefined };
    try {
      const res = await fetch(`/api/notes/${noteId}/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const text = await res.text(); throw new Error(text); }
      toast.success('Card updated ✅');
      await refresh();
    } catch (err:any) { console.error('Failed to update note', err);
      toast.error('Failed to update note: ' + (err?.message ?? 'Unknown error')); }
  };

  // Update a specific field on a note in local state (used by CardContext for translation updates)
  const handleUpdateField = (noteId: number, label: string, value: string) => {
    setCards(prev => prev.map(c => {
      if (c.noteId === noteId) {
        const newFields = c.fields.map(f => f.label === label ? { ...f, value } : f);
        return { ...c, fields: newFields };
      }
      return c;
    }));
  };


  const handleCardContextHeaderHover = (e: React.WheelEvent<HTMLDivElement>) => {
    if (CardContextScrollRef.current) { e.preventDefault(); CardContextScrollRef.current.scrollTop += e.deltaY; }
  };

  const handleExamplesHeaderHover = (e: React.WheelEvent<HTMLDivElement>) => {
    if (examplesScrollRef.current) { e.preventDefault(); examplesScrollRef.current.scrollTop += e.deltaY; }
  };
  
  useEffect(() => {
  console.log('App runtime:', {
      deckName: selectedDeckName, // Now logs the state value
      cardsLen: cards?.length,
      loading,
      error,
      currentPage,
      selectedIndex,
    });
  }, [cards, loading, error, currentPage, selectedIndex, selectedDeckName]); // Added selectedDeckName dependency

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <Header />
      <Toaster />
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Word Grid */}
        <aside className="flex-none w-96 h-full">
          <WordGrid
            // Pass the current state and a setter function for the combobox logic
            deckName={selectedDeckName}
            onDeckChange={setSelectedDeckName} 
            
            // App.tsx still drives the pagination logic using these props:
            words={currentCards.map(c => c.word)}
            selectedIndex={selectedIndex}
            onSelectWord={(index) => {
              console.log('App: onSelectWord ->', { index, currentPage, selectedIndex });
              setSelectedIndex(index);
            }}
            onNext={handleNext}
            onPrevious={handlePrevious}
            hasNext={currentPage < totalPages - 1}
            hasPrevious={currentPage > 0}
          />
        </aside>

        {/* Right Panel - Card Details */}
        <main className="flex-1 min-w-0 flex flex-col h-full">
          <div className="flex-1 min-h-0 p-4 flex flex-col gap-4">
        
            {/* CardContext wrapper — rounded + overflow-hidden, inner scroll area */}
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm flex-1 overflow-hidden">
              <div className="h-full overflow-auto">
                <CardContext 
                  fields={currentCard?.fields ?? []}
                  noteId={currentCard?.noteId}
                  ref={CardContextScrollRef}
                  isActive={activeBox === 'card'}
                  onActivate={() => setActiveBox('card')}
                  onUpdateCard={(jp, en, sentence_audio, noteId) => handleUpdateCard(jp, en, sentence_audio, noteId)}
                  onUpdateField={(noteId, label, value) => handleUpdateField(noteId, label, value)}
                />
              </div>
            </div>
        
            {/* ExampleSentences wrapper — fixed height, rounded + scroll inside */}
            <div className="h-64">
              <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden h-full">
                <div className="h-full overflow-auto">
                  <ExampleSentences 
                    examples={currentCard?.examples}
                    word={currentCard?.word}
                    noteId={currentCard?.noteId}
                    onUpdateCard={(jp, en, sentence_audio, noteId) => handleUpdateCard(jp, en, sentence_audio, noteId)}
                    ref={examplesScrollRef}
                    isActive={activeBox === 'examples'}
                    onActivate={() => setActiveBox('examples')}
                  />
                </div>
              </div>
            </div>
        
          </div>
        </main>
      </div>
    </div>
  );
}