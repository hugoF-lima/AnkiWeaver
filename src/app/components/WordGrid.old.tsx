import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnkiDeck, Card } from '../hooks/useAnkiDeck';
import { listAnkiDecks} from '../hooks/useAnkiDeck';

interface WordGridProps {
  // if `words` is provided, component behaves as before (mock / external data)
  words?: string[];
  selectedIndex?: number;
  onSelectWord?: (index: number) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;

  // new: optional Anki deck name to fetch real data
  deckName?: string;

  // callback that emits the full selected card (fields, examples, noteId)
  onCardChange?: (card: Card | null) => void;
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
  onDeckChange,
}: WordGridProps) {

  // Fetch decks using the new hook
  //const { deckNames, loadingDecks, error: deckError } = listAnkiDecks();
  // If deckName provided, fetch deck and manage selection/pagination internally
  const { cards, loading, refresh, setCards } = deckName ? useAnkiDeck(deckName) : { cards: [] as Card[], loading: false, refresh: () => {}, setCards: (_: any) => {} }
  const internalMode = !!deckName

  const cardsPerPage = 16

  const [internalPage, setInternalPage] = useState(0)
  const [internalIndex, setInternalIndex] = useState(0)

  useEffect(() => {
    // notify parent when selection changes in internal mode
    if (internalMode) {
      const current = cards[internalPage * cardsPerPage + internalIndex] ?? null
      onCardChange?.(current)
      onSelectWord?.(internalIndex)
    }
  }, [internalMode, cards, internalPage, internalIndex, onCardChange, onSelectWord])

  // derived UI data
  const displayWords = internalMode
    ? cards.slice(internalPage * cardsPerPage, (internalPage + 1) * cardsPerPage).map(c => c.word)
    : words ?? []

  const totalPages = internalMode ? Math.ceil(cards.length / cardsPerPage) : Math.ceil((words || []).length / cardsPerPage)
  const page = internalMode ? internalPage : Math.floor(selectedIndex / cardsPerPage)

  const handleSelect = (index: number) => {
    if (internalMode) {
      setInternalIndex(index)
    } else {
      onSelectWord?.(index)
    }
  }

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

  return (
    <div className="flex flex-col h-full p-6 bg-gradient-to-br from-slate-50 to-slate-100 border-r border-slate-200">
      <div className="mb-6">
        <h1 className="text-slate-900 mb-1">Anki Flashcards</h1>
        <div className="text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1 font-large">Select your deck: --Combobox here--</div>
        <p className="text-slate-600">{internalMode ? (loading ? 'Loading deck...' : `Deck: ${deckName}`) : 'Select a word to view details'}</p>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="grid grid-cols-4 gap-3 w-full max-w-md">
          {displayWords.map((word, index) => (
            <button
              key={index}
              onClick={() => handleSelect(index)}
              className={`
                aspect-square flex items-center justify-center rounded-xl
                transition-all duration-200 border
                ${
                  selected === index
                    ? 'bg-blue-500 border-blue-400 text-white shadow-lg scale-105'
                    : 'bg-white border-slate-300 text-slate-800 hover:border-blue-300 hover:shadow-md hover:scale-102'
                }
              `}
            >
              <span className="text-center px-1">{word}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-6">
        <button
          onClick={handlePrev}
          disabled={!(internalMode ? internalPage > 0 : hasPrevious)}
          className={`
            flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg
            transition-all duration-200
            ${
              (internalMode ? internalPage > 0 : hasPrevious)
                ? 'bg-slate-800 text-white hover:bg-slate-700 shadow-md'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
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
            transition-all duration-200
            ${
              (internalMode ? internalPage < totalPages - 1 : hasNext)
                ? 'bg-slate-800 text-white hover:bg-slate-700 shadow-md'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
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