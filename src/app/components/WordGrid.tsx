import { ChevronLeft, ChevronRight, Inbox, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { listAnkiDecks, useAnkiDeck, Card } from '../hooks/useAnkiDeck';

interface WordGridProps {
  words?: string[];
  selectedIndex?: number;
  onSelectWord?: (index: number) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  deckName?: string;
  onCardChange?: (card: Card | null) => void;
  // New callback for when a user selects a different deck
  onDeckChange?: (newDeckName: string) => void; 
}

export function WordGrid({
  words,
  selectedIndex = 0,
  onSelectWord,
  onPrevious,
  onNext,
  hasNext,
  hasPrevious,
  deckName,
  onCardChange,
  onDeckChange, // Destructure the new prop
}: WordGridProps) {
  // Fetch decks using the new hook
  const { deckNames, loadingDecks, error: deckError } = listAnkiDecks();
  
  // useAnkiDeck hook still fetches cards for the current `deckName` prop
  const { cards, loading, refresh, error: cardsError, setCards } = deckName ? useAnkiDeck(deckName) : { cards: [] as Card[], loading: false, refresh: () => {}, setCards: (_: any) => {} }
  
  const controlled = words !== undefined;
  const internalMode = !!deckName && !controlled;

  // ... (rest of the internal state management and useEffects remain the same) ...
  const cardsPerPage = 16
  const [internalPage, setInternalPage] = useState(0)
  const [internalIndex, setInternalIndex] = useState(0)

  const showEmptyState = internalMode && !loading && cards.length === 0;

  // const [prevDeck, setPrevDeck] = useState(deckName);

  // if (deckName !== prevDeck) {
  //   setInternalPage(0);
  //   setInternalIndex(0);
  //   setPrevDeck(deckName);
  // }
  //This is responsible for changing...

  // useEffect(() => {
  //   setInternalPage(0);
  //   setInternalIndex(0);
  // }, [deckName]);

  useEffect(() => {
    if (internalMode && cards.length > 0) {
      const globalIndex = (internalPage * cardsPerPage) + internalIndex;
      const current = cards[globalIndex]
      // Safety check: ensure the index exists in the NEW cards array
      if (cards[globalIndex]) {
        onCardChange?.(current);
        onSelectWord?.(internalIndex);
      }
    }
  }, [internalMode, cards, internalPage, internalIndex, onCardChange, onSelectWord]);

  const handleSelect = (index: number) => {
    if (internalMode) {
      setInternalIndex(index)
    } else {
      onSelectWord?.(index)
    }
  }
  const displayWords = internalMode
    ? cards.slice(internalPage * cardsPerPage, (internalPage + 1) * cardsPerPage).map(c => c.word)
    : words ?? []

  const totalPages = internalMode ? Math.ceil(cards.length / cardsPerPage) : Math.ceil((words || []).length / cardsPerPage)
  const page = internalMode ? internalPage : Math.floor(selectedIndex / cardsPerPage)


  const handlePrev = () => {
    if (internalMode) {
      setInternalPage(p => Math.max(0, p - 1))
      setInternalIndex(0)
    } else {
      onPrevious?.()
    }
  }
  const handleNext = () => {
    if (internalMode) {
      setInternalPage(p => Math.min(totalPages - 1, p + 1))
      setInternalIndex(0)
    } else {
      onNext?.()
    }
  }

  const selected = internalMode ? internalIndex : selectedIndex

  useEffect(() => {
    if (!internalMode) {
      setInternalIndex(selectedIndex);
    }
  }, [selectedIndex, internalMode]);

  // Handle deck selection change event from the UI
  const handleDeckChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newDeckName = event.target.value;
    if (newDeckName && onDeckChange) {
      onDeckChange(newDeckName);
      // Reset internal state when changing decks
      setInternalPage(0);
      setInternalIndex(0);
    }
  };

  // UI rendering starts here with the dark theme applied previously
  return (
    <div className="flex flex-col h-full p-6 bg-gradient-to-br from-slate-50 to-slate-100 border-r border-slate-200">
      <div className="mb-6">
        <h1 className="text-slate-900 mb-1">Anki Flashcards</h1>
        
        {/* Combobox Implementation */}
        <div className="flex items-center gap-3 mb-2">
          <label htmlFor="deck-select" className="text-sm text-slate-400">
            Select deck:
          </label>
          <select
            id="deck-select"
            value={deckName || ''}
            onChange={handleDeckChange}
            disabled={loadingDecks}
            className="flex-1 p-2 border border-slate-600 rounded-lg bg-slate-800 text-white focus:black-500 focus:border-black-500 cursor-pointer"
          >
            {loadingDecks ? (
              <option value="">Loading decks...</option>
            ) : deckError ? (
              <option value="">
                {String(deckError).includes('404') ? 'No Decks found' : 'Error fetching decks'}
              </option>
            ) : (
              <>
                <option value="">-- Select a deck --</option>
                {deckNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        <p className="text-slate-500 text-sm mb-3">
          {internalMode && !loading ? (
             `Deck: "${deckName}" (${cards.length} cards)`
          ) : deckError || cardsError ? (
            `Error: ${deckError || cardsError}`
          ) : (
            'Select a deck above to load cards.'
          )}
        </p>

        <div className="relative">
          <input
            type="text"
            placeholder="Search words…"
            className="
              w-full px-3 py-2.5 pr-9 text-sm
              rounded-lg
              bg-slate-50 border border-slate-300
              text-slate-700 placeholder:text-slate-400
              focus:outline-none focus:ring-2 focus:ring-blue-500
            "
          />
          <Search
            className="
              absolute right-3 top-1/2 -translate-y-1/2
              size-4 text-slate-400
              pointer-events-none
            "
          />
        </div>
      </div>

      <div className="flex-1 flex-col items-center justify-center">
        {loading ? (
            <p className="text-slate-400">Loading cards...</p>
        ) : showEmptyState ? (
            <div className="text-center p-8 border-2 border-dashed border-slate-300 rounded-2xl max-w-sm">
                <Inbox className="size-12 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600 font-medium mb-2">Nothing to display here.</p>
                <p className="text-slate-400 text-sm">Make sure Anki is launched and Anki Connect is present.</p>
            </div>
        ) : (
            <div className="grid grid-cols-4 gap-3 w-full max-w-md">
              {displayWords.map((word, index) => {
                // Calculate the actual position in the full cards array
                const globalIndex = internalPage * cardsPerPage + index;
                
                // Stable key logic: Use noteId if available, then word, then index as fallback
                const key = internalMode
                  ? (cards[globalIndex]?.noteId ?? `card-${word}-${globalIndex}`)
                  : `word-${index}`;

                return (
                  <button
                    key={key}
                    onClick={() => handleSelect(index)}
                    className={`
                      min-h-[3rem] flex items-center justify-center rounded-xl
                      transition-all duration-200 border
                      ${
                        // We compare internalIndex with the local map index 
                        // since handleSelect(index) sets setInternalIndex(index)
                        selected === index
                          ? 'bg-blue-500 border-blue-400 text-white shadow-lg scale-105'
                          : 'bg-white border-slate-300 text-slate-800 hover:border-blue-300 hover:shadow-md hover:scale-102'
                      }
                    `}
                  >
                    <span className="text-center px-1 text-sm font-medium">{word}</span>
                  </button>
                );
              })}
            </div>
        )}
      </div>

      <div className="flex gap-2 mt-6">
        <button
          onClick={handlePrev}
          disabled={!(internalMode ? internalPage > 0 : hasPrevious)}
          className={`
            flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg
            transition-all duration-200 font-medium
            ${
              (internalMode ? internalPage > 0 : hasPrevious)
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }
          `}
        >
          <ChevronLeft className="size-5" />
          Previous
        </button>
        <button
          onClick={handleNext}
          disabled={!(internalMode ? internalPage < totalPages - 1 : hasNext)}
          className={`
            flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg
            transition-all duration-200 font-medium
            ${
              (internalMode ? internalPage < totalPages - 1 : hasNext)
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }
          `}
        >
          Next
          <ChevronRight className="size-5" />
        </button>
      </div>
    </div>
  );
}
