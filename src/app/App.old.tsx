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
  const deckName = (import.meta.env.VITE_ANKI_DECK as string) ?? 'JLPT N3 Usage'; // change to your deck name via .env
  const { cards, loading, error, refresh, setCards } = useAnkiDeck(deckName);

  const [currentPage, setCurrentPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeBox, setActiveBox] = useState<'card' | 'examples' | null>(null);
  const CardContextScrollRef = useRef<HTMLDivElement>(null);
  const examplesScrollRef = useRef<HTMLDivElement>(null); //hope this doesn't get in the way???

  const cardsPerPage = 16;
  const totalPages = Math.max(1, Math.ceil(cards.length / cardsPerPage));

  
  // Ensure selection stays valid when cards or page change
  useEffect(() => {
    const start = currentPage * cardsPerPage;
    const pageCount = Math.max(0, Math.min(cardsPerPage, cards.length - start));
    if (selectedIndex >= pageCount) setSelectedIndex(0);
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
      } catch (err) {
        console.error('Failed to fetch sentences for', card?.word, err);
      }
    }
    fetchIfNeeded(currentCard);
    return () => { canceled = true; }
  }, [currentCard, setCards]);

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

  const handleUpdateCard = async (
    jp: string,
    en: string,
    sentence_audio?: string
  ) => {
    const noteId = currentCard?.noteId;

    console.log('handleUpdateCard called', {
      noteId,
      jp,
      en,
      sentence_audio
    });

    if (!noteId) {
      toast.error('Cannot update: no selected Anki note.');
      return;
    }

    const payload = {
      jp,
      en,
      sentence_audio: sentence_audio
        ? String(sentence_audio)
        : undefined,
    };

    try {
      const res = await fetch(`/api/notes/${noteId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }

      toast.success('Card updated ✅');

      await refresh();
    } catch (err) {
      console.error('Failed to update note', err);
    }
  };


  const handleCardContextHeaderHover = (e: React.WheelEvent<HTMLDivElement>) => {
    if (CardContextScrollRef.current) {
      e.preventDefault();
      CardContextScrollRef.current.scrollTop += e.deltaY;
    }
  };

  const handleExamplesHeaderHover = (e: React.WheelEvent<HTMLDivElement>) => {
    if (examplesScrollRef.current) {
      e.preventDefault();
      examplesScrollRef.current.scrollTop += e.deltaY;
    }
  };
  //wil this debug anything?
  useEffect(() => {
  console.log('App runtime:', {
      deckName: import.meta.env.VITE_ANKI_DECK,
      cardsLen: cards?.length,
      loading,
      error,
      currentPage,
      selectedIndex,
    });
  }, [cards, loading, error, currentPage, selectedIndex]);

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <Header />
      <Toaster />
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Word Grid */}
        <aside className="flex-none w-96 h-full">
          <WordGrid
            words={currentCards.map(c => c.word)}
            selectedIndex={selectedIndex}
            onSelectWord={setSelectedIndex}
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
                    onUpdateCard={(jp, en, sentence_audio) => handleUpdateCard(jp, en, sentence_audio)}
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

