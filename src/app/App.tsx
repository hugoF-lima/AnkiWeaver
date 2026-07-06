import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVerticalIcon } from 'lucide-react';
import { WordGrid } from './components/WordGrid';
import { CardContext } from './components/CardContext';
import { ExampleSentences } from './components/ExampleSentences';
import { Header } from './components/Header';
import type { Card } from './hooks/useAnkiDeck';
import { useAnkiDeck } from './hooks/useAnkiDeck';
import { fetchSentencesFor } from './hooks/useSentences';
import { toast } from 'sonner';
import { Toaster } from './components/ui/sonner';
import { useIsMobile } from './components/ui/use-mobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from './components/ui/drawer';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { ImperativePanelGroupHandle } from 'react-resizable-panels';
import { useTranslation } from "react-i18next";

export default function App() {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [settingsEpoch, setSettingsEpoch] = useState(0);
  const examplesFetchAttemptedRef = useRef<Set<string | number>>(new Set());

  const mainPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);

  const CARD_CONTEXT_MIN_VH = 20;
  const CARD_CONTEXT_MAX_VH = 80;
  const [cardContextVh, setCardContextVh] = useState(() => {
    const raw = window.localStorage.getItem('anki_card_context_vh');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 42;
    return Math.min(CARD_CONTEXT_MAX_VH, Math.max(CARD_CONTEXT_MIN_VH, parsed));
  });
  const [resizingCardContext, setResizingCardContext] = useState(false);
  const resizeStartYRef = useRef(0);
  const resizeStartVhRef = useRef(42);
  const pendingResizeClientYRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizePointerIdRef = useRef<number | null>(null);
  const resizePointerTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    window.localStorage.setItem('anki_card_context_vh', String(cardContextVh));
  }, [cardContextVh]);

  useEffect(() => {
    if (!resizingCardContext) return;

    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const applyResize = () => {
      resizeRafRef.current = null;

      const clientY = pendingResizeClientYRef.current;
      pendingResizeClientYRef.current = null;
      if (clientY == null) return;

      const deltaPx = clientY - resizeStartYRef.current;
      const deltaVh = (deltaPx / window.innerHeight) * 100;
      const next = resizeStartVhRef.current + deltaVh;

      setCardContextVh(
        Math.min(CARD_CONTEXT_MAX_VH, Math.max(CARD_CONTEXT_MIN_VH, next)),
      );
    };

    const queueResize = (clientY: number) => {
      pendingResizeClientYRef.current = clientY;
      if (resizeRafRef.current != null) return;
      resizeRafRef.current = window.requestAnimationFrame(applyResize);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') e.preventDefault();
      queueResize(e.clientY);
    };

    const onMouseMove = (e: MouseEvent) => {
      queueResize(e.clientY);
    };

    const stop = () => setResizingCardContext(false);

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);

      const target = resizePointerTargetRef.current;
      const pointerId = resizePointerIdRef.current;
      if (target && pointerId != null) {
        try {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {
          // ignore
        }
      }
      resizePointerTargetRef.current = null;
      resizePointerIdRef.current = null;

      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }

      pendingResizeClientYRef.current = null;
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [resizingCardContext]);

  const startCardContextResize = (clientY: number) => {
    resizeStartYRef.current = clientY;
    resizeStartVhRef.current = cardContextVh;
    pendingResizeClientYRef.current = clientY;
    setResizingCardContext(true);
  };

  const resetMainLayout = () => {
    mainPanelGroupRef.current?.setLayout([28, 72]);
  };

  const LAST_SELECTED_DECK_STORAGE_KEY = "ankiweaver_last_selected_deck";
  const getInitialDeckName = (): string | undefined => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(LAST_SELECTED_DECK_STORAGE_KEY);
      if (stored && stored.trim()) return stored.trim();
    }
    const envDeck = ((import.meta as any).env?.VITE_ANKI_DECK as string) ?? "";
    if (envDeck && String(envDeck).trim()) return String(envDeck).trim();
    return undefined;
  };

  const [selectedDeckName, setSelectedDeckName] = useState<string | undefined>(() => getInitialDeckName());

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedDeckName || !selectedDeckName.trim()) return;
    window.localStorage.setItem(LAST_SELECTED_DECK_STORAGE_KEY, selectedDeckName.trim());
  }, [selectedDeckName]);

  const [sort, setSort] = useState<string>('most_recent');
  const [filters, setFilters] = useState<string[]>([]);
  const [cardsPerPage, setCardsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(0);

  const handleFiltersChange = useCallback((next: string[]) => {
    setFilters(next);
    setCurrentPage(0);
    setSelectedIndex(0);
    setSelectedNoteId(null);
  }, []);

  const handleSortChange = useCallback((next: string) => {
    setSort(next);
    setCurrentPage(0);
    setSelectedIndex(0);
    setSelectedNoteId(null);
  }, []);


  // 2. Use the state variable in useAnkiDeck hook call
  // Pass currentPage instead of hardcoded 0
  const { cards, totalCards, loading, error, language, mapping, refresh, setCards } = useAnkiDeck(selectedDeckName, currentPage, sort, filters, cardsPerPage);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [explicitCard, setExplicitCard] = useState<Card | null>(null);
  const [activeBox, setActiveBox] = useState<'card' | 'examples' | null>(null);
  const CardContextScrollRef = useRef<HTMLDivElement>(null);
  const examplesScrollRef = useRef<HTMLDivElement>(null);

  // Ensure totalPages recalculates correctly when `totalCards` changes
  const totalPages = Math.max(1, Math.ceil(totalCards / cardsPerPage));

  const prevDeckRef = useRef<string | undefined>(undefined);
  
  useEffect(() => {
    const pageCount = cards.length;
  
    // If the deck changed, reset page/index and identity selection
    if (prevDeckRef.current !== selectedDeckName) {
      setCurrentPage(0);
      setSelectedIndex(0);
      setSelectedNoteId(null);
    } else {
      // Otherwise only fix out-of-range index
      if (selectedIndex >= pageCount) setSelectedIndex(0);
    }
  
    prevDeckRef.current = selectedDeckName;
  }, [cards, selectedDeckName]);
  
  // Ensure selection stays valid when cards or page change (only clamp out-of-range)
  useEffect(() => {
    const pageCount = cards.length;
    // If the selected index is out of range, clamp it to 0 (keep page intact)
    if (selectedIndex > 0 && selectedIndex >= pageCount) {
      setSelectedIndex(0);
    }
  }, [cards, currentPage, selectedIndex]);

  const currentCards = cards;
  const currentCard = useMemo(() => {
    if (explicitCard) return explicitCard;
    if (selectedNoteId != null) {
      const found = cards.find(c => c.noteId === selectedNoteId) ?? null;
      // eslint-disable-next-line no-console
      console.log('App.currentCard lookup', { selectedNoteId, found: !!found, pageCards: cards.length });
      return found;
    }
    const fallback = currentCards[selectedIndex] ?? null;
    // eslint-disable-next-line no-console
    console.log('App.currentCard fallback', { selectedIndex, hasFallback: !!fallback });
    return fallback;
  }, [cards, currentCards, selectedIndex, selectedNoteId, explicitCard]);

  useEffect(() => {
    let cancelled = false;
    async function fetchSingleNote(id: number) {
      try {
        // eslint-disable-next-line no-console
        console.log('App.fetchSingleNote start', id);
        const res = await fetch(`/api/notes/${encodeURIComponent(String(id))}`);
        // eslint-disable-next-line no-console
        console.log('App.fetchSingleNote response status', res.status);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        // eslint-disable-next-line no-console
        console.log('App.fetchSingleNote response data', data);
        const note = data?.note ?? data;
        const noteFields: any = note.fields || {};
        const fields: Card['fields'] = Object.entries(noteFields).map(([label, v]: any) => ({
          label,
          value: (v && (v.value ?? v)) || ''
        }));
        // Prefer mapping returned by the single-note endpoint when available
        const responseMapping = data?.mapping ?? mapping;
        const expressionField = responseMapping?.expression;
        let expr = '';
        if (expressionField) {
          expr = fields.find(f => f.label === expressionField)?.value ?? '';
        } else {
          expr = fields.find(f => /Expression|Word|Kanji/i.test(f.label))?.value ?? fields[0]?.value ?? '';
        }

        const card: Card = {
          word: expr,
          fields,
          examples: note.examples ?? [],
          noteId: note.noteId ?? note.id
        };

        // eslint-disable-next-line no-console
        console.log('App.fetchSingleNote built card', { noteId: card.noteId, word: card.word });
        if (!cancelled) setExplicitCard(card);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch single note', err);
        if (!cancelled) setExplicitCard(null);
      }
    }

    if (selectedNoteId == null) {
      setExplicitCard(null);
      return;
    }

    const found = cards.find(c => c.noteId === selectedNoteId);
    if (found) {
      setExplicitCard(null);
      return;
    }

    void fetchSingleNote(selectedNoteId);
    return () => {
      cancelled = true;
    };
  }, [selectedNoteId, cards, mapping]);

  useEffect(() => {
    if (loading) return;
    if (!error) return;
    setCurrentPage(0);
    setSelectedNoteId(null);
    setSelectedIndex(0);
    setActiveBox(null);
    setIsDrawerOpen(false);
  }, [loading, error]);

  // fetch example sentences for the selected card when it lacks examples
  useEffect(() => {
    let canceled = false;
    async function fetchIfNeeded(card: Card | null) {
      if (!card || (card.examples && card.examples.length > 0)) return;
      const key = (card.noteId ?? card.word) as any;
      if (key == null) return;
      if (examplesFetchAttemptedRef.current.has(key)) return;
      examplesFetchAttemptedRef.current.add(key);
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
        if (canceled) return;
        console.error('Failed to fetch sentences for', card?.word, err);
      }
    }
    fetchIfNeeded(currentCard);
    return () => { canceled = true; }
  }, [currentCard, setCards]);

  useEffect(() => {
    examplesFetchAttemptedRef.current.clear();
  }, [selectedDeckName]);

  // Pagination Handlers
  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(prev => prev + 1);
      setSelectedIndex(0);
      setSelectedNoteId(null);
    }
  };

  const handlePrevious = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
      setSelectedIndex(0);
      setSelectedNoteId(null);
    }
  };

  const handleCardsPerPageChange = (newSize: number) => {
    setCardsPerPage(newSize);
    setCurrentPage(0);
    setSelectedIndex(0);
    setSelectedNoteId(null);
  };

  const handleSettingsApplied = () => {
    setSettingsEpoch((v) => v + 1);
    setFilters([]);
    setCurrentPage(0);
    setSelectedIndex(0);
    setSelectedNoteId(null);
    refresh();
  };

  const setCardFieldValues = (noteId: number, jp: string, en: string, audioId?: string) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.noteId !== noteId) return c;
        const updatedFields = c.fields.map((f) => {
          if (f.label === 'Sentence') return { ...f, value: jp };
          if (f.label === 'SentenceTranslation') return { ...f, value: en };
          if (f.label === 'SentenceAudio' && audioId) return { ...f, value: `[sound:${audioId}]` };
          return f;
        });
        return { ...c, fields: updatedFields };
      }),
    );
  };

  // Card Update Handler
  const handleUpdateCard = async (
    jp: string,
    en: string,
    sentence_audio?: string,
    explicitNoteId?: number,
    ttsVoiceName?: string
  ) => {
    const noteId = explicitNoteId ?? currentCard?.noteId;
    console.log('App: handleUpdateCard called', { noteId, explicitNoteId, jp, en, sentence_audio, ttsVoiceName });
    if (!noteId) {
      toast.error(t("Cannot update: no selected Anki note."));
      return;
    }
    const payload = { jp, en, sentence_audio: sentence_audio ? String(sentence_audio) : undefined };
    try {
      const res = await fetch(`/api/notes/${noteId}/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const text = await res.text(); throw new Error(text); }

      const wantsTts = Boolean(ttsVoiceName && String(ttsVoiceName).trim());
      const mappingProvided = Boolean(mapping && Object.keys(mapping).length > 0);
      const sentenceAudioEnabled = !mappingProvided || Boolean(mapping['sentence_audio']);
      if (wantsTts && sentenceAudioEnabled && jp.trim()) {
        const ttsRes = await fetch(`/api/tts/generate-note-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteId,
            voiceName: String(ttsVoiceName),
            generateSentenceAudio: true,
            generateExpressionAudio: false,
          }),
        });
        if (!ttsRes.ok) {
          const text = await ttsRes.text();
          throw new Error(text);
        }
      }

      toast.success(t("Card updated ✅"));
      setCardFieldValues(noteId, jp, en, sentence_audio); // immediate UI sync (TTS audio will come from refresh)
      await refresh();
    } catch (err:any) { console.error('Failed to update note', err);
      toast.error(t("errors.failedToUpdateNote", { message: err?.message ?? t("Unknown error") })); }
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
    // Also update explicitCard (single-note fetched for off-page selection)
    setExplicitCard(prev => {
      if (!prev) return prev;
      if (prev.noteId !== noteId) return prev;
      return { ...prev, fields: prev.fields.map(f => f.label === label ? { ...f, value } : f) };
    });
  };

  const getMediaFile = async (filename: string) => {
    const response = await fetch("http://localhost:8765", {
      method: "POST",
      body: JSON.stringify({
        action: "retrieveMediaFile",
        version: 6,
        params: { filename }
      })
    });
    return await response.json(); // Returns Base64 data
  };

  const handleCardContextHeaderHover = (e: React.WheelEvent<HTMLDivElement>) => {
    if (CardContextScrollRef.current) { e.preventDefault(); CardContextScrollRef.current.scrollTop += e.deltaY; }
  };

  const handleExamplesHeaderHover = (e: React.WheelEvent<HTMLDivElement>) => {
    if (examplesScrollRef.current) { e.preventDefault(); examplesScrollRef.current.scrollTop += e.deltaY; }
  };
  
  useEffect(() => {

  console.log('Media folder b64?'+ getMediaFile);
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
    <div data-component="App" className="min-h-screen flex flex-col bg-[var(--anki-bg-start)]">
      <Header onSettingsApplied={handleSettingsApplied} />
      <Toaster 
        theme="dark" 
        position="bottom-right"
        richColors
        toastOptions={{
          style: {
            background: 'var(--anki-bg-start)',
            color: 'var(--anki-text-main)',
            border: '1.5px solid var(--anki-border-white)',
            borderRadius: '12px',
            boxShadow: 'var(--anki-inner-glow), 0 10px 15px -3px rgba(0, 0, 0, 0.5)',
          }
        }}
      />
      
      {isMobile ? (
        /* Mobile Layout */
        <div data-component="mobile-layout" className="flex-1 flex flex-col overflow-auto">
          <main data-component="mobile-main" className="flex-1">
            <WordGrid
              deckName={selectedDeckName}
              onDeckChange={setSelectedDeckName} 
              words={currentCards.map(c => c.word)}
              selectedIndex={selectedIndex}
              onSelectWord={(index) => {
                setSelectedIndex(index);
                setIsDrawerOpen(true);
              }}
              cards={cards}
              cardsLoading={loading}
              cardsError={error}
              totalCards={totalCards}
              onRefreshCards={refresh}
              onSelectNoteId={(noteId) => {
                // debug: log selected noteId from WordGrid (mobile)
                // eslint-disable-next-line no-console
                console.log('App.onSelectNoteId (mobile) received', noteId);
                setSelectedNoteId(noteId);
                setIsDrawerOpen(true);
              }}
              onNext={handleNext}
              onPrevious={handlePrevious}
              hasNext={currentPage < totalPages - 1}
              hasPrevious={currentPage > 0}
              sort={sort}
              onSortChange={setSort}
              filters={filters}
              onFiltersChange={setFilters}
              language={language}
              mapping={mapping}
                settingsEpoch={settingsEpoch}
              cardsPerPage={cardsPerPage}
              onCardsPerPageChange={handleCardsPerPageChange}
            />
          </main>

          <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
            <DrawerContent data-component="card-details-drawer" className="h-[85vh] bg-[var(--anki-bg-start)] border-[var(--anki-border-white)]">
              <DrawerHeader data-component="card-details-drawer-header" className="border-b border-[var(--anki-border-white)]">
                <DrawerTitle data-component="card-details-drawer-title" className="text-[var(--anki-text-main)]">
                  {currentCard?.word || t("Card Details")}
                </DrawerTitle>
                <DrawerDescription data-component="card-details-drawer-description" className="text-[var(--anki-text-muted)]">
                  {t("Context and examples for this flashcard")}
                </DrawerDescription>
              </DrawerHeader>
              <div data-component="card-details-drawer-content" className="flex-1 overflow-auto p-4 flex flex-col gap-4">
                <div data-component="card-context-panel" className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                  <CardContext 
                    fields={currentCard?.fields ?? []}
                    noteId={currentCard?.noteId}
                    word={currentCard?.word}
                    mapping={mapping}
                    settingsEpoch={settingsEpoch}
                    isActive={activeBox === 'card'}
                    onActivate={() => setActiveBox('card')}
                    onUpdateCard={(jp, en, sentence_audio, noteId, ttsVoiceName) =>
                      handleUpdateCard(jp, en, sentence_audio, noteId, ttsVoiceName)
                    }
                    onUpdateField={(noteId, label, value) => handleUpdateField(noteId, label, value)}
                  />
                </div>
                <div data-component="example-sentences-panel" className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden min-h-[300px]">
                  <ExampleSentences 
                    examples={currentCard?.examples}
                    word={currentCard?.word}
                    noteId={currentCard?.noteId}
                    mapping={mapping}
                    settingsEpoch={settingsEpoch}
                    onUpdateCard={(jp, en, sentence_audio, noteId, ttsVoiceName) =>
                      handleUpdateCard(jp, en, sentence_audio, noteId, ttsVoiceName)
                    }
                    isActive={activeBox === 'examples'}
                    onActivate={() => setActiveBox('examples')}
                  />
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      ) : (
        /* Desktop Layout */
        <div data-component="desktop-layout" className="flex-1 flex items-start">
          <ResizablePanelGroup data-component="desktop-panel-group" direction="horizontal" ref={mainPanelGroupRef} className="h-auto">
            {/* Left Sidebar - Word Grid */}
            <ResizablePanel defaultSize={28} minSize={20}>
              <div data-component="desktop-word-grid-panel" className="border-r border-[var(--anki-border-white)]">
                <WordGrid
                  deckName={selectedDeckName}
                  onDeckChange={setSelectedDeckName} 
                  words={currentCards.map(c => c.word)}
                  selectedIndex={selectedIndex}
                  onSelectWord={(index) => {
                    setSelectedIndex(index);
                  }}
                  cards={cards}
                  cardsLoading={loading}
                  cardsError={error}
                  totalCards={totalCards}
                  onRefreshCards={refresh}
                  onSelectNoteId={(noteId) => {
                    // debug: log selected noteId from WordGrid (desktop)
                    // eslint-disable-next-line no-console
                    console.log('App.onSelectNoteId (desktop) received', noteId);
                    setSelectedNoteId(noteId);
                  }}
                  onNext={handleNext}
                  onPrevious={handlePrevious}
                  hasNext={currentPage < totalPages - 1}
                  hasPrevious={currentPage > 0}
                  sort={sort}
                  onSortChange={handleSortChange}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  language={language}
                  mapping={mapping}
                  settingsEpoch={settingsEpoch}
                  cardsPerPage={cardsPerPage}
                  onCardsPerPageChange={handleCardsPerPageChange}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle data-component="desktop-resize-handle" withHandle onDoubleClick={resetMainLayout} />

            {/* Right Panel - Card Details */}
            <ResizablePanel defaultSize={72} minSize={30}>
              <main data-component="desktop-details-panel" className="min-w-0 flex flex-col h-auto">
                <div data-component="desktop-details-content" className="p-4 flex flex-col gap-4">
                  <div data-component="desktop-card-context-panel" className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                    <div style={{ height: `${cardContextVh}vh`, minHeight: 280, maxHeight: '80vh' }}>
                      <CardContext 
                        fields={currentCard?.fields ?? []}
                        noteId={currentCard?.noteId}
                        word={currentCard?.word}
                        mapping={mapping}
                        settingsEpoch={settingsEpoch}
                        ref={CardContextScrollRef}
                        isActive={activeBox === 'card'}
                        onActivate={() => setActiveBox('card')}
                        onUpdateCard={(jp, en, sentence_audio, noteId, ttsVoiceName) =>
                          handleUpdateCard(jp, en, sentence_audio, noteId, ttsVoiceName)
                        }
                        onUpdateField={(noteId, label, value) => handleUpdateField(noteId, label, value)}
                      />
                    </div>
                  </div>

                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    data-component="desktop-card-context-resizer"
                    className="cursor-row-resize touch-none select-none bg-transparent hover:bg-blue-500/50 transition-colors relative flex h-1.5 w-full items-center justify-center after:absolute after:inset-x-0 after:top-1/2 after:h-6 after:-translate-y-1/2"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const target = e.currentTarget as HTMLElement;
                      resizePointerTargetRef.current = target;
                      resizePointerIdRef.current = e.pointerId;
                      try {
                        target.setPointerCapture(e.pointerId);
                      } catch {
                        // ignore
                      }
                      startCardContextResize(e.clientY);
                    }}
                  >
                    <div data-component="desktop-card-context-resizer-handle" className="bg-slate-800 border-slate-600 z-10 flex h-5 w-10 items-center justify-center rounded-sm border shadow-sm">
                      <GripVerticalIcon className="size-3 text-slate-400 rotate-90" />
                    </div>
                  </div>

                  <div data-component="desktop-example-sentences-panel" className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-visible">
                    <ExampleSentences 
                      examples={currentCard?.examples}
                      word={currentCard?.word}
                      noteId={currentCard?.noteId}
                      mapping={mapping}
                      settingsEpoch={settingsEpoch}
                      onUpdateCard={(jp, en, sentence_audio, noteId, ttsVoiceName) =>
                        handleUpdateCard(jp, en, sentence_audio, noteId, ttsVoiceName)
                      }
                      ref={examplesScrollRef}
                      isActive={activeBox === 'examples'}
                      onActivate={() => setActiveBox('examples')}
                    />
                  </div>
                </div>
              </main>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )}
    </div>
  );
}
