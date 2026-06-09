import { ChevronLeft, ChevronRight, ChevronDown, Inbox, Search, RotateCw, X, Volume2, VolumeOff, VolumeX, Plus, FilePlus2, Filter, Check, LayoutGrid, Grid2X2, Grid3X3, AlertTriangle, CircleHelp } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { listAnkiDecks, useAnkiDeck, Card } from '../hooks/useAnkiDeck';
import { fetchSentencesFor } from '../hooks/useSentences';
import { toast } from 'sonner';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Progress } from './ui/progress';
import { useIsMobile } from './ui/use-mobile';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { useTranslation } from "react-i18next";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "../i18n";

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
  onSelectNoteId?: (noteId: number) => void; //dedicated for absolute referencing.
  // External deck/card data when WordGrid is used in controlled mode
  cards?: Card[];
  cardsLoading?: boolean;
  cardsError?: string | null;
  totalCards?: number;
  onRefreshCards?: () => void;
  sort?: string;
  onSortChange?: (sort: string) => void;
  filters?: string[];
  onFiltersChange?: (filters: string[]) => void;
  language?: 'jp' | 'en';
  mapping?: Record<string, string>;
  settingsEpoch?: number;
  cardsPerPage?: number;
  onCardsPerPageChange?: (size: number) => void;
}

const GridIcons = ({ size }: { size: number }) => {
  if (size <= 16) return <Grid2X2 className="size-3.5 text-blue-400" />;
  if (size <= 25) return <Grid3X3 className="size-3.5 text-blue-400" />;
  return <LayoutGrid className="size-3.5 text-blue-400" />;
};

const BulkEditIcon = ({ className }: { className?: string }) => {
  return (
    <svg viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13 10H20C21.6569 10 23 11.3431 23 13V20C23 21.6569 21.6569 23 20 23H13C11.3431 23 10 21.6569 10 20V13C10 11.3431 11.3431 10 13 10ZM18 8H13C10.2386 8 8 10.2386 8 13V18C6.34315 18 5 16.6569 5 15V8C5 6.34315 6.34315 5 8 5H15C16.6569 5 18 6.34315 18 8ZM13 3H8C5.23858 3 3 5.23858 3 8V13C1.34315 13 0 11.6569 0 10V3C0 1.34315 1.34315 0 3 0H10C11.6569 0 13 1.34315 13 3Z"
        fill="currentColor"
      />
    </svg>
  );
};

type TargetLanguage = "en-US" | "pt-BR";

type TtsVoiceOption = {
  id: string;
  label: string;
  provider?: string;
};

const getDefaultTargetLanguage = (): TargetLanguage => {
  if (typeof window === "undefined") return "en-US";
  const raw = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY);
  return raw === "pt-BR" ? "pt-BR" : "en-US";
};

const normalizeTtsVoiceOptions = (voices: unknown): TtsVoiceOption[] => {
  if (!Array.isArray(voices)) return [];
  const normalized = voices
    .map((voice) => ({
      id: String((voice as any)?.id ?? '').trim(),
      label: String((voice as any)?.label ?? (voice as any)?.id ?? '').trim(),
      provider: String((voice as any)?.provider ?? '').trim() || undefined,
    }))
    .filter((voice) => voice.id);
  return normalized;
};

const getTtsVoiceLabel = (voiceId: string | null | undefined, options: TtsVoiceOption[]): string => {
  const id = String(voiceId ?? '').trim();
  if (!id) return '';
  return options.find((voice) => voice.id === id)?.label ?? id;
};

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
  onSelectNoteId,
  cards: externalCards,
  cardsLoading: externalCardsLoading,
  cardsError: externalCardsError,
  totalCards: externalTotalCards,
  onRefreshCards,
  sort = 'most_recent',
  onSortChange,
  filters = [],
  onFiltersChange,
  language = 'en',
  mapping,
  settingsEpoch = 0,
  cardsPerPage = 25,
  onCardsPerPageChange,
}: WordGridProps) {
  const { t, i18n } = useTranslation();
  const controlled = words !== undefined;
  const internalMode = !!deckName && !controlled;

  // Track container width for responsive grid
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const gridCols = useMemo(() => {
    const dense = cardsPerPage >= 50;

    if (dense) {
      if (containerWidth >= 800) return 10;
      if (containerWidth >= 600) return 8;
      if (containerWidth >= 500) return 7;
      return 6;
    }

    if (containerWidth >= 800) return 8;
    if (containerWidth >= 600) return 6;
    if (containerWidth >= 500) return 5;
    return 4;
  }, [containerWidth, cardsPerPage]);

  // Fetch decks using the new hook
  const { deckNames, loadingDecks, error: deckError, refreshDecks } = listAnkiDecks();
  
  const [internalPage, setInternalPage] = useState(0)
  const [internalIndex, setInternalIndex] = useState(0)

  // Internal deck fetching when WordGrid is driving the cards itself
  const {
    cards: internalCards,
    loading: internalLoading,
    refresh: internalRefresh,
    error: internalCardsError,
    language: internalLanguage,
    totalCards: internalTotalCards,
  } = useAnkiDeck(internalMode ? deckName : undefined, internalPage, sort, filters, cardsPerPage);

  // Decide which source of truth to use for cards/loading/error
  const cards = internalMode ? internalCards : (externalCards ?? []);
  const loading = internalMode ? internalLoading : (externalCardsLoading ?? false);
  const cardsError = internalMode ? internalCardsError : (externalCardsError ?? null);
  const refreshCards = internalMode ? internalRefresh : (onRefreshCards ?? (() => {}));
  const currentLanguage = internalMode ? internalLanguage : language;
  const totalDeckCards = internalMode ? internalTotalCards : (externalTotalCards ?? 0);

  const getLanguageName = (lang: string) => {
    switch (lang) {
      case 'jp': return '日本語';
      case 'fr': return 'Français';
      case 'de': return 'Deutsch';
      case 'es': return 'Español';
      case 'en': return 'English';
      default: return lang.toUpperCase();
    }
  };

  const hasConnectionError = !!deckError || !!cardsError;
  const showConnectionEmptyState = !loading && hasConnectionError;
  const showFilteredEmptyState =
    !loading &&
    !hasConnectionError &&
    !!deckName &&
    filters.length > 0 &&
    cards.length === 0;
  const showDeckEmptyState =
    !loading &&
    !hasConnectionError &&
    !!deckName &&
    filters.length === 0 &&
    cards.length === 0;

  useEffect(() => {
    refreshDecks();
    refreshCards();
    setInternalPage(0);
    setInternalIndex(0);
    setSelectedNoteId(null);
  }, [settingsEpoch]);

  useEffect(() => {
    if (!onDeckChange) return;
    if (!deckNames || deckNames.length === 0) return;
    if (!deckName || !deckNames.includes(deckName)) {
      onDeckChange(deckNames[0]);
      setInternalPage(0);
      setInternalIndex(0);
      setSelectedNoteId(null);
    }
  }, [deckNames, deckName, onDeckChange]);

  //Can handleSelect use the actualCardId instead?
  const handleSelect = (index: number) => {
    if (internalMode) {
      setInternalIndex(index)
    } else {
      onSelectWord?.(index);
      //console.log("Is this even? "+ cards[index]?.noteId)
      //console.log("Content index?" + actualNoteId)
      //console.log(cards[0]); // Object { word: "一概に", fields: (10) […], examples: [], noteId: 1771416288506 }
    }
  }

const handleSelectById = (index: number, noteId?: number) => {
  if (internalMode) {
    setInternalIndex(index);
    
    if (noteId !== undefined) {
      setSelectedNoteId(noteId);
      onSelectNoteId?.(noteId);
    }
  } else {
    onSelectWord?.(index);
    if (noteId !== undefined) {
      setSelectedNoteId(noteId);
      onSelectNoteId?.(noteId);
    }
  }
};

  //1. Search Query logic
  const [searchQuery, setSearchQuery] = useState("");
  const searchActive = !!searchQuery.trim();

  const filteredCards = useMemo(() => {
    if (!searchActive) return cards;
    return cards.filter((card) =>
      card.word.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [cards, searchActive, searchQuery]);

  // 2. Pagination: when searching, always page over the full filteredCards list
  const totalPages = useMemo(() => {
    const totalItems = (internalMode || searchActive) ? filteredCards.length : (words?.length || 0);
    return Math.max(1, Math.ceil(totalItems / cardsPerPage));
  }, [internalMode, searchActive, filteredCards.length, words?.length, cardsPerPage]);

  const displayCards = useMemo(() => {
    if (internalMode || searchActive) {
      return filteredCards
        .slice(internalPage * cardsPerPage, (internalPage + 1) * cardsPerPage)
        .map(c => c.word);
    }

    // Controlled, non-search mode: show the words exactly as provided by the parent (App drives paging)
    return (words ?? []);
  }, [internalMode, searchActive, filteredCards, internalPage, words]);

  
  const cardByWord = useMemo(() => {
    const map = new Map<string, Card>();
    cards.forEach(card => {
      map.set(card.word, card);
    });
    return map;
  }, [cards]);

  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkSelectedNoteIds, setBulkSelectedNoteIds] = useState<Set<number>>(new Set());
  const [bulkSelectionIsDeckAll, setBulkSelectionIsDeckAll] = useState(false);
  const [bulkSelectAllDeckLoading, setBulkSelectAllDeckLoading] = useState(false);
  const bulkSelectedCount = bulkSelectedKeys.size;
  const bulkMode = bulkSelectedCount > 1;

  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const [bulkAddMissingOpen, setBulkAddMissingOpen] = useState(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkClearInternalFields, setBulkClearInternalFields] = useState<string[]>([]);
  const [bulkActionTab, setBulkActionTab] = useState<'' | 'random_sentences' | 'translations' | 'tts' | 'clear_fields'>('');
  const [bulkConfirmRandomOpen, setBulkConfirmRandomOpen] = useState(false);
  const [bulkConfirmTranslationsOpen, setBulkConfirmTranslationsOpen] = useState(false);
  const [bulkConfirmClearOpen, setBulkConfirmClearOpen] = useState(false);
  const [bulkWriteConfirmOpen, setBulkWriteConfirmOpen] = useState(false);
  const [bulkTtsModelsOpen, setBulkTtsModelsOpen] = useState(false);
  const translationServiceName = 'DeepL';
  const [bulkUseTranslationService, setBulkUseTranslationService] = useState(true);
  // Start bulk TTS options empty — server will populate if keys configured
  const [bulkTtsVoiceName, setBulkTtsVoiceName] = useState<string | null>(null);
  const [bulkTtsSelectedVoiceName, setBulkTtsSelectedVoiceName] = useState<string>('');
  const [bulkTtsEnabledModels, setBulkTtsEnabledModels] = useState<string[]>([]);
  const [bulkTtsVoiceOptions, setBulkTtsVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [bulkTtsIncludeExpressionAudio, setBulkTtsIncludeExpressionAudio] = useState(false);
  const [bulkTtsLoading, setBulkTtsLoading] = useState(false);
  const [bulkTtsPreviewVoiceLoading, setBulkTtsPreviewVoiceLoading] = useState(false);
  const [bulkTtsPreviewAudioLoadingNoteId, setBulkTtsPreviewAudioLoadingNoteId] = useState<number | null>(null);
  const [bulkHasDeeplKey, setBulkHasDeeplKey] = useState(false);
  const [bulkHasAzureKey, setBulkHasAzureKey] = useState(false);
  const [bulkEnhanceAddTranslation, setBulkEnhanceAddTranslation] = useState(false);
  const [bulkEnhanceAddAudio, setBulkEnhanceAddAudio] = useState(false);
  const [bulkEnhanceAddContent, setBulkEnhanceAddContent] = useState(false);
  const [bulkEnhanceAddSentence, setBulkEnhanceAddSentence] = useState(false);
  const [bulkEnhanceAddSentenceTranslation, setBulkEnhanceAddSentenceTranslation] = useState(false);
  const [bulkEnhanceAddSentenceAudio, setBulkEnhanceAddSentenceAudio] = useState(false);
  const [bulkEnhanceSentenceMode, setBulkEnhanceSentenceMode] = useState<'random' | 'most_common' | 'jlpt'>('random');
  const [bulkEnhanceTargetLang, setBulkEnhanceTargetLang] = useState<TargetLanguage>(() => getDefaultTargetLanguage());
  const [bulkEnhanceSentenceAudioVoiceName, setBulkEnhanceSentenceAudioVoiceName] = useState('');
  const [bulkEnhanceConfirmOpen, setBulkEnhanceConfirmOpen] = useState(false);
  const [bulkEnhanceProgress, setBulkEnhanceProgress] = useState(0);
  const [bulkHasPreviewChanges, setBulkHasPreviewChanges] = useState(false);
  const [bulkSentenceFieldsOpen, setBulkSentenceFieldsOpen] = useState(false);
  const [bulkClearMenuOpen, setBulkClearMenuOpen] = useState(false);
  const [bulkClearConfirmOpen, setBulkClearConfirmOpen] = useState(false);
  const [bulkSelectAllFiltered, setBulkSelectAllFiltered] = useState(false);
  const [bulkExpandedGlossaryNoteIds, setBulkExpandedGlossaryNoteIds] = useState<number[]>([]);
  const [bulkRandomTotal, setBulkRandomTotal] = useState(0);
  const [bulkRandomDone, setBulkRandomDone] = useState(0);
  const [bulkLastUpdatedNoteIds, setBulkLastUpdatedNoteIds] = useState<number[]>([]);
  const [bulkLastUpdatedLabel, setBulkLastUpdatedLabel] = useState('');
  const [bulkRecentlyWrittenNoteIds, setBulkRecentlyWrittenNoteIds] = useState<number[]>([]);
  const [bulkRecentlyWrittenChanges, setBulkRecentlyWrittenChanges] = useState<
    Record<number, { entry: boolean; glossary: boolean; sentence: boolean; translation: boolean }>
  >({});
  const [bulkPreviewRecentlyUpdatedNoteIds, setBulkPreviewRecentlyUpdatedNoteIds] = useState<number[]>([]);
  const prevBulkAddMissingOpenRef = useRef(false);
  const [bulkRandomRows, setBulkRandomRows] = useState<Array<{
    noteId: number;
    expression: string;
    glossary: string;
    expressionHasAudio: boolean;
    expressionAudioFilename?: string;
    expressionAudioTagFilename?: string;
    sentence: string;
    sentenceHasAudio: boolean;
    sentenceAudioFilename?: string;
    sentenceAudioTagFilename?: string;
    translation: string;
    ttsModel: string;
    include: boolean;
    noSentencesFound?: boolean;
    status: 'missing' | 'updated' | 'skipped' | 'failed';
    message: string;
  }>>([]);
  const bulkRandomInitKeyRef = useRef<string>('');
  const [bulkEntryColWidth, setBulkEntryColWidth] = useState(220);
  const [bulkGlossaryColWidth, setBulkGlossaryColWidth] = useState(240);
  const [bulkDetailsColWidth, setBulkDetailsColWidth] = useState(560);
  const bulkColResizeRef = useRef<null | {
    column: 'entry' | 'glossary' | 'details';
    startX: number;
    startW: number;
  }>(null);
  const bulkTableRef = useRef<HTMLDivElement | null>(null);
  const bulkMediaAudioRef = useRef<HTMLAudioElement | null>(null);
  const bulkMediaLoadingIntervalRef = useRef<number | null>(null);
  const [bulkFailedAudioFilenames, setBulkFailedAudioFilenames] = useState<Set<string>>(() => new Set());
  const [bulkLoadingAudioFilename, setBulkLoadingAudioFilename] = useState<string | null>(null);
  const [bulkLoadingAudioSeconds, setBulkLoadingAudioSeconds] = useState(1);
  const [bulkActiveNoteId, setBulkActiveNoteId] = useState<number | null>(null);
  const bulkRowElsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const bulkCardCacheRef = useRef<Map<number, Card>>(new Map());
  const [bulkCardCacheEpoch, setBulkCardCacheEpoch] = useState(0);
  const BULK_DECK_FETCH_LIMIT = 100;
  const LARGE_ACTION_WARNING_THRESHOLD = 100;
  const [bulkDeckMode, setBulkDeckMode] = useState(false);
  const [bulkDeckLoading, setBulkDeckLoading] = useState(false);
  const [bulkDeckLoaded, setBulkDeckLoaded] = useState(0);
  const [bulkDeckTotal, setBulkDeckTotal] = useState<number | null>(null);
  const [bulkDeckOffset, setBulkDeckOffset] = useState(0);

  useEffect(() => {
    return () => {
      if (bulkMediaLoadingIntervalRef.current != null) {
        window.clearInterval(bulkMediaLoadingIntervalRef.current);
      }
      if (bulkMediaAudioRef.current) {
        bulkMediaAudioRef.current.pause();
      }
    };
  }, []);

  useEffect(() => {
    const wasOpen = prevBulkAddMissingOpenRef.current;
    if (wasOpen && !bulkAddMissingOpen) {
      onFiltersChange?.([]);
    }
    prevBulkAddMissingOpenRef.current = bulkAddMissingOpen;
  }, [bulkAddMissingOpen, onFiltersChange]);

  const clearBulkSelection = useCallback(() => {
    setBulkSelectedKeys(new Set());
    setBulkSelectedNoteIds(new Set());
    setBulkSelectionIsDeckAll(false);
    setBulkActionsOpen(false);
  }, []);

  const prevDeckNameRef = useRef<string | undefined>(deckName);
  useEffect(() => {
    const prev = prevDeckNameRef.current;
    if (prev && deckName && prev !== deckName) {
      clearBulkSelection();
      setBulkAddMissingOpen(false);
      setGridDragBox(null);
    }
    prevDeckNameRef.current = deckName;
  }, [deckName, clearBulkSelection]);

  const filterGroups = useMemo(() => {
    return [
      {
        id: 'audio',
        internal_key: 'sentence_audio',
        label: 'Sentence Audio',
        missingId: 'missing_audio',
        containsId: 'contains_audio',
        missingLabel: 'Missing Sentence Audio',
        containsLabel: 'Contains Sentence Audio',
        missingColor: 'text-red-400',
        containsColor: 'text-emerald-400',
        activeBorder: 'border-red-500/40',
        activeRing: 'focus:ring-red-500',
        activeText: 'text-red-300',
        switchChecked: 'data-[state=checked]:bg-red-600',
      },
      {
        id: 'entry_audio',
        internal_key: 'expression_audio',
        label: 'Entry Audio',
        missingId: 'missing_entry_audio',
        containsId: 'contains_entry_audio',
        missingLabel: 'Missing Entry Audio',
        containsLabel: 'Contains Entry Audio',
        missingColor: 'text-blue-300',
        containsColor: 'text-emerald-400',
        activeBorder: 'border-blue-500/40',
        activeRing: 'focus:ring-blue-500',
        activeText: 'text-blue-200',
        switchChecked: 'data-[state=checked]:bg-blue-600',
      },
      {
        id: 'sentence',
        internal_key: 'sentence',
        label: 'Sentence',
        missingId: 'missing_sentence',
        containsId: 'contains_sentence',
        missingLabel: 'Missing Sentence',
        containsLabel: 'Contains Sentence',
        missingColor: 'text-orange-400',
        containsColor: 'text-emerald-400',
        activeBorder: 'border-emerald-500/40',
        activeRing: 'focus:ring-emerald-500',
        activeText: 'text-emerald-300',
        switchChecked: 'data-[state=checked]:bg-emerald-600',
      },
      {
        id: 'translation',
        internal_key: 'translation',
        label: 'Translation',
        missingId: 'missing_translation',
        containsId: 'contains_translation',
        missingLabel: 'Missing Translation',
        containsLabel: 'Contains Translation',
        missingColor: 'text-yellow-400',
        containsColor: 'text-emerald-400',
        activeBorder: 'border-orange-500/40',
        activeRing: 'focus:ring-orange-500',
        activeText: 'text-orange-300',
        switchChecked: 'data-[state=checked]:bg-orange-600',
      },
      {
        id: 'glossary',
        internal_key: 'glossary',
        label: 'Glossary',
        missingId: 'missing_glossary',
        containsId: 'contains_glossary',
        missingLabel: 'Missing Glossary',
        containsLabel: 'Contains Glossary',
        missingColor: 'text-rose-300',
        containsColor: 'text-emerald-400',
        activeBorder: 'border-rose-500/40',
        activeRing: 'focus:ring-rose-500',
        activeText: 'text-rose-200',
        switchChecked: 'data-[state=checked]:bg-rose-700',
      },
    ] as const;
  }, []);

  const canShowGroupFilter = useCallback((internalKey: string) => {
    if (!mapping) return true;
    return Boolean((mapping as any)[internalKey]);
  }, [mapping]);

  const visibleFilterGroups = useMemo(
    () => filterGroups.filter((g) => canShowGroupFilter(g.internal_key)),
    [filterGroups, canShowGroupFilter]
  );

  const showGlossaryField = canShowGroupFilter('glossary');
  const showExpressionAudioField = canShowGroupFilter('expression_audio');
  const showSentenceField = canShowGroupFilter('sentence');
  const showTranslationField = canShowGroupFilter('translation');
  const showSentenceAudioField = canShowGroupFilter('sentence_audio');

  const getFilterGroupMode = useCallback((missingId: string, containsId: string) => {
    if (filters.includes(containsId)) return 'contains' as const;
    if (filters.includes(missingId)) return 'missing' as const;
    return null;
  }, [filters]);

  const setFilterGroupState = useCallback((opts: { missingId: string; containsId: string; enabled: boolean; mode?: 'missing' | 'contains' }) => {
    if (!onFiltersChange) return;
    const next = filters.filter((f) => f !== opts.missingId && f !== opts.containsId);
    if (opts.enabled) {
      next.push((opts.mode ?? 'missing') === 'contains' ? opts.containsId : opts.missingId);
    }
    onFiltersChange(next);
  }, [filters, onFiltersChange]);

  const cycleFilterGroupState = useCallback((missingId: string, containsId: string) => {
    const mode = getFilterGroupMode(missingId, containsId);
    if (!mode) {
      setFilterGroupState({ missingId, containsId, enabled: true, mode: 'missing' });
      return;
    }
    if (mode === 'missing') {
      setFilterGroupState({ missingId, containsId, enabled: true, mode: 'contains' });
      return;
    }
    setFilterGroupState({ missingId, containsId, enabled: false });
  }, [getFilterGroupMode, setFilterGroupState]);

  useEffect(() => {
    if (!onFiltersChange) return;
    let next = filters;
    let changed = false;
    for (const g of filterGroups) {
      const hasMissing = next.includes(g.missingId);
      const hasContains = next.includes(g.containsId);
      if (hasMissing && hasContains) {
        next = next.filter((f) => f !== g.missingId);
        changed = true;
      }
    }
    if (changed) onFiltersChange(next);
  }, [filters, filterGroups, onFiltersChange]);

  useEffect(() => {
    if (!onFiltersChange) return;
    const allowed = new Set<string>();
    for (const g of visibleFilterGroups) {
      allowed.add(g.missingId);
      allowed.add(g.containsId);
    }
    const next = filters.filter((f) => allowed.has(f));
    if (next.length !== filters.length) onFiltersChange(next);
  }, [filters, onFiltersChange, visibleFilterGroups]);

  const bulkEffectiveFilters = useMemo(() => {
    const allowed = new Set<string>();
    for (const g of filterGroups) {
      if (!mapping || (mapping as any)[g.internal_key]) {
        allowed.add(g.missingId);
        allowed.add(g.containsId);
      }
    }
    return filters.filter((f) => allowed.has(f));
  }, [filters, mapping, filterGroups]);

  const BULK_TABLE_PAGE_SIZE = 100;
  const [bulkTablePage, setBulkTablePage] = useState(0);
  const bulkSkipNextTablePageResetRef = useRef(false);
  const bulkSavedFiltersRef = useRef<string[] | null>(null);
  const bulkSavedTablePageRef = useRef(0);
  const [bulkTableOverrideNoteIds, setBulkTableOverrideNoteIds] = useState<number[] | null>(null);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    if (bulkSkipNextTablePageResetRef.current) {
      bulkSkipNextTablePageResetRef.current = false;
      return;
    }
    setBulkTablePage(0);
  }, [bulkAddMissingOpen, bulkEffectiveFilters.join(',')]);

  const bulkVisibleRows = useMemo(() => {
    if (bulkEffectiveFilters.length === 0) return bulkRandomRows;
    return bulkRandomRows.filter((r) => {
      const cleanedGlossary = String(r.glossary ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/\[sound:[^\]]+\]/g, '')
        .trim();
      for (const f of bulkEffectiveFilters) {
        if (f === 'missing_audio' && r.sentenceHasAudio) return false;
        if (f === 'contains_audio' && !r.sentenceHasAudio) return false;
        if (f === 'missing_entry_audio' && r.expressionHasAudio) return false;
        if (f === 'contains_entry_audio' && !r.expressionHasAudio) return false;
        if (f === 'missing_sentence' && r.sentence.trim()) return false;
        if (f === 'contains_sentence' && !r.sentence.trim()) return false;
        if (f === 'missing_translation' && r.translation.trim()) return false;
        if (f === 'contains_translation' && !r.translation.trim()) return false;
        if (f === 'missing_glossary' && cleanedGlossary) return false;
        if (f === 'contains_glossary' && !cleanedGlossary) return false;
      }
      return true;
    });
  }, [bulkRandomRows, bulkEffectiveFilters]);

  function getBulkRowMissingScore(row: (typeof bulkRandomRows)[number]) {
    let score = 0;
    if (showSentenceField && !String(row.sentence || '').trim()) score += 1;
    if (showTranslationField && !String(row.translation || '').trim()) score += 1;
    if (showSentenceAudioField && !row.sentenceHasAudio) score += 1;
    if (showGlossaryField && !cleanGlossaryFieldText(row.glossary ?? '')) score += 1;
    if (showExpressionAudioField && !row.expressionHasAudio) score += 1;
    return score;
  }

  const bulkDisplayRows = useMemo(() => {
    if (!bulkTableOverrideNoteIds) return bulkVisibleRows;
    const byId = new Map<number, (typeof bulkRandomRows)[number]>();
    for (const r of bulkRandomRows) byId.set(r.noteId, r);
    return bulkTableOverrideNoteIds.map((id) => byId.get(id)).filter(Boolean) as (typeof bulkRandomRows)[number][];
  }, [bulkTableOverrideNoteIds, bulkRandomRows, bulkVisibleRows]);

  const bulkSortedDisplayRows = useMemo(() => {
    if (bulkTableOverrideNoteIds) return bulkDisplayRows;
    if (bulkDisplayRows.length <= 1) return bulkDisplayRows;
    const originalIndex = new Map<number, number>();
    for (let i = 0; i < bulkRandomRows.length; i += 1) originalIndex.set(bulkRandomRows[i].noteId, i);
    const rows = [...bulkDisplayRows];
    rows.sort((a, b) => {
      const aScore = getBulkRowMissingScore(a);
      const bScore = getBulkRowMissingScore(b);
      if (aScore !== bScore) return bScore - aScore;
      return (originalIndex.get(a.noteId) ?? 0) - (originalIndex.get(b.noteId) ?? 0);
    });
    return rows;
  }, [bulkTableOverrideNoteIds, bulkDisplayRows, bulkRandomRows]);

  const bulkPageCount = useMemo(() => {
    return Math.max(1, Math.ceil(bulkSortedDisplayRows.length / BULK_TABLE_PAGE_SIZE));
  }, [bulkSortedDisplayRows.length]);

  const bulkClampedTablePage = Math.min(Math.max(0, bulkTablePage), Math.max(0, bulkPageCount - 1));

  const bulkTableRows = useMemo(() => {
    const start = bulkClampedTablePage * BULK_TABLE_PAGE_SIZE;
    return bulkSortedDisplayRows.slice(start, start + BULK_TABLE_PAGE_SIZE);
  }, [bulkSortedDisplayRows, bulkClampedTablePage]);

  const bulkVisibleMissingCounts = useMemo(() => {
    let sentence = 0;
    let translation = 0;
    let sentenceAudio = 0;
    let glossary = 0;
    let entryAudio = 0;
    for (const r of bulkDisplayRows) {
      if (!r.include) continue;
      if (showSentenceField && !String(r.sentence || '').trim()) sentence += 1;
      if (showTranslationField && !String(r.translation || '').trim()) translation += 1;
      if (showSentenceAudioField && !r.sentenceHasAudio) sentenceAudio += 1;
      const cleanedGlossary = String(r.glossary ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/\[sound:[^\]]+\]/g, '')
        .trim();
      if (showGlossaryField && !cleanedGlossary) glossary += 1;
      const expressionFilename = String(r.expressionAudioFilename ?? r.expressionAudioTagFilename ?? '').trim();
      const hasWorkingEntryAudio = Boolean(expressionFilename) && !bulkFailedAudioFilenames.has(expressionFilename);
      if (showExpressionAudioField && !hasWorkingEntryAudio) entryAudio += 1;
    }
    return { sentence, translation, sentenceAudio, glossary, entryAudio };
  }, [
    bulkDisplayRows,
    bulkFailedAudioFilenames,
    showGlossaryField,
    showExpressionAudioField,
    showSentenceField,
    showTranslationField,
    showSentenceAudioField,
  ]);

  useEffect(() => {
    if (showGlossaryField) return;
    setBulkEnhanceAddTranslation(false);
  }, [showGlossaryField]);

  useEffect(() => {
    if (showExpressionAudioField) return;
    setBulkEnhanceAddAudio(false);
    setBulkTtsIncludeExpressionAudio(false);
  }, [showExpressionAudioField]);

  useEffect(() => {
    if (showSentenceField) return;
    setBulkEnhanceAddSentence(false);
  }, [showSentenceField]);

  useEffect(() => {
    if (showTranslationField) return;
    setBulkEnhanceAddSentenceTranslation(false);
  }, [showTranslationField]);

  useEffect(() => {
    if (showSentenceAudioField) return;
    setBulkEnhanceAddSentenceAudio(false);
  }, [showSentenceAudioField]);

  useEffect(() => {
    if (!bulkEnhanceAddContent) return;
    if (bulkVisibleMissingCounts.sentence === 0) setBulkEnhanceAddSentence(false);
    if (bulkVisibleMissingCounts.translation === 0) setBulkEnhanceAddSentenceTranslation(false);
    if (bulkVisibleMissingCounts.sentenceAudio === 0) setBulkEnhanceAddSentenceAudio(false);
    if (bulkVisibleMissingCounts.glossary === 0) setBulkEnhanceAddTranslation(false);
    if (bulkVisibleMissingCounts.entryAudio === 0) setBulkEnhanceAddAudio(false);
  }, [
    bulkEnhanceAddContent,
    bulkVisibleMissingCounts.sentence,
    bulkVisibleMissingCounts.translation,
    bulkVisibleMissingCounts.sentenceAudio,
    bulkVisibleMissingCounts.glossary,
    bulkVisibleMissingCounts.entryAudio,
  ]);

  const bulkAllFilteredIncluded = useMemo(() => {
    if (bulkDisplayRows.length === 0) return false;
    for (const r of bulkDisplayRows) {
      if (!r.include) return false;
    }
    return true;
  }, [bulkDisplayRows]);

  const bulkHeaderChecked = bulkDisplayRows.length > 0 && bulkAllFilteredIncluded;

  useEffect(() => {
    if (!bulkSelectAllFiltered) return;
    const idSet = new Set(bulkDisplayRows.map((r) => r.noteId));
    setBulkRandomRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (!idSet.has(r.noteId)) return r;
        if (r.include) return r;
        changed = true;
        return { ...r, include: true };
      });
      return changed ? next : prev;
    });
  }, [bulkSelectAllFiltered, bulkDisplayRows]);

  const bulkIncludedCount = useMemo(() => {
    return bulkDisplayRows.filter((r) => r.include).length;
  }, [bulkDisplayRows]);

  const bulkIncludedEligibleForTtsCount = useMemo(() => {
    if (bulkActionTab !== 'tts') return bulkDisplayRows.filter((r) => r.include && r.sentence.trim()).length;

    const canExpressionAudio = !mapping || Boolean(mapping['expression_audio']);
    return bulkDisplayRows.filter((r) => {
      if (!r.include) return false;
      const needsSentence = r.sentence.trim() && !r.sentenceHasAudio;
      const needsExpression =
        canExpressionAudio && bulkTtsIncludeExpressionAudio && r.expression.trim() && !r.expressionHasAudio;
      return needsSentence || needsExpression;
    }).length;
  }, [bulkDisplayRows, bulkActionTab, bulkTtsIncludeExpressionAudio, mapping]);

  const getBulkGridTemplateColumns = useCallback(() => {
    const cols = [
      `48px`,
      `${Math.max(116, bulkEntryColWidth)}px`,
      `${Math.max(220, bulkDetailsColWidth)}px`,
    ];
    if (showGlossaryField) {
      cols.splice(2, 0, `${Math.max(160, bulkGlossaryColWidth)}px`);
    }
    return cols.join(' ');
  }, [bulkEntryColWidth, bulkGlossaryColWidth, bulkDetailsColWidth, showGlossaryField]);

  const startBulkColumnResize = useCallback(
    (column: 'entry' | 'glossary' | 'details', clientX: number) => {
      const startW =
        column === 'entry'
          ? bulkEntryColWidth
          : column === 'glossary'
            ? bulkGlossaryColWidth
            : bulkDetailsColWidth;

      bulkColResizeRef.current = { column, startX: clientX, startW };
      document.body.style.cursor = 'col-resize';

      const mins = {
        entry: 120,
        glossary: 160,
        details: 220,
      } as const;

      const onMove = (e: PointerEvent) => {
        const ref = bulkColResizeRef.current;
        if (!ref) return;

        const delta = e.clientX - ref.startX;
        const minW = mins[ref.column];
        const nextW = Math.max(minW, ref.startW + delta);

        if (ref.column === 'entry') setBulkEntryColWidth(nextW);
        if (ref.column === 'glossary') setBulkGlossaryColWidth(nextW);
        if (ref.column === 'details') setBulkDetailsColWidth(nextW);
      };

      const onUp = () => {
        bulkColResizeRef.current = null;
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [bulkEntryColWidth, bulkGlossaryColWidth, bulkDetailsColWidth]
  );

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    const el = bulkTableRef.current;
    if (!el) return;

    const apply = () => {
      const w = el.clientWidth;
      if (!w) return;

      const checkboxW = 48;
      const minEntry = 120;
      const minGlossary = 160;
      const minDetails = 220;
      const remaining = Math.max(w - checkboxW, minEntry + minGlossary + minDetails);
      const entry = Math.max(minEntry, Math.round(remaining * 0.16));
      const glossary = Math.max(minGlossary, Math.round(remaining * 0.22));
      const details = Math.max(minDetails, remaining - entry - glossary);

      setBulkEntryColWidth(entry);
      setBulkGlossaryColWidth(glossary);
      setBulkDetailsColWidth(details);
    };

    const raf = requestAnimationFrame(apply);
    const onResize = () => apply();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [bulkAddMissingOpen, settingsEpoch]);

  const noteIdToCard = useMemo(() => {
    const map = new Map<number, Card>();
    cards.forEach((c) => {
      if (c.noteId != null) map.set(c.noteId, c);
    });
    for (const [nid, c] of bulkCardCacheRef.current.entries()) {
      if (!map.has(nid)) map.set(nid, c);
    }
    return map;
  }, [cards, bulkCardCacheEpoch]);

  const bulkPendingWriteCount = useMemo(() => {
    const sentenceField = mapping?.sentence ?? 'Sentence';
    const translationField = mapping?.translation ?? 'SentenceTranslation';
    const glossaryField = mapping?.glossary ?? 'Glossary';

    let count = 0;
    for (const row of bulkRandomRows) {
      if (!row.include) continue;
      if (row.sentenceAudioFilename || row.expressionAudioFilename) {
        count += 1;
        continue;
      }
      const card = noteIdToCard.get(row.noteId);
      if (!card) continue;

      const currentSentence = cleanSentenceFieldText(card.fields.find((f) => f.label === sentenceField)?.value ?? '');
      const currentTranslation = cleanSentenceFieldText(card.fields.find((f) => f.label === translationField)?.value ?? '');
      const currentGlossary = cleanGlossaryFieldText(card.fields.find((f) => f.label === glossaryField)?.value ?? '');
      const rowGlossary = cleanGlossaryFieldText(row.glossary ?? '');

      if (String(row.sentence || '').trim() !== currentSentence) count += 1;
      else if (String(row.translation || '').trim() !== currentTranslation) count += 1;
      else if (rowGlossary !== currentGlossary) count += 1;
    }
    return count;
  }, [bulkRandomRows, mapping, noteIdToCard]);

  const bulkControlsLocked = bulkRunning || bulkHasPreviewChanges || bulkTableOverrideNoteIds != null;

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    setBulkActionTab('');
    setBulkConfirmRandomOpen(false);
    setBulkConfirmTranslationsOpen(false);
    setBulkConfirmClearOpen(false);
    setBulkEnhanceAddTranslation(false);
    setBulkEnhanceAddAudio(false);
    setBulkEnhanceSentenceMode('random');
    setBulkEnhanceTargetLang(getDefaultTargetLanguage());
    setBulkEnhanceSentenceAudioVoiceName('');
    setBulkEnhanceConfirmOpen(false);
    setBulkEnhanceProgress(0);
    setBulkHasPreviewChanges(false);
    setBulkClearMenuOpen(false);
    setBulkClearConfirmOpen(false);
    setBulkSelectAllFiltered(false);
    setBulkLastUpdatedNoteIds([]);
    setBulkLastUpdatedLabel('');
    setBulkEnhanceAddContent(false);
    setBulkEnhanceAddSentence(false);
    setBulkEnhanceAddSentenceTranslation(false);
    setBulkEnhanceAddSentenceAudio(false);
    setBulkFailedAudioFilenames(new Set());
  }, [bulkAddMissingOpen]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/env');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setBulkHasDeeplKey(Boolean(String(data?.DEEPL_AUTH_KEY ?? '').trim()));
            setBulkHasAzureKey(
              Boolean(String(data?.AZURE_SPEECH_KEY ?? '').trim() || String(data?.ELEVEN_LABS_SPEECH_KEY ?? '').trim())
            );
          }
        }
      } catch {
        if (!cancelled) {
          setBulkHasDeeplKey(false);
          setBulkHasAzureKey(false);
        }
      }

      try {
        const voiceRes = await fetch('/api/tts/voice');
        if (!voiceRes.ok) return;
        const voiceData = await voiceRes.json();
        if (cancelled) return;
        const options = normalizeTtsVoiceOptions(voiceData?.voices);
        const v = String(voiceData?.defaultVoiceName ?? voiceData?.voiceName ?? options[0]?.id ?? '').trim();
        setBulkTtsVoiceOptions(options);
        setBulkTtsEnabledModels(options.map((voice) => voice.id));
        setBulkEnhanceSentenceAudioVoiceName((prev) => (options.some((voice) => voice.id === prev) ? prev : v));
        setBulkTtsSelectedVoiceName((prev) => (options.some((voice) => voice.id === prev) ? prev : v));
      } catch {
        if (!cancelled) {
          setBulkTtsVoiceOptions([]);
          setBulkTtsEnabledModels([]);
          setBulkEnhanceSentenceAudioVoiceName('');
          setBulkTtsSelectedVoiceName('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bulkAddMissingOpen]);

  useEffect(() => {
    if (bulkAddMissingOpen) return;
    setBulkRandomTotal(0);
    setBulkRandomDone(0);
    setBulkRandomRows([]);
    bulkRandomInitKeyRef.current = '';
    setBulkLastUpdatedNoteIds([]);
    setBulkLastUpdatedLabel('');
    setBulkActiveNoteId(null);
  }, [bulkAddMissingOpen]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    if (bulkActiveNoteId == null) return;
    const el = bulkRowElsRef.current.get(bulkActiveNoteId);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [bulkAddMissingOpen, bulkActiveNoteId]);

  const bulkRowMappingKey = useMemo(() => {
    return JSON.stringify({
      sentence: mapping?.sentence ?? 'Sentence',
      translation: mapping?.translation ?? 'SentenceTranslation',
      glossary: mapping?.glossary ?? 'Glossary',
      sentence_audio: mapping?.sentence_audio ?? 'SentenceAudio',
      expression_audio: mapping?.expression_audio ?? 'Audio',
    });
  }, [mapping]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;

    const sentenceField = mapping?.sentence ?? 'Sentence';
    const translationField = mapping?.translation ?? 'SentenceTranslation';
    const glossaryField = mapping?.glossary ?? 'Glossary';
    const sentenceAudioField = mapping?.sentence_audio ?? 'SentenceAudio';
    const expressionAudioField = mapping?.expression_audio ?? 'Audio';

    setBulkRandomRows((prev) => {
      const mappingChanged = bulkRandomInitKeyRef.current !== bulkRowMappingKey;
      if (mappingChanged) bulkRandomInitKeyRef.current = bulkRowMappingKey;
      if (bulkDeckMode && !mappingChanged) return prev;

      const prevById = new Map(prev.map((r) => [r.noteId, r]));
      const next: typeof prev = [];
      let changed = mappingChanged;

      for (const noteId of bulkSelectedNoteIds) {
        const existing = prevById.get(noteId);
        if (existing && !mappingChanged) {
          next.push(existing);
          continue;
        }

        const card = noteIdToCard.get(noteId);
        const expression = String(card?.word ?? existing?.expression ?? '').trim();

        const sentence = cleanSentenceFieldText(card?.fields.find((f) => f.label === sentenceField)?.value ?? '');
        const translation = cleanSentenceFieldText(card?.fields.find((f) => f.label === translationField)?.value ?? '');
        const glossary = String(card?.fields.find((f) => f.label === glossaryField)?.value ?? '').trim();

        const sentenceAudioVal = String(card?.fields.find((f) => f.label === sentenceAudioField)?.value ?? '');
        const sentenceHasAudio = /\[sound:.*?\]/.test(sentenceAudioVal);
        const sentenceAudioTagFilename = sentenceHasAudio
          ? (sentenceAudioVal.match(/\[sound:([^\]]+)\]/)?.[1]?.trim() ?? undefined)
          : undefined;

        const expressionAudioVal =
          String(card?.fields.find((f) => f.label === expressionAudioField)?.value ?? '') ||
          String(card?.fields.find((f) => /^(Word)?Audio$/i.test(f.label))?.value ?? '');
        const expressionHasAudio = /\[sound:.*?\]/.test(expressionAudioVal);
        const expressionAudioTagFilename = expressionHasAudio
          ? (expressionAudioVal.match(/\[sound:([^\]]+)\]/)?.[1]?.trim() ?? undefined)
          : undefined;

        const missing: string[] = [];
        if (!sentence) missing.push('Sentence');
        if (!glossary) missing.push('Glossary');
        if (!translation) missing.push('Translation');
        if (!sentenceHasAudio) missing.push('Audio');

        const status: 'missing' | 'skipped' = missing.length > 0 ? 'missing' : 'skipped';
        const message = missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'No missing fields.';
        const include = bulkSelectAllFiltered ? true : (existing?.include ?? missing.length > 0);

        next.push({
          noteId,
          expression,
          glossary,
          expressionHasAudio,
          expressionAudioFilename: undefined,
          expressionAudioTagFilename,
          sentence,
          sentenceHasAudio,
          sentenceAudioFilename: undefined,
          sentenceAudioTagFilename,
          translation,
          ttsModel: existing?.ttsModel ?? bulkTtsEnabledModels[0] ?? '',
          include,
          status,
          message,
        });
        if (!existing) changed = true;
      }

      if (!changed && prev.length !== next.length) changed = true;
      return changed ? next : prev;
    });

    setBulkRandomTotal(bulkSelectedNoteIds.size);
    setBulkRandomDone(0);
  }, [
    bulkAddMissingOpen,
    bulkSelectedNoteIds,
    bulkRowMappingKey,
    mapping,
    noteIdToCard,
    bulkTtsEnabledModels,
    bulkSelectAllFiltered,
    bulkDeckMode,
  ]);

  const getFieldValue = useCallback((card: Card, internalKey: 'sentence' | 'translation' | 'sentence_audio', fallback: string) => {
    const label = mapping?.[internalKey] ?? fallback;
    const v = card.fields.find((f) => f.label === label)?.value ?? '';
    return String(v ?? '');
  }, [mapping]);

  const bulkSelectedCards = useMemo(() => {
    return Array.from(bulkSelectedNoteIds)
      .map((nid) => noteIdToCard.get(nid))
      .filter(Boolean) as Card[];
  }, [bulkSelectedNoteIds, noteIdToCard]);

  const bulkMissingAudioEntries = useMemo(() => {
    const out: Array<{ noteId: number; word: string; sentence: string }> = [];
    for (const nid of bulkSelectedNoteIds) {
      const card = noteIdToCard.get(nid);
      if (!card) continue;
      const sentence = getFieldValue(card, 'sentence', 'Sentence').trim();
      const audioVal = getFieldValue(card, 'sentence_audio', 'SentenceAudio');
      const hasAudio = /\[sound:.*?\]/.test(audioVal);
      if (sentence && !hasAudio) {
        out.push({ noteId: nid, word: card.word, sentence });
      }
    }
    return out;
  }, [bulkSelectedNoteIds, noteIdToCard, getFieldValue]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    if (bulkActionTab !== 'tts') return;

    let canceled = false;
    async function loadVoice() {
      setBulkTtsLoading(true);
      try {
        const base = (import.meta as any).env?.DEV ? 'http://localhost:8000' : '';
        const voiceRes = await fetch(`${base}/api/tts/voice`);
        if (!voiceRes.ok) throw new Error(await voiceRes.text());
        const voiceData = await voiceRes.json();
        if (canceled) return;
        const options = normalizeTtsVoiceOptions(voiceData?.voices);
        const defaultVoice = String(voiceData?.defaultVoiceName ?? voiceData?.voiceName ?? options[0]?.id ?? '').trim();
        setBulkTtsVoiceOptions(options);
        setBulkTtsVoiceName(defaultVoice || options[0]?.id || null);
        setBulkTtsSelectedVoiceName((prev) => (options.some((voice) => voice.id === prev) ? prev : defaultVoice));
        setBulkTtsEnabledModels(options.map((voice) => voice.id));
      } catch (err: any) {
        if (!canceled) toast.error(`Failed to load TTS voices: ${err?.message ?? String(err)}`);
      } finally {
        if (!canceled) setBulkTtsLoading(false);
      }
    }
    loadVoice();
    return () => {
      canceled = true;
    };
  }, [bulkAddMissingOpen, bulkActionTab, settingsEpoch]);

  const handleBulkPreviewVoice = useCallback(async () => {
    if (bulkTtsPreviewVoiceLoading || bulkTtsLoading) return;
    if (!bulkTtsSelectedVoiceName && !bulkTtsVoiceName) return;
    setBulkTtsPreviewVoiceLoading(true);
    try {
      const base = (import.meta as any).env?.DEV ? 'http://localhost:8000' : '';
      const sampleText = bulkRandomRows.find((r) => r.sentence.trim())?.sentence.trim() || 'こんにちは';
      const res = await fetch(`${base}/api/tts/voice-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sampleText, voiceName: bulkTtsSelectedVoiceName || bulkTtsVoiceName }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      new Audio(`${base}${data.audioUrl}`).play().catch((err) => {
        console.error('Voice preview play failed', err);
      });
    } catch (err: any) {
      toast.error(`Voice preview failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkTtsPreviewVoiceLoading(false);
    }
  }, [bulkTtsPreviewVoiceLoading, bulkTtsLoading, bulkRandomRows, bulkTtsSelectedVoiceName, bulkTtsVoiceName]);

  const handleBulkPreviewAudio = useCallback(async (noteId: number) => {
    setBulkTtsPreviewAudioLoadingNoteId(noteId);
    try {
      const base = (import.meta as any).env?.DEV ? 'http://localhost:8000' : '';
      const res = await fetch(`${base}/api/tts/preview-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      new Audio(`${base}${data.audioUrl}`).play().catch((err) => {
        console.error('Preview audio play failed', err);
      });
    } catch (err: any) {
      toast.error(`Preview audio failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkTtsPreviewAudioLoadingNoteId(null);
    }
  }, []);

  const bulkShowTargetLangSelect =
    bulkEnhanceAddTranslation || bulkEnhanceAddSentenceTranslation;
  const bulkEnhancementsSelected =
    bulkEnhanceAddTranslation || bulkEnhanceAddAudio || bulkEnhanceAddSentence || bulkEnhanceAddSentenceTranslation || bulkEnhanceAddSentenceAudio;
  const bulkEnhancementsNeedsDeepl =
    bulkEnhanceAddTranslation ||
    (bulkEnhanceAddSentenceTranslation && (bulkEnhanceTargetLang !== 'en-US' || !bulkEnhanceAddSentence));
  const bulkEnhancementsNeedsAzure =
    bulkEnhanceAddAudio || bulkEnhanceAddSentenceAudio;
  const bulkEnhancementsBlocked =
    (bulkEnhancementsNeedsDeepl && !bulkHasDeeplKey) || (bulkEnhancementsNeedsAzure && !bulkHasAzureKey);

  const handleBulkApplyEnhancements = useCallback(async () => {
    if (bulkRunning) return;
    if (!bulkEnhancementsSelected) return;
    if (bulkEnhancementsBlocked) return;

    const ids = bulkVisibleRows.filter((r) => r.include).map((r) => r.noteId);
    if (ids.length === 0) {
      toast.info('No rows included.');
      return;
    }

    setBulkTableOverrideNoteIds([]);
    setBulkPreviewRecentlyUpdatedNoteIds([]);
    setBulkHasPreviewChanges(false);
    bulkSavedFiltersRef.current = [...filters];
    bulkSavedTablePageRef.current = bulkTablePage;
    onFiltersChange?.([]);
    setBulkTablePage(0);

    const glossaryField = mapping?.glossary ?? 'Glossary';
    const canExpressionAudio = !mapping || Boolean(mapping['expression_audio']);

    setBulkRunning(true);
    setBulkRandomTotal(ids.length);
    setBulkRandomDone(0);
    setBulkEnhanceProgress(10);
    try {
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      let done = 0;
      const updatedNoteIds: number[] = [];
      const sentenceToTatoebaAudioCache = new Map<string, string | null>();

      for (const noteId of ids) {
        setBulkActiveNoteId(null);
        const card = noteIdToCard.get(noteId);
        if (!card) {
          skipped += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) => (r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: card not found.' } : r))
          );
          setBulkRandomDone((prev) => prev + 1);
          continue;
        }

        try {
          const currentRow = bulkRandomRows.find((r) => r.noteId === noteId);
          let sentence = String(currentRow?.sentence ?? '').trim();
          let translation = String(currentRow?.translation ?? '').trim();
          let glossary = String(currentRow?.glossary ?? '').trim();
          let hasAudio = Boolean(currentRow?.sentenceHasAudio);
          let expressionHasAudio = Boolean(currentRow?.expressionHasAudio);
          let sentenceAudioFilename = currentRow?.sentenceAudioFilename;
          let expressionAudioFilename = currentRow?.expressionAudioFilename;
          const expressionAudioTagFilename = currentRow?.expressionAudioTagFilename;

          let previewUpdated = false;
          const updatedParts: string[] = [];
          const blockedReasons: string[] = [];

          if (bulkEnhanceAddSentence && !sentence) {
            const isRandom = bulkEnhanceSentenceMode === 'random';
            const sents = await fetchSentencesFor(card.word, 1, 0, { random: isRandom });
            if (!Array.isArray(sents) || sents.length === 0) {
              skipped += 1;
              setBulkRandomRows((prev) =>
                prev.map((r) =>
                  r.noteId === noteId
                    ? { ...r, status: 'skipped', message: 'Skipped: no example sentences found.', noSentencesFound: true }
                    : r
                )
              );
              setBulkRandomDone((prev) => prev + 1);
              continue;
            }

            const pick = sents[0];

            const jp = String(pick?.jp ?? '').trim();
            let en = String(pick?.en ?? '').trim();
            const pickAudioId = String(pick?.audio_id ?? '').trim();
            const pickHasAudio = Boolean(pick?.has_audio) && Boolean(pickAudioId);

            sentence = jp;

            previewUpdated = true;
            updatedParts.push('Sentence');

            if (bulkEnhanceAddSentenceTranslation) {
              if (bulkEnhanceTargetLang === 'en-US' && en) {
                translation = en;
              } else {
                const tRes = await fetch(`/api/notes/${noteId}/translate`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ text: jp, target_lang: bulkEnhanceTargetLang }),
                });
                if (!tRes.ok) throw new Error(await tRes.text());
                const tData = await tRes.json();
                const translated = String(tData.translated_text ?? '').trim();
                if (translated) translation = translated;
              }
              if (translation) updatedParts.push('Translation');
            }

            if (bulkEnhanceAddSentenceAudio && !hasAudio && pickHasAudio) {
              sentenceAudioFilename = `tatoeba_${pickAudioId}.mp3`;
              hasAudio = true;
              previewUpdated = true;
              updatedParts.push('Sentence audio (Tatoeba)');
            }
          }

          if (bulkEnhanceAddSentenceTranslation && !translation && sentence) {
            const tRes = await fetch(`/api/notes/${noteId}/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: sentence, target_lang: bulkEnhanceTargetLang }),
            });
            if (!tRes.ok) throw new Error(await tRes.text());
            const tData = await tRes.json();
            const translated = String(tData.translated_text ?? '').trim();
            if (translated) {
              translation = translated;
              previewUpdated = true;
              updatedParts.push('Translation');
            }
          }

          if (bulkEnhanceAddSentenceAudio && !hasAudio && sentence) {
            const key = sentence;
            const cached = sentenceToTatoebaAudioCache.get(key);
            let audioId: string | null | undefined = cached;

            if (audioId === undefined) {
              try {
                const hits = await fetchSentencesFor(sentence, 10, 0);
                const exact = (hits || []).find(
                  (s) => String(s?.jp ?? '').trim() === sentence && Boolean(s?.has_audio) && Boolean(String(s?.audio_id ?? '').trim())
                );
                audioId = exact ? String(exact.audio_id ?? '').trim() : null;
              } catch {
                audioId = null;
              }
              sentenceToTatoebaAudioCache.set(key, audioId);
            }

            if (audioId) {
              sentenceAudioFilename = `tatoeba_${audioId}.mp3`;
              hasAudio = true;
              previewUpdated = true;
              updatedParts.push('Sentence audio (Tatoeba)');
            }
          }

          if (bulkEnhanceAddSentenceAudio && bulkHasAzureKey && !hasAudio && sentence) {
            const tts = await fetch(`/api/tts/generate-text-audio-batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [{ rowId: noteId, text: sentence }],
                voiceName: bulkEnhanceSentenceAudioVoiceName,
              }),
            });
            if (!tts.ok) throw new Error(await tts.text());
            const ttsData = await tts.json();
            const results = Array.isArray(ttsData?.results) ? ttsData.results : [];
            const hit = results.find((r: any) => Number(r?.rowId) === noteId);
            const filename = String(hit?.filename ?? '').trim();
            if (filename) {
              sentenceAudioFilename = filename;
              hasAudio = true;
              previewUpdated = true;
              updatedParts.push(
                `Sentence audio (${getTtsVoiceLabel(bulkEnhanceSentenceAudioVoiceName, bulkTtsVoiceOptions)})`
              );
            }
          }

          const cleanedGlossary = String(glossary ?? '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/&nbsp;/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/\[sound:[^\]]+\]/g, '')
            .trim();
          if (bulkEnhanceAddTranslation && String(card.word || '').trim() && !cleanedGlossary) {
            const res = await fetch(`/api/notes/${noteId}/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: String(card.word || '').trim(), target_lang: bulkEnhanceTargetLang }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const translated = String(data.translated_text ?? '').trim();
            if (!translated) throw new Error('No translated text returned');

            glossary = translated;
            previewUpdated = true;
            updatedParts.push(`Glossary (${bulkEnhanceTargetLang})`);
          }

          const currentExpressionFilename = String(expressionAudioFilename ?? expressionAudioTagFilename ?? '').trim();
          const expressionAudioBroken = Boolean(
            currentExpressionFilename && bulkFailedAudioFilenames.has(currentExpressionFilename)
          );
          if (
            bulkEnhanceAddAudio &&
            canExpressionAudio &&
            String(card.word || '').trim() &&
            (!expressionHasAudio || expressionAudioBroken)
          ) {
            const res = await fetch(`/api/tts/generate-text-audio-batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [{ rowId: noteId, text: String(card.word || '').trim() }],
                voiceName: bulkEnhanceSentenceAudioVoiceName,
              }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const results = Array.isArray(data?.results) ? data.results : [];
            const hit = results.find((r: any) => Number(r?.rowId) === noteId);
            const filename = String(hit?.filename ?? '').trim();
            if (filename) {
              expressionAudioFilename = filename;
              previewUpdated = true;
              expressionHasAudio = true;
              updatedParts.push('Expression audio');
            }
          }

          if (bulkEnhanceAddSentenceTranslation && !translation && !sentence) {
            blockedReasons.push('Sentence translation requires Sentence');
          }
          if (bulkEnhanceAddSentenceAudio && !hasAudio && !sentence) {
            blockedReasons.push('Sentence audio requires Sentence');
          }

          if (previewUpdated) {
            updated += 1;
            updatedNoteIds.push(noteId);
            setBulkTableOverrideNoteIds((prev) => {
              const base = Array.isArray(prev) ? prev : [];
              if (base.includes(noteId)) return prev;
              return [...base, noteId];
            });
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId
                  ? {
                      ...r,
                      sentence,
                      translation,
                      glossary,
                      sentenceHasAudio: hasAudio,
                      sentenceAudioFilename,
                      expressionHasAudio,
                      expressionAudioFilename,
                      noSentencesFound: false,
                      status: 'updated',
                      message: updatedParts.length ? `Updated: ${updatedParts.join(', ')}` : 'Updated',
                    }
                  : r
              )
            );
          } else {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId
                  ? {
                      ...r,
                      status: 'skipped',
                      message: blockedReasons.length
                        ? `Skipped: ${blockedReasons.join(' • ')}`
                        : 'Skipped: no changes needed.',
                    }
                  : r
              )
            );
          }
        } catch (err: any) {
          failed += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) => (r.noteId === noteId ? { ...r, status: 'failed', message: err?.message ?? String(err) } : r))
          );
        } finally {
          done += 1;
          setBulkRandomDone((prev) => prev + 1);
          setBulkEnhanceProgress(Math.round((done / Math.max(1, ids.length)) * 100));
        }
      }

      toast.success(`Preview: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
      setBulkPreviewRecentlyUpdatedNoteIds(updatedNoteIds);
      setBulkHasPreviewChanges(updatedNoteIds.length > 0);
      setBulkEnhanceConfirmOpen(false);
    } catch (err: any) {
      toast.error(`Bulk enhancements failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkTableOverrideNoteIds(null);
      const savedFilters = bulkSavedFiltersRef.current;
      const savedPage = bulkSavedTablePageRef.current;
      if (savedFilters && onFiltersChange) {
        bulkSkipNextTablePageResetRef.current = true;
        onFiltersChange(savedFilters);
        setBulkTablePage(savedPage);
      }
      setBulkRunning(false);
      setBulkActiveNoteId(null);
      setBulkEnhanceProgress(0);
    }
  }, [
    bulkRunning,
    bulkEnhancementsSelected,
    bulkEnhancementsBlocked,
    bulkVisibleRows,
    bulkRandomRows,
    filters,
    bulkTablePage,
    onFiltersChange,
    mapping,
    noteIdToCard,
    bulkEnhanceAddSentence,
    bulkEnhanceAddSentenceTranslation,
    bulkEnhanceAddSentenceAudio,
    bulkEnhanceSentenceMode,
    bulkEnhanceAddTranslation,
    bulkEnhanceAddAudio,
    bulkEnhanceTargetLang,
    bulkEnhanceSentenceAudioVoiceName,
    bulkHasDeeplKey,
    bulkHasAzureKey,
    bulkFailedAudioFilenames,
    setBulkHasPreviewChanges,
  ]);

  const handleBulkWriteToAnki = useCallback(async () => {
    if (bulkRunning) return;

    const ids = bulkVisibleRows.filter((r) => r.include).map((r) => r.noteId);
    if (ids.length === 0) return;

    const sentenceField = mapping?.sentence ?? 'Sentence';
    const translationField = mapping?.translation ?? 'SentenceTranslation';
    const glossaryField = mapping?.glossary ?? 'Glossary';
    const sentenceAudioField = mapping?.sentence_audio ?? 'SentenceAudio';
    const expressionAudioField = mapping?.expression_audio ?? 'Audio';

    setBulkRunning(true);
    try {
      setBulkRandomTotal(ids.length);
      setBulkRandomDone(0);
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const updatedIds: number[] = [];
      const updatedChanges: Record<number, { entry: boolean; glossary: boolean; sentence: boolean; translation: boolean }> = {};

      for (const noteId of ids) {
        setBulkActiveNoteId(noteId);
        const card = noteIdToCard.get(noteId);
        const row = bulkRandomRows.find((r) => r.noteId === noteId);
        if (!card || !row) {
          skipped += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) => (r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: card not found.' } : r))
          );
          setBulkRandomDone((prev) => prev + 1);
          continue;
        }

        try {
          const currentSentence = cleanSentenceFieldText(card.fields.find((f) => f.label === sentenceField)?.value ?? '');
          const currentTranslation = cleanSentenceFieldText(card.fields.find((f) => f.label === translationField)?.value ?? '');
          const currentGlossary = String(card.fields.find((f) => f.label === glossaryField)?.value ?? '').trim();
          const currentSentenceAudio = String(card.fields.find((f) => f.label === sentenceAudioField)?.value ?? '');
          const currentExpressionAudio =
            String(card.fields.find((f) => f.label === expressionAudioField)?.value ?? '') ||
            String(card.fields.find((f) => /^(Word)?Audio$/i.test(f.label))?.value ?? '');
          const currentExpressionFilename =
            currentExpressionAudio.match(/\[sound:([^\]]+)\]/)?.[1]?.trim() ?? '';
          const currentExpressionBroken = Boolean(
            currentExpressionFilename && bulkFailedAudioFilenames.has(currentExpressionFilename)
          );

          const payload: Record<string, any> = {};
          if (String(row.sentence || '').trim() !== currentSentence) payload.jp = String(row.sentence || '').trim();
          if (String(row.translation || '').trim() !== currentTranslation) payload.en = String(row.translation || '').trim();
          if (String(row.glossary || '').trim() !== currentGlossary) payload.glossary = String(row.glossary || '').trim();

          if (row.sentenceAudioFilename) {
            const has = /\[sound:.*?\]/.test(currentSentenceAudio);
            if (!has) payload.sentence_audio = row.sentenceAudioFilename;
          }
          if (row.expressionAudioFilename) {
            const has = /\[sound:.*?\]/.test(currentExpressionAudio);
            if (!has || currentExpressionBroken) payload.expression_audio = row.expressionAudioFilename;
          }

          if (Object.keys(payload).length === 0) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) => (r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: no changes needed.' } : r))
            );
            setBulkRandomDone((prev) => prev + 1);
            continue;
          }

          const cellChanges = {
            entry: Boolean(payload.expression_audio),
            glossary: Boolean(payload.glossary),
            sentence: Boolean(payload.jp || payload.sentence_audio),
            translation: Boolean(payload.en),
          };

          const upd = await fetch(`/api/notes/${noteId}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!upd.ok) throw new Error(await upd.text());

          updated += 1;
          updatedIds.push(noteId);
          updatedChanges[noteId] = cellChanges;

          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId
                ? {
                    ...r,
                    sentenceAudioFilename: undefined,
                    expressionAudioFilename: undefined,
                    status: 'updated',
                    message: t("Saved."),
                  }
                : r
            )
          );
        } catch (err: any) {
          failed += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) => (r.noteId === noteId ? { ...r, status: 'failed', message: err?.message ?? String(err) } : r))
          );
        } finally {
          setBulkRandomDone((prev) => prev + 1);
        }
      }

      await refreshCards();
      onFiltersChange?.([]);
      setBulkSelectAllFiltered(false);
      setBulkLastUpdatedNoteIds(updatedIds);
      setBulkLastUpdatedLabel(t("bulkActions.writeToAnki"));
      setBulkRecentlyWrittenNoteIds(updatedIds);
      setBulkRecentlyWrittenChanges(updatedChanges);
      setBulkHasPreviewChanges(false);

      toast.success(`Bulk: ${updated} saved, ${skipped} skipped, ${failed} failed.`);
    } catch (err: any) {
      toast.error(`Bulk write failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkRunning(false);
      setBulkActiveNoteId(null);
      setBulkWriteConfirmOpen(false);
    }
  }, [bulkRunning, bulkVisibleRows, mapping, noteIdToCard, bulkRandomRows, refreshCards, onFiltersChange, t, bulkFailedAudioFilenames]);

  useEffect(() => {
    if (bulkRecentlyWrittenNoteIds.length === 0) return;
    const t = window.setTimeout(() => {
      setBulkRecentlyWrittenNoteIds([]);
      setBulkRecentlyWrittenChanges({});
    }, 1600);
    return () => window.clearTimeout(t);
  }, [bulkRecentlyWrittenNoteIds]);

  useEffect(() => {
    if (bulkPreviewRecentlyUpdatedNoteIds.length === 0) return;
    const t = window.setTimeout(() => {
      setBulkPreviewRecentlyUpdatedNoteIds([]);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [bulkPreviewRecentlyUpdatedNoteIds]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    if (bulkTtsEnabledModels.length === 0) return;
    setBulkRandomRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (!r.ttsModel || !bulkTtsEnabledModels.includes(r.ttsModel)) {
          changed = true;
          return { ...r, ttsModel: bulkTtsEnabledModels[0] };
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [bulkAddMissingOpen, bulkTtsEnabledModels]);

  useEffect(() => {
    if (bulkTtsVoiceOptions.length > 0) return;
    setBulkEnhanceAddSentenceAudio(false);
  }, [bulkTtsVoiceOptions]);

  const handleBulkAddTts = useCallback(async () => {
    if (bulkRunning) return;
    const ids = bulkVisibleRows.filter((r) => r.include).map((r) => r.noteId);
    if (ids.length === 0) return;

    const canExpressionAudio = !mapping || Boolean(mapping['expression_audio']);
    const hasWork = bulkVisibleRows.some((r) => {
      if (!r.include) return false;
      const needsSentence = r.sentence.trim() && !r.sentenceHasAudio;
      const needsExpression =
        canExpressionAudio && bulkTtsIncludeExpressionAudio && r.expression.trim() && !r.expressionHasAudio;
      return needsSentence || needsExpression;
    });
    if (!hasWork) {
      toast.info('No missing audio found in the selection.');
      return;
    }
    setBulkRunning(true);
    try {
      setBulkRandomTotal(ids.length);
      setBulkRandomDone(0);
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const updatedIds: number[] = [];

      for (const noteId of ids) {
        setBulkActiveNoteId(noteId);
        const entry = bulkRandomRows.find((r) => r.noteId === noteId);
        try {
          if (!entry) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId ? { ...r, status: 'skipped', message: 'Card not found in current page.' } : r
              )
            );
            continue;
          }

          const needsSentence = entry.sentence.trim() && !entry.sentenceHasAudio;
          const needsExpression =
            canExpressionAudio && bulkTtsIncludeExpressionAudio && entry.expression.trim() && !entry.expressionHasAudio;
          if (!needsSentence && !needsExpression) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: already has audio.' } : r
              )
            );
            continue;
          }

          const res = await fetch(`/api/tts/generate-note-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              noteId,
              voiceName: entry.ttsModel || bulkTtsSelectedVoiceName || bulkTtsVoiceName || undefined,
              generateSentenceAudio: needsSentence,
              generateExpressionAudio: needsExpression,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          const updatedFields: string[] = Array.isArray(data.updatedFields) ? data.updatedFields : [];
          if (updatedFields.length > 0) {
            updated += 1;
            updatedIds.push(noteId);
          } else {
            skipped += 1;
          }
          const modelLabel = getTtsVoiceLabel(entry.ttsModel, bulkTtsVoiceOptions);
          const parts: string[] = [];
          if (data.sentenceFilename || data.filename || data.alreadyHadSentenceAudio) parts.push('Sentence audio');
          if (data.expressionFilename || data.alreadyHadExpressionAudio) parts.push('Expression audio');
          const label = parts.length ? parts.join(', ') : 'Audio';
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId
                ? {
                    ...r,
                    sentenceHasAudio: r.sentenceHasAudio || Boolean(data.sentenceFilename || data.filename || data.alreadyHadSentenceAudio),
                    expressionHasAudio: r.expressionHasAudio || Boolean(data.expressionFilename || data.alreadyHadExpressionAudio),
                    status: updatedFields.length > 0 ? 'updated' : 'skipped',
                    message: updatedFields.length > 0 ? `Updated: ${label} (${modelLabel})` : 'Skipped: already has audio.',
                  }
                : r
            )
          );
        } catch (err: any) {
          failed += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId ? { ...r, status: 'failed', message: err?.message ?? String(err) } : r
            )
          );
        } finally {
          setBulkRandomDone((prev) => prev + 1);
        }
      }
      await refreshCards();
      toast.success(`TTS: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
      setBulkLastUpdatedNoteIds(updatedIds);
      setBulkLastUpdatedLabel('TTS');
    } catch (err: any) {
      toast.error(`Bulk add failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkRunning(false);
      setBulkActiveNoteId(null);
    }
  }, [bulkRunning, bulkRandomRows, bulkVisibleRows, bulkTtsSelectedVoiceName, refreshCards, bulkTtsIncludeExpressionAudio, mapping]);

  const handleBulkAddRandomSentences = useCallback(async () => {
    if (bulkRunning) return;
    if (bulkSelectedNoteIds.size === 0) return;

    setBulkRunning(true);
    try {
      const sentenceField = mapping?.sentence ?? 'Sentence';
      const translationField = mapping?.translation ?? 'SentenceTranslation';

      const ids = bulkVisibleRows.filter((r) => r.include).map((r) => r.noteId);
      setBulkRandomTotal(ids.length);
      setBulkRandomDone(0);
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const updatedIds: number[] = [];
      for (const noteId of ids) {
        setBulkActiveNoteId(noteId);
        const card = noteIdToCard.get(noteId);
        try {
          if (!card) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId
                  ? { ...r, status: 'skipped', message: 'Skipped: card not found in current page.' }
                  : r
              )
            );
            continue;
          }

          const existingSentence = cleanSentenceFieldText(card.fields.find((f) => f.label === sentenceField)?.value ?? '');
          if (String(existingSentence).trim()) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: already has a sentence.' } : r
              )
            );
            continue;
          }

          const sents = await fetchSentencesFor(card.word, 10, 0);
          if (!Array.isArray(sents) || sents.length === 0) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId
                  ? { ...r, status: 'skipped', message: 'Skipped: no example sentences found.', noSentencesFound: true }
                  : r
              )
            );
            continue;
          }
          const pick = sents[Math.floor(Math.random() * sents.length)];

          const jp = String(pick.jp ?? '').trim();
          let en = String(pick.en ?? '').trim();
          const audioId = pick.audio_id != null ? String(pick.audio_id) : undefined;
          let usedTranslationService = false;

          if (!en && bulkUseTranslationService) {
            const tRes = await fetch(`/api/notes/${noteId}/translate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: jp, target_lang: bulkEnhanceTargetLang }),
            });
            if (!tRes.ok) throw new Error(await tRes.text());
            const tData = await tRes.json();
            en = String(tData.translated_text ?? '').trim();
            usedTranslationService = Boolean(en);
          }

          const res = await fetch(`/api/notes/${noteId}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jp, en: en || undefined, sentence_audio: audioId }),
          });
          if (!res.ok) throw new Error(await res.text());
          updated += 1;
          updatedIds.push(noteId);
          const updatedFields: string[] = ['Sentence'];
          if (en) updatedFields.push(usedTranslationService ? `Translation (${translationServiceName})` : 'Translation');
          if (audioId) updatedFields.push('Audio');
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId
                ? {
                    ...r,
                    sentence: jp,
                    translation: en,
                      noSentencesFound: false,
                    sentenceHasAudio: Boolean(audioId),
                    status: 'updated',
                    message: `Updated: ${updatedFields.join(', ')}`,
                  }
                : r
            )
          );
        } catch (err: any) {
          failed += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId
                ? { ...r, status: 'failed', message: err?.message ?? String(err) }
                : r
            )
          );
        } finally {
          setBulkRandomDone((prev) => prev + 1);
        }
      }

      await refreshCards();
      toast.success(`Random sentences: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
      setBulkLastUpdatedNoteIds(updatedIds);
      setBulkLastUpdatedLabel('Random sentences');
    } catch (err: any) {
      toast.error(`Bulk add failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkRunning(false);
      setBulkActiveNoteId(null);
    }
  }, [bulkRunning, bulkSelectedNoteIds, bulkRandomRows, bulkVisibleRows, noteIdToCard, mapping, refreshCards, bulkUseTranslationService, translationServiceName, bulkEnhanceTargetLang]);

  const handleBulkAddTranslations = useCallback(async () => {
    if (bulkRunning) return;
    if (bulkSelectedNoteIds.size === 0) return;

    setBulkRunning(true);
    try {
      const sentenceField = mapping?.sentence ?? 'Sentence';
      const translationField = mapping?.translation ?? 'SentenceTranslation';

      const ids = bulkVisibleRows.filter((r) => r.include).map((r) => r.noteId);
      setBulkRandomTotal(ids.length);
      setBulkRandomDone(0);
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const updatedIds: number[] = [];
      for (const noteId of ids) {
        setBulkActiveNoteId(noteId);
        const card = noteIdToCard.get(noteId);
        if (!card) {
          skipped += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: card not found in current page.' } : r
            )
          );
          setBulkRandomDone((prev) => prev + 1);
          continue;
        }

        try {
          const sentence = cleanSentenceFieldText(card.fields.find((f) => f.label === sentenceField)?.value ?? '');
          const existingTranslation = cleanSentenceFieldText(card.fields.find((f) => f.label === translationField)?.value ?? '');
          if (!sentence) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) => (r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: no sentence text.' } : r))
            );
            continue;
          }
          if (existingTranslation) {
            skipped += 1;
            setBulkRandomRows((prev) =>
              prev.map((r) =>
                r.noteId === noteId ? { ...r, status: 'skipped', message: 'Skipped: already has a translation.' } : r
              )
            );
            continue;
          }

          const res = await fetch(`/api/notes/${noteId}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: sentence, target_lang: bulkEnhanceTargetLang }),
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          const translated = String(data.translated_text ?? '').trim();
          if (!translated) throw new Error('No translated text returned');

          const upd = await fetch(`/api/notes/${noteId}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jp: sentence, en: translated }),
          });
          if (!upd.ok) throw new Error(await upd.text());
          updated += 1;
          updatedIds.push(noteId);
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId
                ? { ...r, translation: translated, status: 'updated', message: `Updated: Translation (${translationServiceName})` }
                : r
            )
          );
        } catch (err: any) {
          failed += 1;
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId ? { ...r, status: 'failed', message: err?.message ?? String(err) } : r
            )
          );
        } finally {
          setBulkRandomDone((prev) => prev + 1);
        }
      }

      await refreshCards();
      toast.success(`Translations: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
      setBulkLastUpdatedNoteIds(updatedIds);
      setBulkLastUpdatedLabel('Translations');
    } catch (err: any) {
      toast.error(`Bulk translate failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkRunning(false);
      setBulkActiveNoteId(null);
    }
  }, [bulkRunning, bulkSelectedNoteIds, bulkRandomRows, bulkVisibleRows, noteIdToCard, mapping, refreshCards, translationServiceName, bulkEnhanceTargetLang]);

  const getSelectionKey = useCallback((word: string, index: number, noteId?: number) => {
    if (noteId != null) return `nid-${noteId}`;
    return `w-${word}-${index}`;
  }, []);

  const gridItemElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const gridDragStateRef = useRef<null | {
    pointerId: number;
    startPageX: number;
    startPageY: number;
    ctrl: boolean;
    moved: boolean;
    startedOnItem: boolean;
    pointerCaptured: boolean;
  }>(null);
  const gridDragLatestRef = useRef<null | { pageX: number; pageY: number }>(null);
  const gridDragRafRef = useRef<number | null>(null);
  const gridDragRectsRef = useRef<
    Array<{ key: string; noteId?: number; rect: { left: number; top: number; right: number; bottom: number } }>
  >([]);
  const gridDragBaseSelectionRef = useRef<null | { keys: Set<string>; noteIds: Set<number> }>(null);
  const [gridDragBox, setGridDragBox] = useState<null | { left: number; top: number; width: number; height: number }>(null);
  const gridDragContainerRef = useRef<HTMLDivElement | null>(null);
  const suppressNextGridClickRef = useRef(false);
  const gridDragPrevUserSelectRef = useRef<string | null>(null);
  const gridDragScrollHandlerRef = useRef<null | (() => void)>(null);

  const parseNoteIdFromSelectionKey = useCallback((key: string) => {
    if (!key.startsWith('nid-')) return undefined;
    const n = Number(key.slice(4));
    return Number.isFinite(n) ? n : undefined;
  }, []);

  const shouldStartGridDragSelect = useCallback((target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return true;
    if (el.closest('[data-grid-item="true"]')) return true;
    if (el.closest('input,textarea,select,option,a,[role="button"],[data-no-drag-select="true"]')) return false;
    return true;
  }, []);

  const scheduleGridDragUpdate = useCallback(() => {
    if (gridDragRafRef.current != null) return;
    gridDragRafRef.current = window.requestAnimationFrame(() => {
      gridDragRafRef.current = null;
      const st = gridDragStateRef.current;
      const latest = gridDragLatestRef.current;
      const container = gridDragContainerRef.current;
      const baseSel = gridDragBaseSelectionRef.current;
      if (!st || !latest || !container || !baseSel) return;

      const dx = latest.pageX - st.startPageX;
      const dy = latest.pageY - st.startPageY;
      if (!st.moved) {
        if (dx * dx + dy * dy < 16) return;
        st.moved = true;
      }

      const leftV = Math.min(st.startPageX, latest.pageX);
      const topV = Math.min(st.startPageY, latest.pageY);
      const rightV = Math.max(st.startPageX, latest.pageX);
      const bottomV = Math.max(st.startPageY, latest.pageY);

      const containerRect = container.getBoundingClientRect();
      const containerPageLeft = containerRect.left + window.scrollX;
      const containerPageTop = containerRect.top + window.scrollY;
      setGridDragBox({
        left: leftV - containerPageLeft,
        top: topV - containerPageTop,
        width: rightV - leftV,
        height: bottomV - topV,
      });

      const hits: Array<{ key: string; noteId?: number }> = [];
      for (const item of gridDragRectsRef.current) {
        const r = item.rect;
        if (r.right < leftV || r.left > rightV || r.bottom < topV || r.top > bottomV) continue;
        hits.push({ key: item.key, noteId: item.noteId });
      }

      if (st.ctrl) {
        const nextKeys = new Set(baseSel.keys);
        const nextIds = new Set(baseSel.noteIds);
        for (const h of hits) {
          if (nextKeys.has(h.key)) nextKeys.delete(h.key);
          else nextKeys.add(h.key);
          if (h.noteId != null) {
            if (nextIds.has(h.noteId)) nextIds.delete(h.noteId);
            else nextIds.add(h.noteId);
          }
        }
        setBulkSelectedKeys(nextKeys);
        setBulkSelectedNoteIds(nextIds);
      } else {
        const nextKeys = new Set<string>();
        const nextIds = new Set<number>();
        for (const h of hits) {
          nextKeys.add(h.key);
          if (h.noteId != null) nextIds.add(h.noteId);
        }
        setBulkSelectedKeys(nextKeys);
        setBulkSelectedNoteIds(nextIds);
      }
    });
  }, []);

  const handleGridPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!shouldStartGridDragSelect(e.target)) return;
    e.preventDefault();
    const container = e.currentTarget;
    gridDragContainerRef.current = container;
    const startedOnItem = Boolean((e.target as HTMLElement | null)?.closest?.('[data-grid-item="true"]'));
    const startPageX = e.clientX + window.scrollX;
    const startPageY = e.clientY + window.scrollY;

    gridDragStateRef.current = {
      pointerId: e.pointerId,
      startPageX,
      startPageY,
      ctrl: e.ctrlKey || e.metaKey,
      moved: false,
      startedOnItem,
      pointerCaptured: false,
    };
    gridDragLatestRef.current = { pageX: startPageX, pageY: startPageY };
    gridDragBaseSelectionRef.current = { keys: new Set(bulkSelectedKeys), noteIds: new Set(bulkSelectedNoteIds) };

    const rects: Array<{ key: string; noteId?: number; rect: { left: number; top: number; right: number; bottom: number } }> = [];
    let cached = false;
    const baseScrollX = window.scrollX;
    const baseScrollY = window.scrollY;
    for (const [key, el] of gridItemElsRef.current.entries()) {
      if (!el.isConnected) continue;
      const nid = parseNoteIdFromSelectionKey(key);
      const r = el.getBoundingClientRect();
      rects.push({
        key,
        noteId: nid,
        rect: { left: r.left + baseScrollX, top: r.top + baseScrollY, right: r.right + baseScrollX, bottom: r.bottom + baseScrollY },
      });
      if (nid != null) {
        const card = cards.find((c) => c.noteId === nid);
        if (card && !bulkCardCacheRef.current.has(nid)) {
          bulkCardCacheRef.current.set(nid, card);
          cached = true;
        }
      }
    }
    gridDragRectsRef.current = rects;
    if (cached) setBulkCardCacheEpoch((v) => v + 1);

    if (gridDragPrevUserSelectRef.current == null) {
      gridDragPrevUserSelectRef.current = document.body.style.userSelect || '';
      document.body.style.userSelect = 'none';
    }
    if (!gridDragScrollHandlerRef.current) {
      const onScroll = () => scheduleGridDragUpdate();
      gridDragScrollHandlerRef.current = onScroll;
      window.addEventListener('scroll', onScroll, true);
    }
  }, [bulkSelectedKeys, bulkSelectedNoteIds, parseNoteIdFromSelectionKey, shouldStartGridDragSelect, cards]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const st = gridDragStateRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    e.preventDefault();
    if (!st.pointerCaptured) {
      const dx = e.clientX + window.scrollX - st.startPageX;
      const dy = e.clientY + window.scrollY - st.startPageY;
      if (dx * dx + dy * dy >= 16) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
          st.pointerCaptured = true;
        } catch {
          // ignore
        }
      }
    }
    gridDragLatestRef.current = { pageX: e.clientX + window.scrollX, pageY: e.clientY + window.scrollY };
    scheduleGridDragUpdate();
  }, [scheduleGridDragUpdate]);

  const endGridDrag = useCallback((pointerId: number) => {
    const st = gridDragStateRef.current;
    if (!st || st.pointerId !== pointerId) return;
    if (st.moved) {
      suppressNextGridClickRef.current = true;
      window.setTimeout(() => {
        suppressNextGridClickRef.current = false;
      }, 0);
    }
    if (!st.moved && !st.startedOnItem && !st.ctrl) {
      clearBulkSelection();
    }
    if (st.pointerCaptured) {
      try {
        gridDragContainerRef.current?.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
    }
    gridDragStateRef.current = null;
    gridDragLatestRef.current = null;
    gridDragRectsRef.current = [];
    gridDragBaseSelectionRef.current = null;
    setGridDragBox(null);
    if (gridDragScrollHandlerRef.current) {
      window.removeEventListener('scroll', gridDragScrollHandlerRef.current, true);
      gridDragScrollHandlerRef.current = null;
    }
    if (gridDragPrevUserSelectRef.current != null) {
      document.body.style.userSelect = gridDragPrevUserSelectRef.current;
      gridDragPrevUserSelectRef.current = null;
    }
    if (gridDragRafRef.current != null) {
      cancelAnimationFrame(gridDragRafRef.current);
      gridDragRafRef.current = null;
    }
  }, [clearBulkSelection]);

  const handleGridPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    endGridDrag(e.pointerId);
  }, [endGridDrag]);

  const handleGridPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    endGridDrag(e.pointerId);
  }, [endGridDrag]);

  const loadBulkDeckPage = useCallback(async (opts?: { reset?: boolean }) => {
    if (!deckName) return;
    if (bulkDeckLoading) return;

    const reset = Boolean(opts?.reset);
    if (reset) {
      setBulkSelectedKeys(new Set());
      setBulkSelectedNoteIds(new Set());
      bulkCardCacheRef.current = new Map();
      setBulkCardCacheEpoch((v) => v + 1);
      setBulkDeckLoaded(0);
      setBulkDeckTotal(null);
      setBulkDeckOffset(0);
      setBulkTablePage(0);
      setBulkSelectAllFiltered(false);
      setBulkRandomRows([]);
      setBulkRandomTotal(0);
      setBulkRandomDone(0);
    }

    const offset = reset ? 0 : bulkDeckOffset;
    if (!reset && bulkDeckTotal != null && offset >= bulkDeckTotal) return;

    setBulkDeckLoading(true);
    try {
      const url = `/api/notes?deck=${encodeURIComponent(deckName)}&limit=${BULK_DECK_FETCH_LIMIT}&offset=${offset}&sort=${sort}&filters=`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const total = Number(data.total ?? 0) || 0;
      const pageNotes: any[] = Array.isArray(data.notes) ? data.notes : [];
      const activeMapping: Record<string, string> = data.mapping || mapping || {};

      if (reset) setBulkDeckTotal(total);
      else if (bulkDeckTotal == null) setBulkDeckTotal(total);

      const addedIds: number[] = [];
      for (const note of pageNotes) {
        const noteId = note?.noteId ?? note?.id;
        if (noteId == null) continue;
        const nid = Number(noteId);
        if (!Number.isFinite(nid)) continue;

        const fields: { label: string; value: string }[] = Object.entries(note.fields ?? {}).map(([label, v]: any) => ({
          label,
          value: (v && (v.value ?? v)) || '',
        }));

        const expressionField = activeMapping.expression;
        let expr = '';
        if (expressionField) {
          expr = fields.find((f) => f.label === expressionField)?.value ?? '';
        } else {
          expr = fields.find((f) => /Expression|Word|Kanji/i.test(f.label))?.value ?? fields[0]?.value ?? '';
        }

        bulkCardCacheRef.current.set(nid, { word: expr, fields, examples: [], noteId: nid });
        addedIds.push(nid);
      }

      if (addedIds.length > 0) setBulkCardCacheEpoch((v) => v + 1);

      const sentenceField = mapping?.sentence ?? 'Sentence';
      const translationField = mapping?.translation ?? 'SentenceTranslation';
      const glossaryField = mapping?.glossary ?? 'Glossary';
      const sentenceAudioField = mapping?.sentence_audio ?? 'SentenceAudio';
      const expressionAudioField = mapping?.expression_audio ?? 'Audio';

      const newRows = addedIds.map((noteId) => {
        const card = bulkCardCacheRef.current.get(noteId);
        const expression = String(card?.word ?? '').trim();

        const sentence = cleanSentenceFieldText(card?.fields.find((f) => f.label === sentenceField)?.value ?? '');
        const translation = cleanSentenceFieldText(card?.fields.find((f) => f.label === translationField)?.value ?? '');
        const glossary = String(card?.fields.find((f) => f.label === glossaryField)?.value ?? '').trim();

        const sentenceAudioVal = String(card?.fields.find((f) => f.label === sentenceAudioField)?.value ?? '');
        const sentenceHasAudio = /\[sound:.*?\]/.test(sentenceAudioVal);

        const expressionAudioVal =
          String(card?.fields.find((f) => f.label === expressionAudioField)?.value ?? '') ||
          String(card?.fields.find((f) => /^(Word)?Audio$/i.test(f.label))?.value ?? '');
        const expressionHasAudio = /\[sound:.*?\]/.test(expressionAudioVal);

        const missing: string[] = [];
        if (!sentence) missing.push('Sentence');
        if (!glossary) missing.push('Glossary');
        if (!translation) missing.push('Translation');
        if (!sentenceHasAudio) missing.push('Audio');

        const status: 'missing' | 'skipped' = missing.length > 0 ? 'missing' : 'skipped';
        const message = missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'No missing fields.';
        const include = bulkSelectAllFiltered ? true : missing.length > 0;

        return {
          noteId,
          expression,
          glossary,
          expressionHasAudio,
          expressionAudioFilename: undefined,
          sentence,
          sentenceHasAudio,
          sentenceAudioFilename: undefined,
          translation,
          ttsModel: bulkTtsEnabledModels[0] || '',
          include,
          status,
          message,
        };
      });

      setBulkRandomRows((prev) => {
        if (reset) return newRows;
        const existing = new Set(prev.map((r) => r.noteId));
        const appended = newRows.filter((r) => !existing.has(r.noteId));
        return appended.length > 0 ? [...prev, ...appended] : prev;
      });
      setBulkRandomTotal((prev) => (reset ? newRows.length : prev + newRows.length));

      setBulkSelectedKeys((prev) => {
        const next = reset ? new Set<string>() : new Set(prev);
        for (const nid of addedIds) next.add(`nid-${nid}`);
        return next;
      });

      setBulkSelectedNoteIds((prev) => {
        const next = reset ? new Set<number>() : new Set(prev);
        for (const nid of addedIds) next.add(nid);
        return next;
      });

      setBulkDeckLoaded((prev) => (reset ? addedIds.length : prev + addedIds.length));
      setBulkDeckOffset(offset + pageNotes.length);
    } catch (err: any) {
      toast.error(t("errors.saveFailed", { message: err?.message ?? String(err) }));
    } finally {
      setBulkDeckLoading(false);
    }
  }, [
    deckName,
    bulkDeckLoading,
    bulkDeckOffset,
    bulkDeckTotal,
    sort,
    mapping,
    t,
    bulkSelectAllFiltered,
    bulkTtsEnabledModels,
  ]);

  const selectAllDisplayed = useCallback(() => {
    setBulkSelectionIsDeckAll(false);
    const nextKeys = new Set(bulkSelectedKeys);
    const nextIds = new Set(bulkSelectedNoteIds);
    displayCards.forEach((w, i) => {
      const nid = cardByWord.get(w)?.noteId;
      const k = getSelectionKey(w, i, nid);
      nextKeys.add(k);
      if (nid != null) nextIds.add(nid);
    });
    setBulkSelectedKeys(nextKeys);
    setBulkSelectedNoteIds(nextIds);
  }, [bulkSelectedKeys, bulkSelectedNoteIds, displayCards, cardByWord, getSelectionKey]);

  const selectAllDeckIds = useCallback(async () => {
    if (!deckName) return;
    if (bulkSelectAllDeckLoading) return;
    setBulkSelectAllDeckLoading(true);
    setBulkSelectionIsDeckAll(true);
    try {
      const limit = 1000;
      let offset = 0;
      let total = Infinity;
      const nextIds = new Set<number>();
      const nextKeys = new Set<string>();

      while (offset < total) {
        const url = `/api/note-ids?deck=${encodeURIComponent(deckName)}&limit=${limit}&offset=${offset}&sort=${sort}&filters=`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        total = Number(data.total ?? 0);
        const noteIds: any[] = Array.isArray(data.noteIds) ? data.noteIds : [];
        for (const id of noteIds) {
          const nid = Number(id);
          if (!Number.isFinite(nid)) continue;
          nextIds.add(nid);
          nextKeys.add(`nid-${nid}`);
        }
        if (noteIds.length === 0) break;
        offset += noteIds.length;
      }

      setBulkSelectedKeys(nextKeys);
      setBulkSelectedNoteIds(nextIds);
      toast.success(t("bulkActions.toasts.selectedNotes", { n: nextIds.size }));
    } catch (err: any) {
      setBulkSelectionIsDeckAll(false);
      toast.error(t("bulkActions.toasts.selectAllFailed", { message: err?.message ?? String(err) }));
    } finally {
      setBulkSelectAllDeckLoading(false);
    }
  }, [deckName, bulkSelectAllDeckLoading, sort, t]);

  const handleOpenBulkActionsForDeck = useCallback(async () => {
    if (!deckName) return;
    setBulkDeckMode(true);
    setBulkAddMissingOpen(true);
    setBulkActionsOpen(false);
    void loadBulkDeckPage({ reset: true });
  }, [deckName, loadBulkDeckPage]);

  const handleOpenBulkActions = useCallback(async () => {
    if (bulkMode && bulkSelectedNoteIds.size > 0) {
      if (bulkSelectionIsDeckAll) {
        await handleOpenBulkActionsForDeck();
        return;
      }
      setBulkDeckMode(false);
      setBulkAddMissingOpen(true);
      setBulkActionsOpen(false);
      return;
    }
    await handleOpenBulkActionsForDeck();
  }, [bulkMode, bulkSelectedNoteIds.size, bulkSelectionIsDeckAll, handleOpenBulkActionsForDeck]);

  const extractFirstSoundFilename = useCallback((value: string) => {
    const match = String(value || '').match(/\[sound:([^\]]+)\]/);
    return match?.[1] ? match[1].trim() : null;
  }, []);

  function cleanSentenceFieldText(value: string) {
    let s = String(value ?? '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/&nbsp;/gi, ' ');
    s = s.replace(/<[^>]*>/g, '');
    s = s.replace(/\r\n/g, '\n');
    return s.trim();
  }

  function cleanGlossaryFieldText(value: string) {
    let s = String(value ?? '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/&nbsp;/gi, ' ');
    s = s.replace(/<[^>]*>/g, '');
    s = s.replace(/\[sound:[^\]]+\]/g, '');
    s = s.replace(/\r\n/g, '\n');
    s = s
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    return s.trim();
  }

  const cleanGlossaryText = useCallback((value: string) => {
    let s = String(value ?? '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/&nbsp;/gi, ' ');
    s = s.replace(/<[^>]*>/g, '');
    s = s.replace(/\[sound:[^\]]+\]/g, '');
    s = s.replace(/\r\n/g, '\n');
    s = s
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    return s.trim();
  }, []);

  const isGlossaryLong = useCallback((value: string) => {
    const s = String(value ?? '');
    if (!s) return false;
    const lines = s.split('\n').filter(Boolean).length;
    return lines > 3 || s.length > 180;
  }, []);

  const startBulkAudioLoading = useCallback((filename: string) => {
    if (bulkMediaLoadingIntervalRef.current != null) {
      window.clearInterval(bulkMediaLoadingIntervalRef.current);
    }
    setBulkLoadingAudioFilename(filename);
    setBulkLoadingAudioSeconds(1);
    const startedAt = Date.now();
    bulkMediaLoadingIntervalRef.current = window.setInterval(() => {
      setBulkLoadingAudioSeconds(Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)));
    }, 250);
  }, []);

  const stopBulkAudioLoading = useCallback((filename?: string) => {
    if (filename && bulkLoadingAudioFilename !== filename) return;
    if (bulkMediaLoadingIntervalRef.current != null) {
      window.clearInterval(bulkMediaLoadingIntervalRef.current);
      bulkMediaLoadingIntervalRef.current = null;
    }
    setBulkLoadingAudioFilename((prev) => (filename && prev !== filename ? prev : null));
    setBulkLoadingAudioSeconds(1);
  }, [bulkLoadingAudioFilename]);

  const playBulkMediaFile = useCallback((filename: string) => {
    try {
      if (bulkMediaAudioRef.current) {
        bulkMediaAudioRef.current.pause();
        bulkMediaAudioRef.current.currentTime = 0;
      }
      const a = new Audio(`/media/${encodeURIComponent(filename)}`);
      startBulkAudioLoading(filename);
      const handleReady = () => {
        stopBulkAudioLoading(filename);
      };
      a.addEventListener('error', () => {
        stopBulkAudioLoading(filename);
        setBulkFailedAudioFilenames((prev) => {
          const next = new Set(prev);
          next.add(filename);
          return next;
        });
      });
      a.addEventListener('canplay', handleReady, { once: true });
      a.addEventListener('playing', handleReady, { once: true });
      bulkMediaAudioRef.current = a;
      void a.play()
        .then(() => {
          stopBulkAudioLoading(filename);
          setBulkFailedAudioFilenames((prev) => {
            if (!prev.has(filename)) return prev;
            const next = new Set(prev);
            next.delete(filename);
            return next;
          });
        })
        .catch(() => {
          stopBulkAudioLoading(filename);
          setBulkFailedAudioFilenames((prev) => {
            const next = new Set(prev);
            next.add(filename);
            return next;
          });
        });
    } catch {
      stopBulkAudioLoading(filename);
      setBulkFailedAudioFilenames((prev) => {
        const next = new Set(prev);
        next.add(filename);
        return next;
      });
      toast.error(t("Failed playing Audio, check source folder"));
    }
  }, [startBulkAudioLoading, stopBulkAudioLoading, t]);

  const toggleBulkSelection = useCallback((key: string, noteId?: number) => {
    setBulkSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (noteId != null) {
      setBulkSelectedNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(noteId)) next.delete(noteId);
        else next.add(noteId);
        return next;
      });
    }
  }, []);

  const handleGridClick = useCallback((e: React.MouseEvent, index: number, word: string, noteId?: number) => {
    if (suppressNextGridClickRef.current) {
      suppressNextGridClickRef.current = false;
      return;
    }
    const key = getSelectionKey(word, index, noteId);
    const toggle = e.ctrlKey || e.metaKey || bulkSelectedKeys.size > 1;

    if (toggle) {
      toggleBulkSelection(key, noteId);
    } else {
      setBulkSelectedKeys(new Set([key]));
      setBulkSelectedNoteIds(noteId != null ? new Set([noteId]) : new Set());
      setBulkActionsOpen(false);
    }

    if (noteId != null) {
      const card = cards.find((c) => c.noteId === noteId);
      if (card) {
        bulkCardCacheRef.current.set(noteId, card);
        setBulkCardCacheEpoch((v) => v + 1);
      }
    }

    handleSelectById(index, noteId);
  }, [getSelectionKey, toggleBulkSelection, handleSelectById, bulkSelectedKeys.size, cards]);

  const clearFieldOptions = useMemo(() => {
    const resolve = (internalKey: string, fallback: string) => {
      if (mapping && !mapping[internalKey]) return null;
      return mapping?.[internalKey] ?? fallback;
    };

    const options = [
      { id: 'sentence', label: 'Sentence', ankiField: resolve('sentence', 'Sentence') },
      { id: 'translation', label: 'Translation', ankiField: resolve('translation', 'SentenceTranslation') },
      { id: 'sentence_audio', label: 'Audio', ankiField: resolve('sentence_audio', 'SentenceAudio') },
    ].filter((o) => o.ankiField);

    return options as Array<{ id: string; label: string; ankiField: string }>;
  }, [mapping]);

  useEffect(() => {
    if (bulkClearInternalFields.length > 0) return;
    setBulkClearInternalFields(clearFieldOptions.map((o) => o.id));
  }, [clearFieldOptions, bulkClearInternalFields.length]);

  const handleBulkClearFields = useCallback(async () => {
    if (bulkRunning) return;
    if (bulkSelectedNoteIds.size === 0) return;

    const fields = clearFieldOptions
      .filter((o) => bulkClearInternalFields.includes(o.id))
      .map((o) => o.ankiField);

    if (fields.length === 0) return;

    setBulkRunning(true);
    try {
      const ids = bulkVisibleRows.filter((r) => r.include).map((r) => r.noteId);
      setBulkRandomTotal(ids.length);
      setBulkRandomDone(0);
      const updatedIds: number[] = [];

      for (const noteId of ids) {
        setBulkActiveNoteId(noteId);
        try {
          const res = await fetch(`/api/notes/${noteId}/clear-sentence`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields }),
          });
          if (!res.ok) throw new Error(await res.text());
          updatedIds.push(noteId);

          setBulkRandomRows((prev) =>
            prev.map((r) => {
              if (r.noteId !== noteId) return r;
              const cleared: string[] = [];
              if (bulkClearInternalFields.includes('sentence')) cleared.push('Sentence');
              if (bulkClearInternalFields.includes('translation')) cleared.push('Translation');
              if (bulkClearInternalFields.includes('sentence_audio')) cleared.push('Audio');
              return {
                ...r,
                sentence: bulkClearInternalFields.includes('sentence') ? '' : r.sentence,
                translation: bulkClearInternalFields.includes('translation') ? '' : r.translation,
                sentenceHasAudio: bulkClearInternalFields.includes('sentence_audio') ? false : r.sentenceHasAudio,
                status: 'updated',
                message: cleared.length ? `Updated: cleared ${cleared.join(', ')}` : 'Updated',
              };
            })
          );
        } catch (err: any) {
          setBulkRandomRows((prev) =>
            prev.map((r) =>
              r.noteId === noteId ? { ...r, status: 'failed', message: err?.message ?? String(err) } : r
            )
          );
        } finally {
          setBulkRandomDone((prev) => prev + 1);
        }
      }
      await refreshCards();
      toast.success(`Cleared fields for ${ids.length} notes.`);
      setBulkLastUpdatedNoteIds(updatedIds);
      setBulkLastUpdatedLabel('Clear fields');
    } catch (err: any) {
      toast.error(`Bulk clear failed: ${err?.message ?? String(err)}`);
    } finally {
      setBulkRunning(false);
      setBulkActiveNoteId(null);
    }
  }, [bulkRunning, bulkSelectedNoteIds, bulkRandomRows, bulkVisibleRows, bulkClearInternalFields, clearFieldOptions, refreshCards]);

  const handleBulkViewInAnki = useCallback(async () => {
    if (bulkLastUpdatedNoteIds.length === 0) return;
    try {
      const res = await fetch('/api/notes/open-browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteIds: bulkLastUpdatedNoteIds }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const opened = Number(data.opened ?? 0);
      const total = Number(data.totalRequested ?? bulkLastUpdatedNoteIds.length);
      const truncated = Boolean(data.truncated);
      toast.success(
        truncated
          ? t("bulkActions.toasts.openedNotesTruncated", { opened, total })
          : t("bulkActions.toasts.openedNotes", { opened })
      );
    } catch (err: any) {
      toast.error(t("bulkActions.toasts.failedToOpenInAnki", { message: err?.message ?? String(err) }));
    }
  }, [bulkLastUpdatedNoteIds, t]);

  const prevBulkActionTabRef = useRef<typeof bulkActionTab>('');

  const rowHasSelectedFieldsToClear = useCallback((row: { sentence: string; translation: string; sentenceHasAudio: boolean }) => {
    let ok = false;
    if (bulkClearInternalFields.includes('sentence') && row.sentence.trim()) ok = true;
    if (bulkClearInternalFields.includes('translation') && row.translation.trim()) ok = true;
    if (bulkClearInternalFields.includes('sentence_audio') && row.sentenceHasAudio) ok = true;
    return ok;
  }, [bulkClearInternalFields]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    if (bulkRunning) return;

    const prevTab = prevBulkActionTabRef.current;
    prevBulkActionTabRef.current = bulkActionTab;
    if (bulkActionTab !== 'clear_fields') return;

    const enteredClearFields = prevTab !== 'clear_fields';

    setBulkRandomRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const canClear = rowHasSelectedFieldsToClear(r);
        if (!canClear) {
          if (r.include || r.message !== 'Nothing to clear.') {
            changed = true;
            return ({ ...r, include: false, status: 'skipped', message: 'Nothing to clear.' } as typeof r);
          }
          return r;
        }

        if (enteredClearFields) {
          if (!r.include || r.status !== 'missing' || r.message === 'Nothing to clear.') {
            changed = true;
            return ({ ...r, include: true, status: 'missing', message: 'Ready to clear.' } as typeof r);
          }
        } else {
          if (r.message === 'Nothing to clear.') {
            changed = true;
            return ({ ...r, include: true, status: 'missing', message: 'Ready to clear.' } as typeof r);
          }
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [bulkAddMissingOpen, bulkActionTab, bulkRunning, rowHasSelectedFieldsToClear]);

  useEffect(() => {
    if (!bulkAddMissingOpen) return;
    if (bulkRunning) return;
    if (bulkActionTab !== 'tts') return;

    const canExpressionAudio = !mapping || Boolean(mapping['expression_audio']);

    setBulkRandomRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        if (r.message === 'Excluded') return r;
        const needsSentence = r.sentence.trim() && !r.sentenceHasAudio;
        const needsExpression =
          canExpressionAudio && bulkTtsIncludeExpressionAudio && r.expression.trim() && !r.expressionHasAudio;
        const hasWork = needsSentence || needsExpression;

        if (!hasWork) {
          if (r.include || r.status !== 'skipped' || r.message !== 'No missing audio.') {
            changed = true;
            return ({ ...r, include: false, status: 'skipped', message: 'No missing audio.' } as typeof r);
          }
          return r;
        }

        const parts: string[] = [];
        if (needsSentence) parts.push('Sentence audio');
        if (needsExpression) parts.push('Expression audio');
        const message = `Ready: ${parts.join(', ')}`;
        if (!r.include || r.status !== 'missing' || r.message !== message) {
          changed = true;
          return ({ ...r, include: true, status: 'missing', message } as typeof r);
        }
        return r;
      });
      return changed ? next : prev;
    });
  }, [bulkAddMissingOpen, bulkActionTab, bulkRunning, bulkTtsIncludeExpressionAudio, mapping]);

  
  
  // 3. Reset to page 0 whenever search or pageSize changes
  useEffect(() => {
    setInternalPage(0);
  }, [searchQuery, cardsPerPage]);

  // const displayWords = internalMode
  //   ? cards.slice(internalPage * cardsPerPage, (internalPage + 1) * cardsPerPage).map(c => c.word)
  //   : words ?? []

  //const totalPages = internalMode ? Math.ceil(cards.length / cardsPerPage) : Math.ceil((words || []).length / cardsPerPage)
  
  const page = internalMode ? internalPage : Math.floor(selectedIndex / cardsPerPage)
  

  //THis is to replace the setInternalIndex...I must change this whole structure into
  //a Identity-driven UI, not index-driven one...
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);

  // When searching, if the currently selected card is no longer in the filtered results,
  // move selection to the first filtered card (if any) and reset the external index to 0.
  useEffect(() => {
    if (!searchActive) return;
    if (selectedNoteId == null) return;

    const stillVisible = filteredCards.some(c => c.noteId === selectedNoteId);
    if (!stillVisible) {
      const first = filteredCards[0];
      if (first?.noteId != null) {
        setSelectedNoteId(first.noteId);
        onSelectNoteId?.(first.noteId);
      }
      onSelectWord?.(0);
    }
  }, [searchActive, filteredCards, selectedNoteId, onSelectNoteId, onSelectWord]);

  const handlePrev = () => {
    if (internalMode || searchActive) {
      setInternalPage(p => Math.max(0, p - 1))
      setInternalIndex(0)
    } else {
      onPrevious?.()
    }
  }
  const handleNext = () => {
    if (internalMode || searchActive) {
      setInternalPage(p => Math.min(totalPages - 1, p + 1))
      setInternalIndex(0)
    } else {
      onNext?.()
    }
  }

  //const selected = internalMode ? internalIndex : selectedIndex

  const selected = useMemo(() => {
    if (!internalMode) return selectedIndex;

    if (selectedNoteId == null) return internalIndex;

    // Find the index inside the currently displayed (filtered) cards
    const displayIndex = displayCards.findIndex(word => {
      const card = cardByWord.get(word);
      return card?.noteId === selectedNoteId;
    });

    if (displayIndex === -1) return internalIndex;

    return displayIndex;
  }, [
    internalMode,
    selectedIndex,
    internalIndex,
    selectedNoteId,
    displayCards,
    cardByWord
  ]);

  const selectedCard = useMemo(() => {
    return cards.find(c => c.noteId === selectedNoteId);
  }, [cards, selectedNoteId]);

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
      setSelectedNoteId(null);
    }
  };

  // Manual Refresh Handler
  const handleManualRefresh = () => {
    if (loading || loadingDecks) return;
    refreshDecks();
    refreshCards();
    // If you also want to re-fetch the deck list:
    // window.location.reload(); // Only if listAnkiDecks doesn't have a refresh
  };

  type TokenPreviewRow = {
    rowId: number;
    entry: string;
    reading: string;
    translation: string;
    sentence?: string;
    sentenceTranslation?: string;
    audioFilename?: string;
    sentenceAudioFilename?: string;
    tags: string[];
    inDeck?: boolean;
    occurrences?: number;
    frequency?: number | null;
    jlptLevel?: number | null;
  };

  const [gridSizeSelectOpen, setGridSizeSelectOpen] = useState(false);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importExitConfirmOpen, setImportExitConfirmOpen] = useState(false);
  const [importCommitConfirmOpen, setImportCommitConfirmOpen] = useState(false);
  const [importCommitRunning, setImportCommitRunning] = useState(false);
  const [importStage, setImportStage] = useState<'import' | 'enrichment'>('import');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importRows, setImportRows] = useState<TokenPreviewRow[]>([]);
  const [importTagCounts, setImportTagCounts] = useState<Record<string, number>>({});
  const [importSelectedTags, setImportSelectedTags] = useState<string[]>([]);
  const NON_JLPT = '__NON_JLPT__';
  const [importSelectedJlptLevels, setImportSelectedJlptLevels] = useState<string[]>([]);
  const [importJlptSort, setImportJlptSort] = useState<'all' | 'asc' | 'desc'>('all');
  const [importTagFiltersExpanded, setImportTagFiltersExpanded] = useState(false);
  const [importShowAllRecords, setImportShowAllRecords] = useState(true);
  const [importDuplicateCount, setImportDuplicateCount] = useState<number>(0);
  const [importSelectedRowIds, setImportSelectedRowIds] = useState<number[]>([]);
  const [importSelectAllFiltered, setImportSelectAllFiltered] = useState(false);
  const [importHasDeeplKey, setImportHasDeeplKey] = useState(false);
  const [importHasAzureKey, setImportHasAzureKey] = useState(false);
  const [importTtsVoiceOptions, setImportTtsVoiceOptions] = useState<TtsVoiceOption[]>([]);
  const [importTranslateLoading, setImportTranslateLoading] = useState(false);
  const [importEnhanceAddContent, setImportEnhanceAddContent] = useState(false);
  const [importEnrichmentOpen, setImportEnrichmentOpen] = useState(false);
  const [importGlossaryExpandOpen, setImportGlossaryExpandOpen] = useState(false);
  const [importEntryAudioExpandOpen, setImportEntryAudioExpandOpen] = useState(false);
  const [importFilters, setImportFilters] = useState<Record<string, 'any' | 'missing' | 'contains'>>({
    sentenceAudio: 'any',
    entryAudio: 'any',
    sentence: 'any',
    translation: 'any',
    glossary: 'any',
  });
  const [importEnhanceAddTranslation, setImportEnhanceAddTranslation] = useState(false);
  const [importEnhanceTargetLang, setImportEnhanceTargetLang] = useState<TargetLanguage>(() => getDefaultTargetLanguage());
  const [importEnhanceAddAudio, setImportEnhanceAddAudio] = useState(false);
  const [importEnhanceAudioSource, setImportEnhanceAudioSource] = useState<'entry' | 'reading'>('entry');
  const [importEnhanceGenerateSentences, setImportEnhanceGenerateSentences] = useState(false);
  const [importEnhanceSentenceMode, setImportEnhanceSentenceMode] = useState<'random' | 'most_common' | 'jlpt'>('random');
  const [importEnhanceIncludeSentence, setImportEnhanceIncludeSentence] = useState(true);
  const [importEnhanceIncludeSentenceTranslation, setImportEnhanceIncludeSentenceTranslation] = useState(true);
  const [importEnhanceIncludeSentenceAudio, setImportEnhanceIncludeSentenceAudio] = useState(false);
  const [importEnhanceSentenceAudioVoiceName, setImportEnhanceSentenceAudioVoiceName] = useState('');
  const [importEnhanceConfirmOpen, setImportEnhanceConfirmOpen] = useState(false);
  const [importEnhanceProgress, setImportEnhanceProgress] = useState(0);
  const [importExistingGlossaryLang, setImportExistingGlossaryLang] = useState<TargetLanguage | null>(null);
  const [importEnhanceTranslateExistingGlossary, setImportEnhanceTranslateExistingGlossary] = useState(false);
  const [importSentenceLoading, setImportSentenceLoading] = useState(false);
  const [importAudioLoading, setImportAudioLoading] = useState(false);
  const [importCommitProgress, setImportCommitProgress] = useState(0);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const importPreviewRequestIdRef = useRef(0);
  const [importMappingDialogOpen, setImportMappingDialogOpen] = useState(false);
  const [importPendingFile, setImportPendingFile] = useState<File | null>(null);
  const [importDetectedColumns, setImportDetectedColumns] = useState<Array<{ value: string; label: string }>>([]);
  const [importDetectedColumnPreviews, setImportDetectedColumnPreviews] = useState<Record<string, string>>({});
  const [importCsvDelimiter, setImportCsvDelimiter] = useState<string>(",");
  const [importIsCsvMapping, setImportIsCsvMapping] = useState(false);
  const [importInvalidTxtDialogOpen, setImportInvalidTxtDialogOpen] = useState(false);
  const [importColumnMapping, setImportColumnMapping] = useState<Record<string, string>>({
    expression: "",
    reading: "",
    glossary: "",
    sentence: "",
    translation: "",
  });
  const [importMappingWarning, setImportMappingWarning] = useState<string | null>(null);

  const resetImportDialogState = () => {
    importPreviewRequestIdRef.current += 1;
    setImportStage('import');
    setImportFileName(null);
    setImportLoading(false);
    setImportRows([]);
    setImportTagCounts({});
    setImportSelectedTags([]);
    setImportSelectedJlptLevels([]);
    setImportJlptSort('all');
    setImportTagFiltersExpanded(false);
    setImportShowAllRecords(true);
    setImportDuplicateCount(0);
    setImportSelectedRowIds([]);
    setImportSelectAllFiltered(false);
    setImportFilters({
      sentenceAudio: 'any',
      entryAudio: 'any',
      sentence: 'any',
      translation: 'any',
      glossary: 'any',
    });
    setImportCommitConfirmOpen(false);
    setImportCommitRunning(false);
    setImportCommitProgress(0);
    setImportTranslateLoading(false);
    setImportEnhanceAddContent(false);
    setImportEnrichmentOpen(false);
    setImportEnhanceAddTranslation(false);
    setImportEnhanceTargetLang(getDefaultTargetLanguage());
    setImportEnhanceAddAudio(false);
    setImportEnhanceAudioSource('entry');
    setImportEnhanceGenerateSentences(false);
    setImportEnhanceSentenceMode('random');
    setImportEnhanceIncludeSentence(true);
    setImportEnhanceIncludeSentenceTranslation(true);
    setImportEnhanceIncludeSentenceAudio(false);
    setImportEnhanceSentenceAudioVoiceName('');
    setImportEnhanceConfirmOpen(false);
    setImportEnhanceProgress(0);
    setImportExistingGlossaryLang(null);
    setImportEnhanceTranslateExistingGlossary(false);
    setImportSentenceLoading(false);
    setImportAudioLoading(false);
    setImportMappingDialogOpen(false);
    setImportPendingFile(null);
    setImportDetectedColumns([]);
    setImportDetectedColumnPreviews({});
    setImportCsvDelimiter(",");
    setImportIsCsvMapping(false);
    setImportInvalidTxtDialogOpen(false);
    setImportColumnMapping({
      expression: "",
      reading: "",
      glossary: "",
      sentence: "",
      translation: "",
    });
    setImportMappingWarning(null);
  };

  const containsJapaneseKana = (text: string) => /[ぁ-ゟ゠-ヿ]/.test(text);

  const parseCsvLine = (line: string, delimiter: string): string[] => {
    const out: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        out.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out.map((s) => s.replace(/^\uFEFF/, ""));
  };

  const detectCsvDelimiter = (text: string): string => {
    const firstLine = (text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "").trim();
    if (!firstLine) return ",";

    const candidates = [",", ";", "\t", "|"];
    const counts = new Map<string, number>();
    for (const d of candidates) counts.set(d, 0);

    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i += 1) {
      const ch = firstLine[i];
      if (ch === '"') {
        if (inQuotes && firstLine[i + 1] === '"') {
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (!inQuotes && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }

    let best = ",";
    let bestCount = -1;
    for (const [d, c] of counts.entries()) {
      if (c > bestCount) {
        bestCount = c;
        best = d;
      }
    }
    return bestCount > 0 ? best : ",";
  };

  const guessMappingFromColumns = (
    cols: Array<{ value: string; label: string }>,
    previews: Record<string, string> = {}
  ): Record<string, string> => {
    const names = cols.map((c) => c.value);
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/[.\-_]/g, "");

    const getPreview = (name: string) => String(previews?.[name] ?? "").trim();
    const hasJapanese = (s: string) => /[ぁ-ゟ゠-ヿ一-龯]/.test(s);
    const isKanaOnly = (s: string) => s.length > 0 && /^[\sぁ-ゟ゠-ヿー・]+$/.test(s) && !/[一-龯]/.test(s);
    const looksLikeEnSentence = (s: string) =>
      /[A-Za-z]/.test(s) && (/[.!?]/.test(s) || (s.includes(" ") && s.length >= 12));
    const looksLikeJaSentence = (s: string) =>
      hasJapanese(s) && (/[。！？]/.test(s) || s.length >= 12);
    const looksLikeEnGlossary = (s: string) => /[A-Za-z]/.test(s) && !looksLikeEnSentence(s);

    const score = (name: string, keyNeedles: string[], valueScore: (v: string) => number): number => {
      const n = norm(name);
      const key = keyNeedles.some((k) => n.includes(norm(k))) ? 2 : 0;
      const v = valueScore(getPreview(name));
      return key + v;
    };

    const pickBest = (
      candidates: string[],
      keyNeedles: string[],
      valueScore: (v: string) => number,
      used: Set<string>,
      minScore: number
    ) => {
      let best = "";
      let bestScore = -999;
      for (const name of candidates) {
        if (used.has(name)) continue;
        const s = score(name, keyNeedles, valueScore);
        if (s > bestScore) {
          bestScore = s;
          best = name;
        }
      }
      return bestScore >= minScore ? best : "";
    };

    const used = new Set<string>();
    const expressionKeyNeedles = [
      "expression",
      "vocab",
      "word",
      "entry",
      "term",
      "kanji",
      "japanese",
      "surface",
      "contents",
      "content",
      "front",
      "jp",
      "text",
      "value",
    ];
    const readingKeyNeedles = ["reading", "kana", "yomi", "yomigana", "furigana", "pronunciation"];
    const glossaryKeyNeedles = ["glossary", "meaning", "definition", "gloss", "english", "en", "back"];
    const sentenceKeyNeedles = ["sentence", "example", "jp_sentence", "japanese_sentence"];
    const sentenceTrKeyNeedles = [
      "sentencetranslation",
      "sentence_translation",
      "translation_sentence",
      "en_sentence",
      "english_sentence",
      "example_translation",
    ];

    const expression = pickBest(
      names,
      expressionKeyNeedles,
      (v) => (hasJapanese(v) ? 3 : 0) + (looksLikeJaSentence(v) ? -1 : 0),
      used,
      2
    );
    if (expression) used.add(expression);

    const reading = pickBest(
      names,
      readingKeyNeedles,
      (v) => (isKanaOnly(v) ? 3 : 0) + (!v || hasJapanese(v) ? 0 : -1),
      used,
      3
    );
    if (reading) used.add(reading);

    const glossary = pickBest(
      names.filter((n) => !expressionKeyNeedles.some((k) => norm(n).includes(norm(k)))),
      glossaryKeyNeedles,
      (v) => (looksLikeEnGlossary(v) ? 2 : 0) + (hasJapanese(v) ? -2 : 0),
      used,
      3
    );
    if (glossary) used.add(glossary);

    const sentence = pickBest(
      names,
      sentenceKeyNeedles,
      (v) => (looksLikeJaSentence(v) ? 3 : 0),
      used,
      4
    );
    if (sentence) used.add(sentence);

    const translation = pickBest(
      names,
      sentenceTrKeyNeedles,
      (v) => (looksLikeEnSentence(v) ? 3 : 0) + (hasJapanese(v) ? -2 : 0),
      used,
      4
    );
    if (translation) used.add(translation);

    return {
      expression,
      reading,
      glossary,
      sentence,
      translation,
    };
  };

  const MarqueeText = ({ text }: { text: string }) => {
    const s = String(text || "");
    if (s.length <= 36) return <span className="truncate">{s}</span>;
    return (
      <div className="anki-marquee" title={s}>
        <div className="anki-marquee__inner">
          <span className="anki-marquee__chunk">{s}</span>
          <span className="anki-marquee__chunk" aria-hidden="true">
            {s}
          </span>
        </div>
      </div>
    );
  };

  const detectStructuredColumns = async (file: File, csvDelimiter?: string): Promise<{
    columns: Array<{ value: string; label: string }>;
    warning: string | null;
    previews: Record<string, string>;
  }> => {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    const text = await file.text();
    if (ext === "csv") {
      const delimiter = csvDelimiter && csvDelimiter.length > 0 ? csvDelimiter : detectCsvDelimiter(text);
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      const first = lines[0] ?? "";
      const second = lines[1] ?? "";
      const a = parseCsvLine(first, delimiter);
      const b = parseCsvLine(second, delimiter);
      const hasJa = (s: string) => /[ぁ-ゟ゠-ヿ一-龯]/.test(s);
      const headerScore = a.filter((x) => /[A-Za-z]/.test(x) && !hasJa(x)).length;
      const likelyHeader = headerScore > 0 && (b.some((x) => hasJa(x)) || b.length === a.length);
      if (likelyHeader) {
        const cols = a.filter((x) => x).map((x) => ({ value: x, label: x }));
        const previews: Record<string, string> = {};
        for (let i = 0; i < a.length; i += 1) {
          const header = String(a[i] ?? "").trim();
          if (!header) continue;
          const sample = String(b[i] ?? "").trim();
          previews[header] = sample.length > 120 ? `${sample.slice(0, 120)}…` : sample;
        }
        return { columns: cols, warning: null, previews };
      }
      const n = Math.max(1, a.length);
      const cols = Array.from({ length: n }, (_, i) => ({ value: String(i), label: `${t("Column")} ${i + 1}` }));
      const previews: Record<string, string> = {};
      for (let i = 0; i < a.length; i += 1) {
        const key = String(i);
        const sample = String(a[i] ?? "").trim();
        previews[key] = sample.length > 120 ? `${sample.slice(0, 120)}…` : sample;
      }
      return { columns: cols, warning: t("import.mapping.noHeaderWarning"), previews };
    }
    if (ext === "json") {
      try {
        const data = JSON.parse(text);
        const seen = new Set<string>();
        const previews: Record<string, string> = {};
        const paths: string[] = [];

        const add = (path: string, value: unknown) => {
          const p = String(path || "").trim();
          if (!p) return;
          if (seen.has(p)) return;
          seen.add(p);
          paths.push(p);
          if (value === null || value === undefined) {
            previews[p] = "";
            return;
          }
          if (typeof value === "string") {
            previews[p] = value.length > 120 ? `${value.slice(0, 120)}…` : value;
            return;
          }
          if (typeof value === "number" || typeof value === "boolean") {
            previews[p] = String(value);
            return;
          }
          try {
            const s = JSON.stringify(value);
            previews[p] = s && s.length > 120 ? `${s.slice(0, 120)}…` : (s || "");
          } catch {
            previews[p] = String(value);
          }
        };

        const walk = (node: unknown, currentPath: string) => {
          if (node && typeof node === "object") {
            if (Array.isArray(node)) {
              for (const v of node) walk(v, currentPath);
              return;
            }
            for (const [rawKey, value] of Object.entries(node as Record<string, unknown>)) {
              const key = String(rawKey || "").trim();
              if (!key) continue;
              const nextPath = currentPath ? `${currentPath}.${key}` : key;
              walk(value, nextPath);
            }
            return;
          }
          add(currentPath, node);
        };

        walk(data, "");
        if (paths.length === 0) {
          return { columns: [], warning: t("import.mapping.jsonUnsupportedWarning"), previews: {} };
        }
        const cols = paths.map((p) => ({ value: p, label: p }));
        return { columns: cols, warning: null, previews };
      } catch {
        return { columns: [], warning: t("import.mapping.jsonParseWarning"), previews: {} };
      }
    }
    return { columns: [], warning: null, previews: {} };
  };

  const displayTargetLang: TargetLanguage = i18n.language === "pt-BR" ? "pt-BR" : "en-US";

  const detectLatinGlossaryLang = useCallback((text: string): TargetLanguage | null => {
    const s = String(text || "").trim();
    if (!s) return null;
    if (/[ぁ-ゟ゠-ヿ一-龯]/.test(s)) return null;

    const accentCount = (s.match(/[ãõáàâéêíóôúçÃÕÁÀÂÉÊÍÓÔÚÇ]/g) || []).length;
    if (accentCount > 0) return "pt-BR";

    const lower = s.toLowerCase();
    const ptHits = (lower.match(/\b(de|da|do|das|dos|para|com|não|uma|um|uns|umas|que|e|em|por|se|ao|aos|às|na|no|nas|nos|mais|menos)\b/g) || []).length;
    const enHits = (lower.match(/\b(the|of|to|and|in|for|with|not|a|an|is|are|was|were|this|that|it|you|we|they)\b/g) || []).length;

    if (ptHits > enHits) return "pt-BR";
    if (enHits > ptHits) return "en-US";
    return "en-US";
  }, []);

  const inferImportExistingGlossaryLang = useCallback((): TargetLanguage | null => {
    const selected = new Set(importSelectedRowIds);
    const samples = importRows
      .filter((r) => !r.inDeck && selected.has(r.rowId))
      .map((r) => String(r.translation || "").trim())
      .filter((x) => x)
      .slice(0, 50);

    if (samples.length === 0) return null;

    let pt = 0;
    let en = 0;
    for (const s of samples) {
      const lang = detectLatinGlossaryLang(s);
      if (lang === "pt-BR") pt += 1;
      if (lang === "en-US") en += 1;
    }
    if (pt === 0 && en === 0) return null;
    return pt >= en ? "pt-BR" : "en-US";
  }, [detectLatinGlossaryLang, importRows, importSelectedRowIds]);

  const closeImportDialog = () => {
    setImportExitConfirmOpen(false);
    setImportDialogOpen(false);
    resetImportDialogState();
  };

  const importHasUnsavedChanges = importRows.length > 0;

  const requestCloseImportDialog = () => {
    if (importHasUnsavedChanges) {
      setImportExitConfirmOpen(true);
      return;
    }
    closeImportDialog();
  };

  const handleImportCommit = useCallback(async () => {
    if (!deckName) return;
    if (importCommitRunning) return;
    if (importSelectedRowIds.length === 0) return;

    const selected = new Set(importSelectedRowIds);
    const committedRowIds = importRows
      .filter((r) => !r.inDeck && selected.has(r.rowId) && String(r.entry || "").trim())
      .map((r) => r.rowId);
    const committedRowIdSet = new Set(committedRowIds);

    const records = importRows
      .filter((r) => !r.inDeck && selected.has(r.rowId))
      .map((r) => ({
        entry: r.entry,
        reading: r.reading,
        glossary: r.translation,
        sentence: r.sentence,
        sentenceTranslation: r.sentenceTranslation,
        audioFilename: r.audioFilename,
        sentenceAudioFilename: r.sentenceAudioFilename,
      }));

    if (records.length === 0) return;

    setImportCommitRunning(true);
    setImportCommitProgress(15);
    try {
      const res = await fetch('/api/cards/import/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckName, records }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const added = Number(data?.added ?? 0) || 0;
      const skippedExisting = Number(data?.skippedExisting ?? 0) || 0;
      const skippedExistingOtherDeck = Number(data?.skippedExistingOtherDeck ?? 0) || 0;
      const skippedExistingOtherDeckTopDeck = String(data?.skippedExistingOtherDeckTopDeck ?? '').trim();
      const skippedExistingOtherDeckOtherCount = Number(data?.skippedExistingOtherDeckOtherCount ?? 0) || 0;
      const skippedMissingExpression = Number(data?.skippedMissingExpression ?? 0) || 0;
      setImportCommitProgress(100);
      toast.success(t("import.toasts.importedCards", { n: added }));
      if (skippedExisting > 0) toast.info(t("import.toasts.skippedExisting", { n: skippedExisting }));
      if (skippedExistingOtherDeck > 0) {
        if (skippedExistingOtherDeckTopDeck) {
          if (skippedExistingOtherDeckOtherCount > 0) {
            toast.info(
              t("import.toasts.skippedExistingOtherDeckAndOthers", {
                n: skippedExistingOtherDeck,
                deckName: skippedExistingOtherDeckTopDeck,
                m: skippedExistingOtherDeckOtherCount,
              })
            );
          } else {
            toast.info(
              t("import.toasts.skippedExistingOtherDeck", {
                n: skippedExistingOtherDeck,
                deckName: skippedExistingOtherDeckTopDeck,
              })
            );
          }
        } else {
          toast.info(t("import.toasts.skippedExistingOtherDeckGeneric", { n: skippedExistingOtherDeck }));
        }
      }
      if (skippedMissingExpression > 0) toast.info(t("import.toasts.skippedMissingEntry", { n: skippedMissingExpression }));
      if (committedRowIdSet.size > 0) {
        setImportRows((prev) => prev.map((r) => (committedRowIdSet.has(r.rowId) ? { ...r, inDeck: true } : r)));
        setImportSelectedRowIds((prev) => prev.filter((id) => !committedRowIdSet.has(id)));
        setImportSelectAllFiltered(false);
      }
      setImportCommitConfirmOpen(false);
      await refreshCards();
    } catch (err: any) {
      setImportCommitProgress(0);
      toast.error(t("import.toasts.importFailed", { message: err?.message ?? String(err) }));
    } finally {
      setImportCommitRunning(false);
    }
  }, [deckName, importCommitRunning, importSelectedRowIds, importRows, refreshCards, t]);

  const getHumanTagLabel = useCallback((tag: string) => {
    const code = String(tag || '').trim();
    if (!code) return '';
    const known = new Set([
      'REF_PRESENT',
      'CONTENT',
      'SCRIPT_MIX',
      'SCRIPT_KANJI',
      'SCRIPT_HIRA',
      'SCRIPT_KATA',
      'FUNC',
      'TOO_COMMON',
      'REF_MISSING',
      'AFFIX',
      'IN_DECK',
      'OTHER',
    ]);
    if (!known.has(code)) return code;
    return t(`import.tag.${code}`);
  }, [t]);

  const submitImportPreview = async (file: File, columnMapping?: Record<string, string>, csvDelimiter?: string) => {
    if (!deckName) return;
    importPreviewRequestIdRef.current += 1;
    const requestId = importPreviewRequestIdRef.current;
    setImportLoading(true);
    setImportFileName(file.name);
    setImportRows([]);
    setImportTagCounts({});
    setImportSelectedTags([]);
    setImportSelectedJlptLevels([]);
    setImportJlptSort('all');
    setImportTagFiltersExpanded(false);
    setImportShowAllRecords(true);
    setImportFilters({
      sentenceAudio: 'any',
      entryAudio: 'any',
      sentence: 'any',
      translation: 'any',
      glossary: 'any',
    });
    setImportDuplicateCount(0);
    setImportSelectedRowIds([]);
    setImportTranslateLoading(false);

    try {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      if (!['csv', 'txt', 'json'].includes(ext)) {
        throw new Error(t("import.errors.unsupportedFileType"));
      }

      const base = (import.meta as any).env?.DEV ? 'http://localhost:8000' : '';
      const form = new FormData();
      form.append('deckName', deckName);
      form.append('file', file);
      if (ext === "csv" && csvDelimiter) {
        form.append("csvDelimiter", csvDelimiter);
      }
      if (columnMapping && (ext === "csv" || ext === "json")) {
        form.append("columnMapping", JSON.stringify(columnMapping));
      }
      const previewRes = await fetch(`${base}/api/tokenize/preview`, {
        method: 'POST',
        body: form,
      });
      if (!previewRes.ok) throw new Error(await previewRes.text());
      const previewData = await previewRes.json();
      if (importPreviewRequestIdRef.current !== requestId) return;
      const nextRows = Array.isArray(previewData.rows) ? previewData.rows : [];
      const nextTagCounts = previewData.tagCounts ?? {};
      setImportRows(nextRows);
      setImportTagCounts(nextTagCounts);
      setImportDuplicateCount(Number(previewData.duplicateCount ?? 0));

      const jlptTags = Object.keys(nextTagCounts).filter((t) => /^JLPT_N[1-5]$/.test(String(t)));
      setImportSelectedJlptLevels([...jlptTags.sort(), NON_JLPT]);

      const baseRowIds = nextRows
        .filter((r: any) => !r?.inDeck)
        .map((r: any, idx: number) => Number.isFinite(Number(r?.rowId)) ? Number(r.rowId) : idx);
      setImportSelectedRowIds(baseRowIds);
      setImportSelectAllFiltered(true);
      setImportStage('enrichment');
    } catch (err: any) {
      if (importPreviewRequestIdRef.current !== requestId) return;
      toast.error(t("import.toasts.previewFailed", { message: err?.message ?? String(err) }));
    } finally {
      if (importPreviewRequestIdRef.current !== requestId) return;
      setImportLoading(false);
    }
  };

  const handleImportFileSelect = async (file: File) => {
    if (!deckName) return;
    const ext = file.name.toLowerCase().split('.').pop() || '';
    setImportFileName(file.name);
    setImportStage('import');

    if (ext === "txt") {
      if (language === "jp") {
        const text = await file.text();
        if (!containsJapaneseKana(text)) {
          setImportInvalidTxtDialogOpen(true);
          return;
        }
      }
      await submitImportPreview(file);
      return;
    }

    if (ext === "csv" || ext === "json") {
      const delimiter = ext === "csv" ? detectCsvDelimiter(await file.text()) : ",";
      setImportCsvDelimiter(delimiter);
      setImportIsCsvMapping(ext === "csv");
      const { columns, warning, previews } = await detectStructuredColumns(file, delimiter);
      const guessed = guessMappingFromColumns(columns, previews || {});
      setImportDetectedColumns(columns);
      setImportDetectedColumnPreviews(previews || {});
      setImportColumnMapping(guessed);
      setImportMappingWarning(warning);
      setImportPendingFile(file);
      setImportMappingDialogOpen(true);
      return;
    }

    toast.error(t("import.errors.unsupportedFileType"));
  };

  useEffect(() => {
    if (!importDialogOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/settings/env');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setImportHasDeeplKey(Boolean(String(data?.DEEPL_AUTH_KEY ?? '').trim()));
        setImportHasAzureKey(
          Boolean(String(data?.AZURE_SPEECH_KEY ?? '').trim() || String(data?.ELEVEN_LABS_SPEECH_KEY ?? '').trim())
        );
      } catch {
        if (cancelled) return;
        setImportHasDeeplKey(false);
        setImportHasAzureKey(false);
      }

      try {
        const voiceRes = await fetch('/api/tts/voice');
        if (!voiceRes.ok) return;
        const voiceData = await voiceRes.json();
        if (cancelled) return;
        const options = normalizeTtsVoiceOptions(voiceData?.voices);
        const v = String(voiceData?.defaultVoiceName ?? voiceData?.voiceName ?? options[0]?.id ?? '').trim();
        setImportTtsVoiceOptions(options);
        setImportEnhanceSentenceAudioVoiceName((prev) => (options.some((voice) => voice.id === prev) ? prev : v));
      } catch {
        if (!cancelled) {
          setImportTtsVoiceOptions([]);
          setImportEnhanceSentenceAudioVoiceName('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [importDialogOpen, settingsEpoch]);

  const handleImportTranslate = async (targetLang: TargetLanguage = displayTargetLang) => {
    if (!importHasDeeplKey || importTranslateLoading || importLoading) return;
    const selected = new Set(importSelectedRowIds);
    const candidates = importRows.filter(
      (r) => !r.inDeck && selected.has(r.rowId) && !(r.translation || '').trim()
    );
    if (candidates.length === 0) {
      toast.info(t("import.toasts.noEntriesToTranslate"));
      return;
    }

    setImportTranslateLoading(true);
    try {
      const res = await fetch('/api/tokenize/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts: candidates.map((r) => r.entry),
          target_lang: targetLang,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const translations: string[] = Array.isArray(data?.translations) ? data.translations : [];
      const byId = new Map<number, string>();
      for (let i = 0; i < candidates.length; i += 1) {
        const t = String(translations[i] ?? '').trim();
        if (t) byId.set(candidates[i].rowId, t);
      }
      setImportRows((prev) => prev.map((r) => (byId.has(r.rowId) ? { ...r, translation: byId.get(r.rowId)! } : r)));
      toast.success(byId.size === 1 ? t("import.toasts.translatedEntry") : t("import.toasts.translatedEntries", { n: byId.size }));
    } catch (err: any) {
      toast.error(t("import.toasts.translationFailed", { message: err?.message ?? String(err) }));
    } finally {
      setImportTranslateLoading(false);
    }
  };

  const importJlptTags = useMemo(() => {
    return Object.entries(importTagCounts)
      .filter(([tag]) => /^JLPT_N[1-5]$/.test(tag))
      .map(([tag, count]) => ({ tag, count: Number(count) || 0 }))
      .sort((a, b) => a.tag.localeCompare(b.tag)); // JLPT_N1..N5
  }, [importTagCounts]);

  const importJlptAllOptions = useMemo(() => {
    const levels = importJlptTags.map((x) => x.tag);
    return [...levels, NON_JLPT];
  }, [importJlptTags, NON_JLPT]);

  const importAvailableTags = useMemo(() => {
    return Object.entries(importTagCounts)
      .filter(([tag]) => !/^JLPT_N[1-5]$/.test(tag) && tag !== 'IN_DECK')
      .map(([tag, count]) => ({ tag, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count || getHumanTagLabel(a.tag).localeCompare(getHumanTagLabel(b.tag)));
  }, [importTagCounts, getHumanTagLabel]);

  const importDuplicateRows = useMemo(() => {
    return importRows.filter((r) => Boolean(r.inDeck));
  }, [importRows]);

  const importBaseRows = useMemo(() => {
    return importRows.filter((r) => !r.inDeck);
  }, [importRows]);

  const importVisibleTags = useMemo(() => {
    if (importTagFiltersExpanded) return importAvailableTags;

    const top = importAvailableTags.slice(0, 3);
    const selected = importSelectedTags
      .map((t) => ({ tag: t, count: Number(importTagCounts[t] ?? 0) || 0 }))
      .filter((x) => x.tag);

    const seen = new Set<string>();
    const out: Array<{ tag: string; count: number }> = [];

    for (const t of top) {
      if (seen.has(t.tag)) continue;
      out.push(t);
      seen.add(t.tag);
    }
    for (const s of selected) {
      if (seen.has(s.tag)) continue;
      out.push(s);
      seen.add(s.tag);
    }
    return out;
  }, [importTagFiltersExpanded, importAvailableTags, importSelectedTags, importTagCounts]);

  const filteredImportRows = useMemo(() => {
    const hasTagFilters = importSelectedTags.length > 0;
    const allJlptSelected = importSelectedJlptLevels.length === importJlptAllOptions.length && importJlptAllOptions.length > 0;
    const hasJlptSelection = importSelectedJlptLevels.length > 0;
    const hasJlptFilter = importJlptAllOptions.length > 0 && (!allJlptSelected || !hasJlptSelection);
    const hasStateFilters = Object.values(importFilters).some((v) => v !== 'any');
    if (!hasTagFilters && !hasJlptFilter && !hasStateFilters) return importShowAllRecords ? importRows : [];

    return importBaseRows.filter((r) => {
      const tags = r.tags || [];
      const sentenceAudioMode = importFilters.sentenceAudio;
      const entryAudioMode = importFilters.entryAudio;
      const sentenceMode = importFilters.sentence;
      const translationMode = importFilters.translation;
      const glossaryMode = importFilters.glossary;

      if (sentenceAudioMode === 'missing' && String(r.sentenceAudioFilename || '').trim()) return false;
      if (sentenceAudioMode === 'contains' && !String(r.sentenceAudioFilename || '').trim()) return false;
      if (entryAudioMode === 'missing' && String(r.audioFilename || '').trim()) return false;
      if (entryAudioMode === 'contains' && !String(r.audioFilename || '').trim()) return false;
      if (sentenceMode === 'missing' && String(r.sentence || '').trim()) return false;
      if (sentenceMode === 'contains' && !String(r.sentence || '').trim()) return false;
      if (translationMode === 'missing' && String(r.sentenceTranslation || '').trim()) return false;
      if (translationMode === 'contains' && !String(r.sentenceTranslation || '').trim()) return false;
      if (glossaryMode === 'missing' && String(r.translation || '').trim()) return false;
      if (glossaryMode === 'contains' && !String(r.translation || '').trim()) return false;

      if (hasJlptFilter) {
        const opt =
          typeof r.jlptLevel === 'number' && r.jlptLevel >= 1 && r.jlptLevel <= 5
            ? `JLPT_N${6 - r.jlptLevel}`
            : NON_JLPT;
        if (!importSelectedJlptLevels.includes(opt)) return false;
      }
      if (!hasTagFilters) return true;
      return importSelectedTags.some((t) => tags.includes(t));
    });
  }, [importBaseRows, importSelectedTags, importSelectedJlptLevels, importJlptAllOptions.length, importShowAllRecords, NON_JLPT, importFilters]);

  const sortedFilteredImportRows = useMemo(() => {
    if (importJlptSort === 'all') return filteredImportRows;
    const dir = importJlptSort === 'asc' ? 1 : -1;
    const rows = [...filteredImportRows];
    rows.sort((a, b) => {
      const aKey =
        typeof a.jlptLevel === 'number' && a.jlptLevel >= 1 && a.jlptLevel <= 5 ? a.jlptLevel : 999;
      const bKey =
        typeof b.jlptLevel === 'number' && b.jlptLevel >= 1 && b.jlptLevel <= 5 ? b.jlptLevel : 999;
      if (aKey !== bKey) return (aKey - bKey) * dir;
      return String(a.entry || '').localeCompare(String(b.entry || ''));
    });
    return rows;
  }, [filteredImportRows, importJlptSort]);

  const importSelectedRowIdSet = useMemo(() => new Set(importSelectedRowIds), [importSelectedRowIds]);

  useEffect(() => {
    if (importHasDeeplKey) return;
    setImportEnhanceAddTranslation(false);
    setImportEnhanceTranslateExistingGlossary(false);
  }, [importHasDeeplKey]);

  useEffect(() => {
    setImportFilters((prev) => {
      const next = { ...prev };
      let changed = false;
      if (!showSentenceAudioField && next.sentenceAudio !== 'any') {
        next.sentenceAudio = 'any';
        changed = true;
      }
      if (!showExpressionAudioField && next.entryAudio !== 'any') {
        next.entryAudio = 'any';
        changed = true;
      }
      if (!showSentenceField && next.sentence !== 'any') {
        next.sentence = 'any';
        changed = true;
      }
      if (!showTranslationField && next.translation !== 'any') {
        next.translation = 'any';
        changed = true;
      }
      if (!showGlossaryField && next.glossary !== 'any') {
        next.glossary = 'any';
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [showSentenceAudioField, showExpressionAudioField, showSentenceField, showTranslationField, showGlossaryField]);

  useEffect(() => {
    if (showGlossaryField) return;
    setImportEnhanceAddTranslation(false);
    setImportGlossaryExpandOpen(false);
    setImportExistingGlossaryLang(null);
    setImportEnhanceTranslateExistingGlossary(false);
  }, [showGlossaryField]);

  useEffect(() => {
    if (showExpressionAudioField) return;
    setImportEnhanceAddAudio(false);
    setImportEntryAudioExpandOpen(false);
  }, [showExpressionAudioField]);

  useEffect(() => {
    if (showSentenceField) return;
    setImportEnhanceIncludeSentence(false);
  }, [showSentenceField]);

  useEffect(() => {
    if (showTranslationField) return;
    setImportEnhanceIncludeSentenceTranslation(false);
  }, [showTranslationField]);

  useEffect(() => {
    if (showSentenceAudioField) return;
    setImportEnhanceIncludeSentenceAudio(false);
  }, [showSentenceAudioField]);

  useEffect(() => {
    if (importTtsVoiceOptions.length > 0) return;
    setImportEnhanceIncludeSentenceAudio(false);
  }, [importTtsVoiceOptions]);

  useEffect(() => {
    setImportEnhanceGenerateSentences(
      importEnhanceIncludeSentence || importEnhanceIncludeSentenceTranslation || importEnhanceIncludeSentenceAudio
    );
  }, [importEnhanceIncludeSentence, importEnhanceIncludeSentenceTranslation, importEnhanceIncludeSentenceAudio]);

  const importVisibleMissingCounts = useMemo(() => {
    const selected = new Set(importSelectedRowIds);
    const counts = { glossary: 0, entryAudio: 0, sentence: 0, translation: 0, sentenceAudio: 0 };
    for (const r of importRows) {
      if (r.inDeck || !selected.has(r.rowId)) continue;
      if (showGlossaryField && !String(r.translation || '').trim()) counts.glossary += 1;
      if (showExpressionAudioField && !String(r.audioFilename || '').trim()) counts.entryAudio += 1;
      if (showSentenceField && !String(r.sentence || '').trim()) counts.sentence += 1;
      if (showTranslationField && !String(r.sentenceTranslation || '').trim()) counts.translation += 1;
      if (showSentenceAudioField && !String(r.sentenceAudioFilename || '').trim()) counts.sentenceAudio += 1;
    }
    return counts;
  }, [
    importRows,
    importSelectedRowIds,
    showGlossaryField,
    showExpressionAudioField,
    showSentenceField,
    showTranslationField,
    showSentenceAudioField,
  ]);

  const importVisibleTranslateExistingCounts = useMemo(() => {
    const selected = new Set(importSelectedRowIds);
    const counts = { glossary: 0 };
    for (const r of importRows) {
      if (r.inDeck || !selected.has(r.rowId)) continue;
      const g = String(r.translation || '').trim();
      if (!g) continue;
      const lang = detectLatinGlossaryLang(g);
      if (!lang) continue;
      if (lang !== displayTargetLang) counts.glossary += 1;
    }
    return counts;
  }, [importRows, importSelectedRowIds, detectLatinGlossaryLang, displayTargetLang]);

  const importEnhanceSentencesEffective =
    importEnhanceIncludeSentence || importEnhanceIncludeSentenceTranslation || importEnhanceIncludeSentenceAudio;
  const importEnhancementsSelected =
    importEnhanceAddContent && (importEnhanceAddTranslation || importEnhanceAddAudio || importEnhanceSentencesEffective);
  const importEnhancementsNeedsDeepl =
    importEnhanceAddTranslation ||
    importEnhanceTranslateExistingGlossary ||
    (importEnhanceIncludeSentenceTranslation && displayTargetLang !== 'en-US');
  const importEnhancementsNeedsAzure = importEnhanceAddAudio;
  const importEnhancementsBlocked =
    (importEnhancementsNeedsDeepl && !importHasDeeplKey) || (importEnhancementsNeedsAzure && !importHasAzureKey);

  const importTableColSpan = showGlossaryField ? 7 : 6;
  const renderLargeActionWarning = (count: number) => {
    if (count < LARGE_ACTION_WARNING_THRESHOLD) return null;
    return (
      <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">
        {`You're performing action on ${count} items. Be mindful of your API token usage`}
      </div>
    );
  };

  const handleApplyImportEnhancements = useCallback(async () => {
    if (!importEnhancementsSelected) return;
    if (importEnhancementsBlocked) return;
    if (importLoading || importTranslateLoading || importSentenceLoading || importAudioLoading) return;

    const selected = new Set(importSelectedRowIds);
    const selectedRows = importRows.filter((r) => !r.inDeck && selected.has(r.rowId));
    if (selectedRows.length === 0) {
      toast.info('No rows selected.');
      return;
    }

    setImportEnhanceProgress(5);
    try {
      if (importEnhanceSentencesEffective) {
        setImportEnhanceProgress(15);
        setImportSentenceLoading(true);
        const words = Array.from(new Set(selectedRows.map((r) => String(r.entry || '').trim()).filter((t) => t)));
        if (words.length > 0) {
          const res = await fetch('/api/sentences/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words, per_word: 1, random: importEnhanceSentenceMode === 'random' }),
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          const results = Array.isArray(data?.results) ? data.results : [];
          const byWord = new Map<string, any>();
          for (const r of results) {
            const w = String(r?.word ?? '').trim();
            if (!w) continue;
            byWord.set(w, r);
          }

          setImportRows((prev) =>
            prev.map((row) => {
              if (row.inDeck || !selected.has(row.rowId)) return row;
              const w = String(row.entry || '').trim();
              const hit = byWord.get(w);
              const sentence = String(hit?.jp ?? '').trim();
              const sentenceEn = String(hit?.en ?? '').trim();
              const sentencePt = String(hit?.pt ?? '').trim();

              const next: TokenPreviewRow = { ...row };
              if (importEnhanceIncludeSentence && sentence && !String(row.sentence || '').trim()) next.sentence = sentence;
              if (importEnhanceIncludeSentenceTranslation && !String(row.sentenceTranslation || '').trim()) {
                if (displayTargetLang === 'en-US' && sentenceEn) next.sentenceTranslation = sentenceEn;
                if (displayTargetLang === 'pt-BR' && sentencePt) next.sentenceTranslation = sentencePt;
              }
              return next;
            })
          );

          if (importEnhanceIncludeSentenceAudio) {
            const byRowIdTatoeba = new Map<number, string>();
            for (const r of selectedRows) {
              if (String(r.sentenceAudioFilename || '').trim()) continue;
              const w = String(r.entry || '').trim();
              const hit = byWord.get(w);
              const audioId = String(hit?.audio_id ?? '').trim();
              const hasAudio = Boolean(hit?.has_audio) && Boolean(audioId);
              if (hasAudio) byRowIdTatoeba.set(r.rowId, `tatoeba_${audioId}.mp3`);
            }
            if (byRowIdTatoeba.size > 0) {
              setImportRows((prev) =>
                prev.map((r) =>
                  byRowIdTatoeba.has(r.rowId) && !String(r.sentenceAudioFilename || '').trim()
                    ? { ...r, sentenceAudioFilename: byRowIdTatoeba.get(r.rowId)! }
                    : r
                )
              );
            }

            const items = selectedRows
              .map((r) => {
                if (String(r.sentenceAudioFilename || '').trim()) return null;
                if (byRowIdTatoeba.has(r.rowId)) return null;
                const w = String(r.entry || '').trim();
                const hit = byWord.get(w);
                const sentence = String(hit?.jp ?? '').trim();
                return { rowId: r.rowId, text: sentence };
              })
              .filter((x): x is { rowId: number; text: string } => Boolean(x && x.text));

            if (items.length > 0 && importHasAzureKey && Boolean(importEnhanceSentenceAudioVoiceName)) {
              try {
                setImportAudioLoading(true);
                setImportEnhanceProgress((p) => Math.max(p, 30));
                const res = await fetch('/api/tts/generate-text-audio-batch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ items, voiceName: importEnhanceSentenceAudioVoiceName }),
                });
                if (!res.ok) throw new Error(await res.text());
                const data = await res.json();
                const results = Array.isArray(data?.results) ? data.results : [];
                const byRowId = new Map<number, string>();
                for (const r of results) {
                  const rowId = Number(r?.rowId);
                  const filename = String(r?.filename ?? '').trim();
                  if (!Number.isFinite(rowId) || !filename) continue;
                  byRowId.set(rowId, filename);
                }
                setImportRows((prev) =>
                  prev.map((r) =>
                    byRowId.has(r.rowId) && !String(r.sentenceAudioFilename || '').trim()
                      ? { ...r, sentenceAudioFilename: byRowId.get(r.rowId)! }
                      : r
                  )
                );
              } catch (err: any) {
                toast.error(`Sentence audio generation failed: ${err?.message ?? String(err)}`);
              } finally {
                setImportAudioLoading(false);
              }
            }
          }

          if (importEnhanceIncludeSentenceTranslation) {
            const toTranslate = words
              .map((w) => ({ word: w, sentence: String(byWord.get(w)?.jp ?? '').trim() }))
              .filter((x) => x.sentence);
            if (toTranslate.length > 0 && importHasDeeplKey) {
              const trRes = await fetch('/api/tokenize/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  texts: toTranslate.map((x) => x.sentence),
                  target_lang: displayTargetLang,
                }),
              });
              if (trRes.ok) {
                const trData = await trRes.json();
                const translations: string[] = Array.isArray(trData?.translations) ? trData.translations : [];
                const byWordTranslation = new Map<string, string>();
                for (let i = 0; i < toTranslate.length; i += 1) {
                  const t = String(translations[i] ?? '').trim();
                  if (t) byWordTranslation.set(toTranslate[i].word, t);
                }
                setImportRows((prev) =>
                  prev.map((row) => {
                    if (row.inDeck || !selected.has(row.rowId)) return row;
                    const w = String(row.entry || '').trim();
                    if (!w || !byWordTranslation.has(w)) return row;
                    if (String(row.sentenceTranslation || '').trim()) return row;
                    return { ...row, sentenceTranslation: byWordTranslation.get(w)! };
                  })
                );
              }
            }
          }
        }
      }
    } catch (err: any) {
      toast.error(`Sentence generation failed: ${err?.message ?? String(err)}`);
    } finally {
      setImportSentenceLoading(false);
      setImportEnhanceProgress((p) => Math.max(p, 45));
    }

    if (importEnhanceAddTranslation) {
      setImportEnhanceProgress((p) => Math.max(p, 55));
      if (
        importEnhanceTranslateExistingGlossary &&
        importExistingGlossaryLang &&
        importExistingGlossaryLang !== displayTargetLang
      ) {
        const selected = new Set(importSelectedRowIds);
        const candidates = importRows.filter((r) => {
          if (r.inDeck || !selected.has(r.rowId)) return false;
          const g = String(r.translation || "").trim();
          if (!g) return false;
          const lang = detectLatinGlossaryLang(g);
          if (!lang) return false;
          return lang !== displayTargetLang;
        });

        if (candidates.length > 0 && importHasDeeplKey) {
          setImportTranslateLoading(true);
          try {
            const res = await fetch('/api/tokenize/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                texts: candidates.map((r) => String(r.translation || "")),
                target_lang: displayTargetLang,
              }),
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            const translations: string[] = Array.isArray(data?.translations) ? data.translations : [];
            const byId = new Map<number, string>();
            for (let i = 0; i < candidates.length; i += 1) {
              const next = String(translations[i] ?? '').trim();
              if (next) byId.set(candidates[i].rowId, next);
            }
            if (byId.size > 0) {
              setImportRows((prev) => prev.map((r) => (byId.has(r.rowId) ? { ...r, translation: byId.get(r.rowId)! } : r)));
            }
          } catch (err) {
          } finally {
            setImportTranslateLoading(false);
          }
        }
      }
      await handleImportTranslate(displayTargetLang);
      setImportEnhanceProgress((p) => Math.max(p, 75));
    }

    if (importEnhanceAddAudio) {
      try {
        setImportEnhanceProgress((p) => Math.max(p, 85));
        setImportAudioLoading(true);
        const payload = selectedRows
          .map((r) => {
            if (String(r.audioFilename || '').trim()) return null;
            const text = importEnhanceAudioSource === 'reading' ? String(r.reading || '') : String(r.entry || '');
            return { rowId: r.rowId, text: String(text).trim() };
          })
          .filter((x): x is { rowId: number; text: string } => Boolean(x && x.text));
        if (payload.length > 0) {
          const res = await fetch('/api/tts/generate-text-audio-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: payload }),
          });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          const results = Array.isArray(data?.results) ? data.results : [];
          const byRowId = new Map<number, string>();
          for (const r of results) {
            const rowId = Number(r?.rowId);
            const filename = String(r?.filename ?? '').trim();
            if (!Number.isFinite(rowId) || !filename) continue;
            byRowId.set(rowId, filename);
          }
          setImportRows((prev) =>
            prev.map((r) =>
              byRowId.has(r.rowId) && !String(r.audioFilename || '').trim()
                ? { ...r, audioFilename: byRowId.get(r.rowId)! }
                : r
            )
          );
        }
      } catch (err: any) {
        toast.error(`Audio generation failed: ${err?.message ?? String(err)}`);
      } finally {
        setImportAudioLoading(false);
        setImportEnhanceProgress((p) => Math.max(p, 95));
      }
    }

    setImportEnhanceProgress(100);
    toast.success('Enhancements applied to preview.');
    setImportEnhanceConfirmOpen(false);
    setImportStage('enrichment');
  }, [
    importEnhancementsSelected,
    importEnhancementsBlocked,
    importLoading,
    importTranslateLoading,
    importSentenceLoading,
    importAudioLoading,
    importSelectedRowIds,
    importRows,
    importEnhanceGenerateSentences,
    importEnhanceIncludeSentence,
    importEnhanceIncludeSentenceTranslation,
    importEnhanceIncludeSentenceAudio,
    importEnhanceSentenceAudioVoiceName,
    importEnhanceTargetLang,
    importEnhanceAddTranslation,
    importEnhanceTranslateExistingGlossary,
    importExistingGlossaryLang,
    displayTargetLang,
    detectLatinGlossaryLang,
    importHasDeeplKey,
    importEnhanceAddAudio,
    importEnhanceAudioSource,
    handleImportTranslate,
  ]);
  const IMPORT_TABLE_ROW_HEIGHT_PX = 60;
  const importTableScrollRef = useRef<HTMLDivElement | null>(null);
  const importTableScrollRafRef = useRef<number | null>(null);
  const [importTableScrollTop, setImportTableScrollTop] = useState(0);
  const [importTableViewportHeight, setImportTableViewportHeight] = useState(0);

  useEffect(() => {
    const el = importTableScrollRef.current;
    if (!el) return;

    const update = () => {
      setImportTableViewportHeight(el.clientHeight || 0);
    };

    update();

    if (typeof (globalThis as any).ResizeObserver !== 'function') {
      window.addEventListener('resize', update);
      return () => {
        window.removeEventListener('resize', update);
      };
    }

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [importDialogOpen, importRows.length]);

  useEffect(() => {
    const el = importTableScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    setImportTableScrollTop(0);
  }, [
    importDialogOpen,
    importRows.length,
    importJlptSort,
    importShowAllRecords,
    importSelectedTags,
    importSelectedJlptLevels,
  ]);

  useEffect(() => {
    return () => {
      if (importTableScrollRafRef.current != null) {
        cancelAnimationFrame(importTableScrollRafRef.current);
        importTableScrollRafRef.current = null;
      }
    };
  }, []);

  const importVirtualRange = useMemo(() => {
    const total = sortedFilteredImportRows.length;
    if (total === 0) {
      return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
    }

    const viewport = importTableViewportHeight || 0;
    const overscan = 6;
    const start = Math.max(0, Math.floor(importTableScrollTop / IMPORT_TABLE_ROW_HEIGHT_PX) - 3);
    const visibleCount = Math.ceil(viewport / IMPORT_TABLE_ROW_HEIGHT_PX) + overscan;
    const end = Math.min(total, start + Math.max(visibleCount, 1));
    const topSpacer = start * IMPORT_TABLE_ROW_HEIGHT_PX;
    const bottomSpacer = (total - end) * IMPORT_TABLE_ROW_HEIGHT_PX;
    return { start, end, topSpacer, bottomSpacer };
  }, [sortedFilteredImportRows.length, importTableViewportHeight, importTableScrollTop, IMPORT_TABLE_ROW_HEIGHT_PX]);

  const visibleImportRows = useMemo(() => {
    return sortedFilteredImportRows.slice(importVirtualRange.start, importVirtualRange.end);
  }, [sortedFilteredImportRows, importVirtualRange.start, importVirtualRange.end]);

  const importAllFilteredSelected = useMemo(() => {
    if (sortedFilteredImportRows.length === 0) return false;
    for (const r of sortedFilteredImportRows) {
      if (!importSelectedRowIdSet.has(r.rowId)) return false;
    }
    return true;
  }, [sortedFilteredImportRows, importSelectedRowIdSet]);

  const importHeaderChecked =
    sortedFilteredImportRows.length > 0 && (importSelectAllFiltered || importAllFilteredSelected);
  const prevImportHeaderCheckedRef = useRef(false);

  useLayoutEffect(() => {
    const visibleIds = sortedFilteredImportRows.map((r) => r.rowId);
    if (prevImportHeaderCheckedRef.current) {
      setImportSelectedRowIds(visibleIds);
      setImportSelectAllFiltered(true);
      return;
    }
    setImportSelectAllFiltered(false);
  }, [sortedFilteredImportRows]);

  useEffect(() => {
    prevImportHeaderCheckedRef.current = importHeaderChecked;
  }, [importHeaderChecked]);

  useEffect(() => {
    if (sortedFilteredImportRows.length === 0) return;
    if (!importAllFilteredSelected) return;
    setImportSelectAllFiltered(true);
  }, [importAllFilteredSelected, sortedFilteredImportRows.length]);

  const isMobile = useIsMobile();

  const getSortLabel = (type: 'asc' | 'desc') => {
    if (currentLanguage === 'jp') {
      return type === 'asc' ? t('Ascending (あ -> ん)') : t('Descending (ん -> あ)');
    }
    // Placeholders for other languages could be added here
    return type === 'asc' ? t('Ascending (A -> Z)') : t('Descending (Z -> A)');
  };

    // UI rendering starts here with the dark theme applied previously
    return (
      <div
        data-component="WordGrid"
        data-deck={deckName ?? undefined}
        className={`flex flex-col p-6 transition-colors duration-300 ${isMobile ? '' : 'border-r'}`}
        ref={containerRef}
        style={{ 
          background: `linear-gradient(to bottom right, var(--anki-bg-start), var(--anki-bg-end))`,
          borderColor: `var(--anki-border)` 
        }}
      >
        <div data-section="header" className="mb-6">
          {/* Header Section with Title and Reload Button */}
          <div className="flex items-center justify-between mb-4">
            <h1 data-component="anki-flashcards-title" className="text-[var(--anki-text-main)] font-bold text-xl">{t("Anki Flashcards")}</h1>
            
            <button
              onClick={handleManualRefresh}
              disabled={loading || loadingDecks}
              data-action="refresh-anki-connection"
              data-component="refresh-anki-connection-button"
              className={`
                p-2 rounded-full transition-all duration-200
                ${loading || loadingDecks 
                  ? 'text-blue-400 opacity-50' 
                  : 'text-slate-400 hover:text-white hover:bg-white/10 active:scale-95'}
              `}
              title={t("Reload Anki Connection")}
            >
              <RotateCw 
                className={`size-5 ${loading || loadingDecks ? 'animate-spin' : ''}`} 
              />
            </button>
          </div>
          
          {/* Combobox Implementation */}
          <div className="flex items-center gap-3 mb-2">
            <label data-component="select-deck-label" htmlFor="deck-select" className="text-sm text-[var(--anki-text-muted)]">
              {t("Select deck:")}
            </label>
            <select
              id="deck-select"
              data-control="deck-select"
              data-component="deck-select"
              value={deckName || ''}
              onChange={handleDeckChange}
              disabled={loadingDecks}
              className="w-full p-2.5 rounded-lg border border-[var(--anki-border)] bg-[var(--anki-input-bg)] text-[var(--anki-text-main)] focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
            >
              {loadingDecks ? (
                <option data-component="deck-select-loading-option" value="">{t("Loading decks...")}</option>
              ) : deckError ? (
                <option data-component="deck-select-error-option" value="">
                  {String(deckError).includes('404') ? t("No Decks found") : t("Error fetching decks")}
                </option>
              ) : (
                <>
                  <option data-component="deck-select-placeholder-option" value="">{t("-- Select a deck --")}</option>
                  {deckNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="flex items-center justify-between mb-3 min-h-[36px]">
            {deckName && !loading ? (
              <>
                <div className="flex items-center gap-2">
                  <span data-component="detected-language-label" className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {t("Detected Language:")}
                  </span>
                  <span
                    data-component="detected-language-value"
                    className={`px-2 py-1 rounded text-xs font-bold border ${
                      hasConnectionError
                        ? 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                        : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}
                  >
                    {hasConnectionError ? '-' : getLanguageName(currentLanguage)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {hasConnectionError ? (
                    <div className="w-auto h-9 px-2 bg-[var(--anki-input-bg)] border border-[var(--anki-border)] text-[var(--anki-text-muted)] text-xs rounded-md flex items-center gap-2 opacity-60 cursor-not-allowed">
                      <GridIcons size={cardsPerPage} />
                      <span>-</span>
                    </div>
                  ) : (
                    <Select
                      value={cardsPerPage.toString()}
                      onValueChange={(v) => {
                        onCardsPerPageChange?.(parseInt(v));
                      }}
                      onOpenChange={(open) => {
                        setGridSizeSelectOpen(open);
                      }}
                    >
                      {gridSizeSelectOpen ? (
                        <SelectTrigger className="w-auto h-9 px-2 bg-[var(--anki-input-bg)] border-[var(--anki-border)] text-[var(--anki-text-main)] text-xs">
                          <div className="flex items-center gap-2">
                            <GridIcons size={parseInt(cardsPerPage.toString())} />
                            <SelectValue placeholder={t("Size")} />
                          </div>
                        </SelectTrigger>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SelectTrigger className="w-auto h-9 px-2 bg-[var(--anki-input-bg)] border-[var(--anki-border)] text-[var(--anki-text-main)] text-xs">
                              <div className="flex items-center gap-2">
                                <GridIcons size={parseInt(cardsPerPage.toString())} />
                                <SelectValue placeholder={t("Size")} />
                              </div>
                            </SelectTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="center" sideOffset={6}>
                            {t("wordGrid.displayingItems", { n: cardsPerPage })}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <SelectContent className="bg-slate-900 border-slate-700">
                        <SelectItem value="16" className="text-xs text-slate-300 focus:bg-slate-800">16</SelectItem>
                        <SelectItem value="25" className="text-xs text-slate-300 focus:bg-slate-800">25</SelectItem>
                        <SelectItem value="50" className="text-xs text-slate-300 focus:bg-slate-800">50</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </>
            ) : (
              <p data-component="deck-load-hint" className="text-slate-500 text-sm">
                {deckError || cardsError ? (
                  t("common.errorWithMessage", { error: String(deckError || cardsError) })
                ) : (
                  t("Select a deck above to load cards.")
                )}
              </p>
            )}
          </div>
          {/* Search Bar and Filter - Adapted for Dark Theme */}
          <div className="relative z-10 flex items-center gap-2 mb-3">
            {bulkMode ? (
              <div
                data-bulk-selection-controls="true"
                className="flex-1 flex items-center justify-between gap-2 rounded-lg border border-[var(--anki-border)] bg-[var(--anki-input-bg)] px-3 py-2.5"
              >
                <Popover open={bulkActionsOpen} onOpenChange={setBulkActionsOpen}>
                  <PopoverTrigger asChild>
                    <button data-component="bulk-selection-summary-button" className="text-sm text-[var(--anki-text-main)] hover:text-white">
                      {t("wordGrid.itemsSelected", { n: bulkSelectedCount })}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="bottom" align="start" sideOffset={8} className="w-56 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]">
                    <button
                      data-component="bulk-add-missing-data-button"
                      onClick={() => {
                        setBulkAddMissingOpen(true);
                        setBulkActionsOpen(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-md text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                    >
                      {t("Add Missing Data")}
                    </button>
                    <button
                      data-component="bulk-clear-fields-button"
                      onClick={() => {
                        setBulkAddMissingOpen(true);
                        setBulkActionTab('clear_fields');
                        setBulkConfirmClearOpen(true);
                        setBulkActionsOpen(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-md text-sm text-slate-200 hover:bg-slate-800 transition-colors"
                    >
                      {t("Clear Fields")}
                    </button>
                  </PopoverContent>
                </Popover>

                <div className="flex items-center gap-3">
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        selectAllDisplayed();
                      }}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      {t("Select entire page")}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="ml-1 rounded px-1 py-1 text-slate-400 hover:text-white hover:bg-white/10"
                          aria-label={t("More select options")}
                        >
                          <ChevronDown className="size-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        sideOffset={8}
                        className="w-44 bg-slate-900 border border-slate-700 text-slate-100"
                      >
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            void selectAllDeckIds();
                          }}
                          disabled={!deckName || bulkSelectAllDeckLoading}
                          className={`${!deckName || bulkSelectAllDeckLoading ? 'opacity-50' : ''}`}
                        >
                          {bulkSelectAllDeckLoading ? t("Working...") : t("Select All")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      clearBulkSelection();
                    }}
                    className="text-slate-400 hover:text-white"
                    aria-label={t("Clear selection")}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder={t("Search words…")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="
                    w-full px-3 py-2.5 pr-9 text-sm rounded-lg border 
                    border-[var(--anki-border)] bg-[var(--anki-input-bg)] 
                    text-[var(--anki-text-main)] placeholder:text-slate-500 
                    focus:ring-2 focus:ring-blue-500 outline-none
                  "
                />
                {searchQuery ? (
                  <button 
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="size-4" />
                  </button>
                ) : (
                  <Search
                    className="
                      absolute right-3 top-1/2 -translate-y-1/2
                      size-4 text-slate-400
                      pointer-events-none
                    "
                  />
                )}
              </div>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <button
                  className={`
                    p-2.5 rounded-lg border transition-all duration-200
                    ${filters.length > 0 
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400' 
                      : 'border-[var(--anki-border)] bg-[var(--anki-input-bg)] text-slate-400 hover:text-white hover:bg-white/10'}
                  `}
                  title={t("Filter & Sort")}
                >
                  <Filter className="size-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" sideOffset={10} className="w-64 bg-slate-900 border-slate-700 p-4 shadow-2xl z-[100]">
                <div className="space-y-4">
                  <div>
                    <h3 data-component="sorting-title" className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t("Sorting")}</h3>
                    <div className="space-y-1">
                      {[
                        { id: 'most_recent', label: t('Most Recent') },
                        { id: 'oldest', label: t('Oldest') },
                        { id: 'asc', label: getSortLabel('asc') },
                        { id: 'desc', label: getSortLabel('desc') },
                      ].map((s) => (
                        <button
                          key={s.id}
                          onClick={() => onSortChange?.(s.id)}
                          data-component="sort-option-button"
                          data-sort={s.id}
                          className={`
                            w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors
                            ${sort === s.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}
                          `}
                        >
                          {s.label}
                          {sort === s.id && <Check className="size-4" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-slate-800 pt-3">
                    <h3 data-component="filters-title" className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t("Filters")}</h3>
                    <div className="space-y-2">
                      {visibleFilterGroups.map((g) => {
                          const mode = getFilterGroupMode(g.missingId, g.containsId);
                          return (
                            <div key={g.id} data-component="filter-group" data-filter-group={g.id} className="w-full">
                              <div className="flex w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFilterGroupState({
                                      missingId: g.missingId,
                                      containsId: g.containsId,
                                      enabled: true,
                                      mode: 'missing',
                                    })
                                  }
                                  disabled={!onFiltersChange}
                                  data-component="filter-group-missing-button"
                                  className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                                    mode === 'missing'
                                      ? `bg-slate-800 ${g.missingColor}`
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                                  } ${!onFiltersChange ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                  {t(g.missingLabel)}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFilterGroupState({
                                      missingId: g.missingId,
                                      containsId: g.containsId,
                                      enabled: false,
                                    })
                                  }
                                  disabled={!onFiltersChange}
                                  data-component="filter-group-off-button"
                                  className={`w-[64px] px-2 py-2 text-[11px] font-semibold transition-colors border-l border-r border-slate-800 ${
                                    mode == null
                                      ? 'bg-slate-800 text-slate-200'
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                                  } ${!onFiltersChange ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                  {t("Off")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFilterGroupState({
                                      missingId: g.missingId,
                                      containsId: g.containsId,
                                      enabled: true,
                                      mode: 'contains',
                                    })
                                  }
                                  disabled={!onFiltersChange}
                                  data-component="filter-group-contains-button"
                                  className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                                    mode === 'contains'
                                      ? `bg-slate-800 ${g.containsColor}`
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                                  } ${!onFiltersChange ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                  {t(g.containsLabel)}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {filters.length > 0 && (
                    <button
                      onClick={() => onFiltersChange?.([])}
                      data-component="clear-all-filters-button"
                      className="w-full py-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors border-t border-slate-800 mt-2 pt-2"
                    >
                      {t("Clear all filters")}
                    </button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        
        {/* Word Grid Area */}
        <div className="flex flex-col flex-1">
          <div className="pr-2">
            {!deckName && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
                <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
                  <Inbox className="size-8 text-slate-400" />
                </div>
                <p data-component="ready-to-load-title" className="text-[var(--anki-text-main)] font-medium mb-2">{t("Ready to load cards")}</p>
                <p data-component="ready-to-load-description" className="text-sm text-slate-500 max-w-[200px]">{t("Select a deck from the dropdown above to begin.")}</p>
              </div>
            )}
          {loading ? (
            /* 1. Loading State */
            <p data-component="cards-loading" className="text-[var(--anki-text-muted)] animate-pulse">{t("Loading cards...")}</p>
          ) : showConnectionEmptyState ? (
            /* 2. Connection / Global Empty State */
            <div className="w-full flex justify-center">
              <div className="text-center p-8 border-2 border-dashed border-[var(--anki-border)] rounded-2xl bg-white/5 w-full max-w-2xl">
                <Inbox className="size-12 text-[var(--anki-border)] mx-auto mb-4" />
                <p data-component="connection-empty-title" className="text-[var(--anki-text-main)] font-medium mb-2">{t("Nothing to display here.")}</p>
                <p data-component="connection-empty-description" className="text-[var(--anki-text-muted)] text-sm">
                  {(() => {
                    const msg = t("Make sure Anki is launched and AnkiConnect is present.");
                    const parts = String(msg).split("AnkiConnect");
                    if (parts.length !== 2) return msg;
                    return (
                      <>
                        {parts[0]}
                        <a
                          href="https://ankiweb.net/shared/info/2055492159"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4 text-blue-400 hover:text-blue-300"
                        >
                          AnkiConnect
                        </a>
                        {parts[1]}
                      </>
                    );
                  })()}
                </p>
              </div>
            </div>
          ) : showFilteredEmptyState ? (
            /* 3. Filters returned nothing */
            <div className="w-full flex justify-center">
              <div className="text-center p-8 border-2 border-dashed border-[var(--anki-border)] rounded-2xl bg-white/5 w-full max-w-2xl">
                <Inbox className="size-12 text-[var(--anki-border)] mx-auto mb-4" />
                <p data-component="filtered-empty-title" className="text-[var(--anki-text-main)] font-medium mb-2">{t("No cards found for this filter.")}</p>
                <p data-component="filtered-empty-description" className="text-[var(--anki-text-muted)] text-sm">{t("Make sure you select a matching filtering criteria for your cards.")}</p>
              </div>
            </div>
          ) : showDeckEmptyState ? (
            /* 4. Deck has no cards */
            <div className="w-full flex justify-center">
              <div className="text-center p-8 border-2 border-dashed border-[var(--anki-border)] rounded-2xl bg-white/5 w-full max-w-2xl">
                <Inbox className="size-12 text-[var(--anki-border)] mx-auto mb-4" />
                <p data-component="deck-empty-title" className="text-[var(--anki-text-main)] font-medium mb-2">{t("No cards found in this deck.")}</p>
                <p data-component="deck-empty-description" className="text-[var(--anki-text-muted)] text-sm">{t("Try adding cards or selecting another deck.")}</p>
              </div>
            </div>
          ) : searchQuery && filteredCards.length === 0 ? (
            /* 5. Search Results Empty State */
            <div className="text-center p-8 animate-in fade-in zoom-in-95 duration-300">
              <Search className="size-10 text-slate-600 mx-auto mb-3 opacity-20" />
              <p data-component="search-empty-title" className="text-slate-400 font-medium">{t("No results found")}</p>
              <p data-component="search-empty-description" className="text-slate-500 text-xs mt-1">{t("Try a different search term")}</p>
            </div>
          ): (
            <div
              ref={gridDragContainerRef}
              onPointerDown={handleGridPointerDown}
              onPointerMove={handleGridPointerMove}
              onPointerUp={handleGridPointerUp}
              onPointerCancel={handleGridPointerCancel}
              className="relative z-0 -m-6 p-6 select-none"
            >
              {gridDragBox ? (
                <div
                  className="pointer-events-none absolute z-10 rounded border border-blue-400 bg-blue-500/20"
                  style={{
                    left: gridDragBox.left,
                    top: gridDragBox.top,
                    width: gridDragBox.width,
                    height: gridDragBox.height,
                  }}
                />
              ) : null}

              <div
                className={`grid w-full ${cardsPerPage >= 50 ? 'gap-2' : 'gap-3'}`}
                style={{
                  gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`
                }}
              >
                {displayCards.map((word, index) => {
                  const actualNoteId = cardByWord.get(word)?.noteId;
                  
                  // Stable key logic: Use noteId if available, then word + local index as fallback
                  const key =
                    actualNoteId != null
                      ? `nid-${actualNoteId}`
                      : internalMode
                        ? `card-${word}-${index}`
                        : `word-${index}`;
                  const selectionKey = getSelectionKey(word, index, actualNoteId);

                  //console.log("Does this "+ word+ "have global index?"+ globalIndex);
                  //console.log("actual Id: "+ cards[globalIndex]?.noteId); //This is the noteId from Anki
                  //actualNoteId === selectedNoteId
                  
                  return (
                    <button
                      key={key}
                      ref={(el) => {
                        if (!el) {
                          gridItemElsRef.current.delete(selectionKey);
                          return;
                        }
                        gridItemElsRef.current.set(selectionKey, el);
                      }}
                      data-grid-item="true"
                      onClick={(e) => handleGridClick(e, index, word, actualNoteId)}
                      className={`
                        select-none
                        ${cardsPerPage >= 50 ? 'min-h-[2.5rem]' : 'min-h-[3rem]'} flex items-center justify-center rounded-xl
                        transition-all duration-200 border
                        ${
                          bulkMode && bulkSelectedKeys.has(selectionKey)
                            ? 'bg-blue-600/40 border-blue-400 text-white shadow-lg shadow-blue-900/20'
                            : !bulkMode && selected === index
                              ? 'bg-blue-500 text-white border-blue-500/20'
                              : 'bg-[var(--anki-bg-card)] border-[var(--anki-border)] text-[var(--anki-text-main)] hover:bg-slate-700'
                        }
                      `}
                    >
                      <span
                        className={`text-center px-1 ${cardsPerPage >= 50 ? 'text-xs' : 'text-sm'} font-medium`}
                      >
                        {word}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </div>
        </div>
        
        {/* Footer Navigation */}
        <div className="relative z-10 flex flex-col gap-2 mt-6">
          <div className="flex gap-2">
            {/*
              When searching, we page over the filteredCards within WordGrid itself.
              In that mode (or in internalMode), prev/next are based on internalPage/totalPages.
              Otherwise, we defer to hasPrevious/hasNext from the parent.
            */}
            {(() => {
              const canNavigate = Boolean(deckName && !loading && !hasConnectionError);
              const canGoPrev = canNavigate && (internalMode || searchActive ? internalPage > 0 : !!hasPrevious);
              const canGoNext = canNavigate && (internalMode || searchActive ? internalPage < totalPages - 1 : !!hasNext);
              return (
                <>
                  <button
                    onClick={handlePrev}
                    disabled={!canGoPrev}
                    className={`
                      flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                      transition-all duration-200 font-medium
                      ${
                        canGoPrev
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      }
                    `}
                  >
                    <ChevronLeft className="size-5" />
                    {t("Previous")}
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={!canGoNext}
                    className={`
                      flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg
                      transition-all duration-200 font-medium
                      ${
                        canGoNext
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      }
                    `}
                  >
                    {t("Next")}
                    <ChevronRight className="size-5" />
                  </button>
                </>
              );
            })()}
          </div>

          {deckName && !loading && !hasConnectionError ? (
            <div className="flex justify-end pr-1">
              <div data-component="x-cards-found-deck" className="text-[11px] text-slate-500">
                {filters.length > 0
                  ? t("wordGrid.cardsFoundForFiltering", { n: totalDeckCards })
                  : t("wordGrid.cardsFoundOnDeck", { n: totalDeckCards })}
              </div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => void handleOpenBulkActions()}
                  disabled={!deckName || bulkDeckLoading || hasConnectionError}
                  data-component="open-bulk-actions-button"
                  className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                    deckName && !bulkDeckLoading && !hasConnectionError
                      ? bulkMode
                        ? 'bg-blue-900 text-white hover:bg-blue-800 shadow-md'
                        : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  }`}
                  title={t("Bulk Actions")}
                >
                  <BulkEditIcon className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("Bulk Actions")}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setImportDialogOpen(true)}
                  disabled={!deckName || hasConnectionError}
                  data-component="open-import-dialog-button"
                  className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${
                    deckName && !hasConnectionError
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  }`}
                  title={t("Add cards from file")}
                >
                  <FilePlus2 className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("Add cards from file")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Import File Dialog */}
        <Dialog
          open={importDialogOpen}
          onOpenChange={(open) => {
            if (open) {
              setImportDialogOpen(true);
              setImportStage('import');
              return;
            }
            requestCloseImportDialog();
          }}
        >
          <DialogContent
            data-component="import-dialog"
            className="w-[95vw] sm:max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden flex flex-col text-sm"
          >

            {/* HEADER */}
            <DialogHeader data-component="import-dialog-header" className="relative pb-2 border-b border-slate-800">

              <DialogTitle data-component="import-dialog-title" className="text-lg pr-10">
                {t("Import Cards")}
              </DialogTitle>

              <button
                type="button"
                onClick={requestCloseImportDialog}
                data-component="import-dialog-close-button"
                className="absolute right-3 top-3 h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                aria-label={t("Close import dialog")}
              >
                <X className="size-3.5" />
              </button>

            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* MAIN CONTENT */}
              <div className="flex flex-col gap-3 py-3">

              {/* ===================================================== */}
              {/* WORKFLOW PANEL */}
              {/* ===================================================== */}

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 space-y-3">

                {/* STAGE INDICATOR */}

                <div className="flex items-center gap-2">

                  {/* STAGE 1 */}
                  <button
                    type="button"
                    onClick={() => setImportStage('import')}
                    data-component="import-stage-button"
                    data-stage="import"
                    className="flex items-center gap-2 group"
                  >
                    <div
                      className={`
                        h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-medium border transition-colors
                        ${
                          importStage === 'import'
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : importRows.length > 0
                              ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                              : 'bg-slate-800 border-slate-700 text-slate-400'
                        }
                      `}
                    >
                      1
                    </div>

                    <span
                      data-component="import-stage-label"
                      className={`
                        text-xs transition-colors
                        ${
                          importStage === 'import'
                            ? 'text-white'
                            : 'text-slate-400 group-hover:text-slate-200'
                        }
                      `}
                    >
                      {t("Import")}
                    </span>
                  </button>

                  <div className="h-px flex-1 max-w-8 bg-slate-700" />

                  {/* STAGE 2 */}
                  <button
                    type="button"
                    onClick={() => setImportStage('enrichment')}
                    disabled={importRows.length === 0}
                    data-component="import-stage-button"
                    data-stage="enrichment"
                    className="flex items-center gap-2 group disabled:opacity-40"
                  >
                    <div
                      className={`
                        h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-medium border transition-colors
                        ${
                          importStage === 'enrichment'
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }
                      `}
                    >
                      2
                    </div>

                    <span
                      data-component="import-stage-label"
                      className={`
                        text-xs transition-colors
                        ${
                          importStage === 'enrichment'
                            ? 'text-white'
                            : 'text-slate-400 group-hover:text-slate-200'
                        }
                      `}
                    >
                      {t("Enrichment")}
                    </span>
                  </button>

                </div>

                {/* ===================================================== */}
                {/* ACTIVE STAGE CONTENT */}
                {/* ===================================================== */}

                <div className="min-h-[72px]">

                  {/* ===================================================== */}
                  {/* STAGE 1 - IMPORT */}
                  {/* ===================================================== */}

                  {importStage === 'import' && (
                    <div className="flex items-center justify-between gap-3 flex-wrap">

                      <div className="flex items-center gap-3">

                        <button
                          type="button"
                          onClick={() => importFileInputRef.current?.click()}
                          disabled={!deckName || hasConnectionError || importLoading}
                          data-component="import-choose-file-button"
                          className={`px-3 py-1.5 rounded-lg border transition-colors text-xs ${
                            !deckName || hasConnectionError || importLoading
                              ? 'bg-slate-700 border-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
                          }`}
                        >
                          {t("import.chooseFile")}
                        </button>

                        <input
                          ref={importFileInputRef}
                          type="file"
                          accept=".csv,.txt,.json,application/json,text/plain,text/csv"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.currentTarget.value = '';

                            if (f) {
                              void handleImportFileSelect(f);
                            }
                          }}
                          disabled={!deckName || hasConnectionError || importLoading}
                          className="hidden"
                        />

                        <div data-component="import-selected-file-name" className="text-xs text-slate-300">
                          {importFileName || t("import.noFileSelected")}
                        </div>

                      </div>

                      {importRows.length > 0 && (
                        <div className="text-xs text-slate-400 flex items-center gap-4">
                          <span data-component="import-entries-count">{t("import.entriesCount", { n: sortedFilteredImportRows.length })}</span>
                          <span data-component="import-duplicates-count">
                            {t("import.duplicatesCount", { n: importDuplicateRows.length || importDuplicateCount })}
                          </span>
                        </div>
                      )}

                    </div>
                  )}

                  {/* ===================================================== */}
                  {/* STAGE 2 - ENRICHMENT */}
                  {/* ===================================================== */}

                  {importStage === 'enrichment' && (
                      <div className="space-y-3">

                    <div className="flex flex-wrap items-center gap-3">
                      <Popover open={importEnrichmentOpen} onOpenChange={setImportEnrichmentOpen}>
                        <div className="inline-flex items-stretch">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-200 border border-slate-700 bg-slate-900 px-2.5 py-1 rounded-l-md">
                            <input
                              type="checkbox"
                              checked={importEnhanceAddContent}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setImportEnhanceAddContent(next);
                                if (next) {
                                  setImportEnhanceAddTranslation(
                                    showGlossaryField && importHasDeeplKey && importVisibleMissingCounts.glossary > 0
                                  );
                                  setImportEnhanceAddAudio(
                                    showExpressionAudioField && importHasAzureKey && importVisibleMissingCounts.entryAudio > 0
                                  );

                                  const wantsSentence =
                                    (showSentenceField && importVisibleMissingCounts.sentence > 0) ||
                                    (showTranslationField && importVisibleMissingCounts.translation > 0) ||
                                    (showSentenceAudioField && importVisibleMissingCounts.sentenceAudio > 0);
                                  const wantsTranslation =
                                    showTranslationField && importVisibleMissingCounts.translation > 0;
                                  const wantsSentenceAudio =
                                    showSentenceAudioField &&
                                    importVisibleMissingCounts.sentenceAudio > 0 &&
                                    importTtsVoiceOptions.length > 0;

                                  setImportEnhanceIncludeSentence(wantsSentence);
                                  setImportEnhanceIncludeSentenceTranslation(wantsTranslation);
                                  setImportEnhanceIncludeSentenceAudio(wantsSentenceAudio);
                                  setImportEnhanceGenerateSentences(wantsSentence || wantsTranslation || wantsSentenceAudio);
                                } else {
                                  setImportEnhanceAddTranslation(false);
                                  setImportEnhanceAddAudio(false);
                                  setImportEnhanceIncludeSentence(false);
                                  setImportEnhanceIncludeSentenceTranslation(false);
                                  setImportEnhanceIncludeSentenceAudio(false);
                                  setImportEnhanceGenerateSentences(false);
                                  setImportEnrichmentOpen(false);
                                  setImportExistingGlossaryLang(null);
                                  setImportEnhanceTranslateExistingGlossary(false);
                                }
                              }}
                              disabled={importLoading || importTranslateLoading || importSentenceLoading || importAudioLoading}
                              className="h-4 w-4 accent-blue-600"
                            />
                            <span>{t("Enrichment")}</span>
                          </label>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              disabled={!importEnhanceAddContent}
                              onClick={(e) => e.stopPropagation()}
                              className={`inline-flex items-center justify-center rounded-r-md border border-l-0 border-slate-700 bg-slate-900 px-2 py-1 text-xs transition-colors ${
                                importEnhanceAddContent ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-600 cursor-not-allowed'
                              }`}
                              aria-label={t("Enrichment")}
                              title={t("Enrichment")}
                            >
                              <ChevronDown className="size-3.5" />
                            </button>
                          </PopoverTrigger>
                        </div>

                        <PopoverContent
                          align="start"
                          className="w-96 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                          sideOffset={8}
                        >
                          <div className={`space-y-1 ${importEnhanceAddContent ? '' : 'opacity-50 pointer-events-none'}`}>

                            {showGlossaryField ? (
                            <label className="flex items-start justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200 cursor-pointer">
                              <span className="flex items-start gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={importEnhanceAddTranslation}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setImportEnhanceAddTranslation(next);
                                    setImportGlossaryExpandOpen(false);
                                    if (!next) {
                                      setImportExistingGlossaryLang(null);
                                      setImportEnhanceTranslateExistingGlossary(false);
                                      return;
                                    }
                                    const inferred = inferImportExistingGlossaryLang();
                                    setImportExistingGlossaryLang(inferred);
                                    setImportEnhanceTranslateExistingGlossary(false);
                                  }}
                                  disabled={!importHasDeeplKey}
                                />
                                <span className="min-w-0">
                                  <div className="truncate">{t("Add Glossary")}</div>
                                  <div className="text-[11px] text-slate-400">
                                    {t("Translate to {{language}}", {
                                      language: displayTargetLang === "pt-BR" ? t("Portuguese (Brazil)") : t("English (US)"),
                                    })}
                                  </div>
                                </span>
                              </span>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-rose-500/10 text-rose-200 border border-rose-500/20 shrink-0">
                                  {(importGlossaryExpandOpen && importEnhanceTranslateExistingGlossary
                                    ? importVisibleTranslateExistingCounts.glossary
                                    : importVisibleMissingCounts.glossary)}{' '}
                                  {t("Pending")}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setImportGlossaryExpandOpen((v) => !v);
                                    if (!importEnhanceAddTranslation) setImportEnhanceAddTranslation(true);
                                    if (importExistingGlossaryLang == null) {
                                      const inferred = inferImportExistingGlossaryLang();
                                      setImportExistingGlossaryLang(inferred);
                                    }
                                  }}
                                  className="inline-flex items-center justify-center rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5"
                                  aria-label="Options"
                                  title="Options"
                                >
                                  <ChevronRight className="size-4" />
                                </button>
                                {!importHasDeeplKey ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-[11px] text-amber-300"
                                    title={t("DeepL API key is missing. Configure it in Settings → API Keys.")}
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </span>
                                ) : null}
                              </span>
                            </label>
                            ) : null}

                            {importGlossaryExpandOpen &&
                            importEnhanceAddTranslation &&
                            importExistingGlossaryLang &&
                            importExistingGlossaryLang !== displayTargetLang ? (
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={importEnhanceTranslateExistingGlossary}
                                  onChange={(e) => setImportEnhanceTranslateExistingGlossary(e.target.checked)}
                                />
                                <span className="text-xs text-slate-300">
                                  {t("Translate existing into {{language}}", {
                                    language: displayTargetLang === "pt-BR" ? t("Portuguese (Brazil)") : t("English (US)"),
                                  })}
                                </span>
                              </label>
                            ) : null}

                            {showExpressionAudioField ? (
                            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200">
                              <label className="flex items-center gap-2 cursor-pointer min-w-0 text-xs">
                                <input
                                  type="checkbox"
                                  checked={importEnhanceAddAudio}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setImportEnhanceAddAudio(next);
                                    if (!next) setImportEntryAudioExpandOpen(false);
                                  }}
                                  disabled={!importHasAzureKey}
                                />
                                <span className="truncate">{t("Add Entry Audio")}</span>
                              </label>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-200 border border-blue-500/20 shrink-0">
                                  {importVisibleMissingCounts.entryAudio} {t("Missing")}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setImportEntryAudioExpandOpen((v) => !v);
                                    if (!importEnhanceAddAudio) setImportEnhanceAddAudio(true);
                                  }}
                                  className="inline-flex items-center justify-center rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5"
                                  aria-label="Options"
                                  title="Options"
                                >
                                  <ChevronRight className="size-4" />
                                </button>
                                {!importHasAzureKey ? (
                                  <span
                                    className="inline-flex items-center gap-1 text-[11px] text-amber-300"
                                    title={t("settings.ttsProviderKeyMissing")}
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </span>
                                ) : null}
                              </span>
                            </div>
                            ) : null}

                            {showExpressionAudioField && importEntryAudioExpandOpen ? (
                              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200">
                                <span className="h-4 w-4" aria-hidden="true" />
                                <span className="text-slate-300">{t("Field:")}</span>
                                <select
                                  value={importEnhanceAudioSource}
                                  onChange={(e) => setImportEnhanceAudioSource(e.target.value as any)}
                                  disabled={!importEnhanceAddAudio}
                                  className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-xs text-slate-200"
                                >
                                  <option value="entry">{t("Entry")}</option>
                                  <option value="reading">{t("Reading")}</option>
                                </select>
                              </div>
                            ) : null}

                            {showSentenceField ? (
                            <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200 cursor-pointer">
                              <span className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={importEnhanceIncludeSentence}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setImportEnhanceIncludeSentence(next);
                                    const any = next || importEnhanceIncludeSentenceTranslation || importEnhanceIncludeSentenceAudio;
                                    setImportEnhanceGenerateSentences(any);
                                  }}
                                />
                                <span className="truncate">{t("Add Sentence")}</span>
                              </span>
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-orange-500/10 text-orange-200 border border-orange-500/20 shrink-0">
                                {importVisibleMissingCounts.sentence} {t("Missing")}
                              </span>
                            </label>
                            ) : null}

                            {showTranslationField ? (
                            <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200 cursor-pointer">
                              <span className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={importEnhanceIncludeSentenceTranslation}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    if (next) setImportEnhanceIncludeSentence(true);
                                    setImportEnhanceIncludeSentenceTranslation(next);
                                    const sentenceOn = importEnhanceIncludeSentence || next;
                                    const any = sentenceOn || next || importEnhanceIncludeSentenceAudio;
                                    setImportEnhanceGenerateSentences(any);
                                  }}
                                />
                                <span className="truncate">{t("Add Translation")}</span>
                              </span>
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-200 border border-amber-500/20 shrink-0">
                                {importVisibleMissingCounts.translation} {t("Missing")}
                              </span>
                            </label>
                            ) : null}

                            {showSentenceAudioField ? (
                            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-xs text-slate-200">
                              <label className="flex items-center gap-2 cursor-pointer min-w-0 text-xs">
                                <input
                                  type="checkbox"
                                  checked={importEnhanceIncludeSentenceAudio}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    if (next) setImportEnhanceIncludeSentence(true);
                                    setImportEnhanceIncludeSentenceAudio(next);
                                    const sentenceOn = importEnhanceIncludeSentence || next;
                                    const any = sentenceOn || importEnhanceIncludeSentenceTranslation || next;
                                    setImportEnhanceGenerateSentences(any);
                                  }}
                                  disabled={!importHasAzureKey || importTtsVoiceOptions.length === 0}
                                />
                                <span className="inline-flex items-center gap-2 min-w-0">
                                  <span className="truncate">{t("Add Sentence Audio")}</span>
                                </span>
                              </label>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-200 border border-blue-500/20 shrink-0">
                                  {importVisibleMissingCounts.sentenceAudio} {t("Missing")}
                                </span>
                                {importTtsVoiceOptions.length > 0 ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        disabled={!importEnhanceIncludeSentenceAudio}
                                        onClick={(e) => e.stopPropagation()}
                                        className={`inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs ${
                                          importEnhanceIncludeSentenceAudio
                                            ? 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                                            : 'bg-slate-900 text-slate-600 opacity-50 cursor-not-allowed'
                                        }`}
                                        aria-label={t("Select TTS model for sentence audio")}
                                        title={getTtsVoiceLabel(importEnhanceSentenceAudioVoiceName, importTtsVoiceOptions) || t("Select TTS model for sentence audio")}
                                      >
                                        <Volume2 className="size-3.5" />
                                        <ChevronDown className="size-3" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="end"
                                      sideOffset={8}
                                      className="w-56 bg-slate-900 border border-slate-700 text-slate-100"
                                    >
                                      {importTtsVoiceOptions.map((voice) => (
                                        <DropdownMenuItem
                                          key={voice.id}
                                          onSelect={(e) => {
                                            e.preventDefault();
                                            setImportEnhanceSentenceAudioVoiceName(voice.id);
                                          }}
                                          className="flex items-center justify-between"
                                        >
                                          <span>{voice.label}</span>
                                          {importEnhanceSentenceAudioVoiceName === voice.id ? (
                                            <Check className="size-4" />
                                          ) : null}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : null}
                              </span>
                            </div>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>

                      <div className="flex flex-wrap items-center gap-3">

                        <span className="text-xs text-slate-300">
                          {t("Sentence Mode:")}
                        </span>

                        <select
                          value={importEnhanceSentenceMode}
                          onChange={(e) => setImportEnhanceSentenceMode(e.target.value as any)}
                          className="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-slate-200"
                        >
                          <option value="random">{t("Random")}</option>
                          {/* <option value="most_common">{t("Most Common")}</option> */}
                          {/* <option value="jlpt">{t("JLPT Appropriate")}</option> */}
                        </select>

                      </div>

                      <div className="flex justify-end">

                        <button
                          type="button"
                          onClick={() => setImportEnhanceConfirmOpen(true)}
                          disabled={!importEnhancementsSelected || importEnhancementsBlocked || importLoading || importTranslateLoading || importSentenceLoading || importAudioLoading || importRows.length === 0 || importSelectedRowIds.length === 0}
                          className={`px-3 py-1.5 rounded-lg transition-colors text-xs ${
                            !importEnhancementsSelected ||
                            importEnhancementsBlocked ||
                            importTranslateLoading ||
                            importLoading ||
                            importSentenceLoading ||
                            importAudioLoading ||
                            importRows.length === 0 ||
                            importSelectedRowIds.length === 0
                              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {importTranslateLoading || importSentenceLoading || importAudioLoading
                            ? t("Applying Enhancements...")
                            : t("Apply Enhancements")}
                        </button>

                      </div>

                    </div>
                  )}

                </div>

              </div>

              {/* ===================================================== */}
              {/* PERSISTENT PREVIEW AREA */}
              {/* ===================================================== */}

              <div className="flex flex-col gap-3">

                {importLoading ? (
                  <div data-component="gen-preview" className="text-xs text-slate-400">
                    {t("import.generatingPreview")}
                  </div>
                ) : importRows.length === 0 ? (
                  <div data-component="no-entries-preview-yet" className="text-xs text-slate-400">
                    {t("import.noEntriesToPreview")}
                  </div>
                ) : (
                  <>
                    {/* ===================================================== */}
                    {/* FILTERS */}
                    {/* ===================================================== */}

                    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3">
                      {importAvailableTags.length > 0 ? (
                        <div className="rounded-md border border-slate-800 bg-slate-950/30">
                          <div className="w-full flex items-start justify-between px-3 py-2.5 gap-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setImportTagFiltersExpanded((v) => !v)}
                                className="flex items-center gap-2 text-xs font-medium text-slate-200 select-none hover:text-white"
                                title={importTagFiltersExpanded ? t("import.collapseFilters") : t("import.expandFilters")}
                              >
                                <ChevronDown
                                  className={`size-4 transition-transform ${importTagFiltersExpanded ? 'rotate-180' : 'rotate-0'}`}
                                />
                                <span>{t("Filters")}</span>
                              </button>

                              <div className="flex items-center gap-2 flex-wrap">
                                {importAvailableTags.slice(0, 3).map(({ tag, count }) => {
                                  const active = importSelectedTags.includes(tag);
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => {
                                        setImportShowAllRecords(true);
                                        if (tag === 'REF_PRESENT') {
                                          setImportSelectedJlptLevels(
                                            active ? importJlptAllOptions : importJlptTags.map((t) => t.tag)
                                          );
                                        }
                                        if (tag === 'REF_MISSING') {
                                          setImportSelectedJlptLevels(active ? importJlptAllOptions : [NON_JLPT]);
                                        }
                                        setImportSelectedTags((prev) =>
                                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                                        );
                                      }}
                                      className={`px-2 py-1 rounded-md text-xs transition-colors ${
                                        active
                                          ? 'bg-slate-700 text-white'
                                          : 'bg-white/5 text-slate-400 hover:bg-white/10'
                                      }`}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        {getHumanTagLabel(tag)}
                                        <span className="opacity-60">({count})</span>
                                        {active ? (
                                          <span
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setImportShowAllRecords(true);
                                              if (tag === 'REF_PRESENT') {
                                                setImportSelectedJlptLevels(importJlptAllOptions);
                                              }
                                              if (tag === 'REF_MISSING') {
                                                setImportSelectedJlptLevels(importJlptAllOptions);
                                              }
                                              setImportSelectedTags((prev) => prev.filter((t) => t !== tag));
                                            }}
                                            className="ml-1 inline-flex items-center justify-center rounded hover:bg-white/10"
                                            role="button"
                                            aria-label={`Remove ${getHumanTagLabel(tag)} filter`}
                                            title={t("import.remove")}
                                          >
                                            <X className="size-3" />
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const hasStateFilters = Object.values(importFilters).some((v) => v !== 'any');
                                  const hasJlptFilter =
                                    importSelectedJlptLevels.length > 0 &&
                                    importJlptAllOptions.length > 0 &&
                                    importSelectedJlptLevels.length !== importJlptAllOptions.length;
                                  const hasTagFilters = importSelectedTags.length > 0;
                                  const hasActiveFilters = !importShowAllRecords || hasStateFilters || hasJlptFilter || hasTagFilters;
                                  if (!hasActiveFilters) return null;

                                  return (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setImportSelectedTags([]);
                                        setImportSelectedJlptLevels(importJlptAllOptions);
                                        setImportShowAllRecords(true);
                                        setImportFilters({
                                          sentenceAudio: 'any',
                                          entryAudio: 'any',
                                          sentence: 'any',
                                          translation: 'any',
                                          glossary: 'any',
                                        });
                                      }}
                                      className="text-xs underline underline-offset-4 transition-colors text-slate-400 hover:text-slate-200"
                                      title={t("Clear filters (show all records)")}
                                    >
                                      {t("Display all records")}
                                    </button>
                                  );
                                })()}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setImportSelectedTags([]);
                                    setImportSelectedJlptLevels(importJlptAllOptions);
                                    setImportShowAllRecords(false);
                                  }}
                                  className="h-6 w-6 flex items-center justify-center rounded hover:bg-white/5 text-slate-400 hover:text-slate-200"
                                  title={t("import.hideAllRecordsTitle")}
                                  aria-label={t("import.hideAllRecordsAria")}
                                >
                                  <X className="size-4" />
                                </button>
                              </div>

                              {deckName && importDuplicateRows.length > 0 ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="text-xs underline underline-offset-4 text-slate-400 hover:text-slate-200 whitespace-nowrap"
                                      title={t("import.showDuplicatesAlreadyInDeck")}
                                    >
                                      {t("import.duplicatesExcludedAlreadyInDeck", { n: importDuplicateRows.length, deckName })}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    align="end"
                                    className="w-80 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                                    sideOffset={8}
                                  >
                                    <div className="text-xs text-slate-300 px-1 pb-2">
                                      {t("import.duplicatesInDeckTitle", { deckName })}
                                    </div>
                                    <div className="max-h-64 overflow-auto border border-slate-800 rounded-md">
                                      <div className="p-2 space-y-1">
                                        {importDuplicateRows
                                          .slice()
                                          .sort((a, b) => String(a.entry).localeCompare(String(b.entry)))
                                          .map((r) => (
                                            <div
                                              key={`${r.entry}-${r.reading}`}
                                              className="px-2 py-1 rounded bg-white/5 text-sm text-slate-200 flex items-center justify-between gap-2"
                                            >
                                              <span className="truncate">{r.entry}</span>
                                              <span className="text-xs text-slate-400 whitespace-nowrap">{r.reading || '-'}</span>
                                            </div>
                                          ))}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              ) : null}
                            </div>
                          </div>

                          {importTagFiltersExpanded ? (
                            <div className="px-3 pb-2.5">
                              <div className="flex flex-wrap gap-2">
                                {importAvailableTags.slice(3).map(({ tag, count }) => {
                                  const active = importSelectedTags.includes(tag);
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => {
                                        setImportShowAllRecords(true);
                                        if (tag === 'REF_PRESENT') {
                                          setImportSelectedJlptLevels(
                                            active ? importJlptAllOptions : importJlptTags.map((t) => t.tag)
                                          );
                                        }
                                        if (tag === 'REF_MISSING') {
                                          setImportSelectedJlptLevels(active ? importJlptAllOptions : [NON_JLPT]);
                                        }
                                        setImportSelectedTags((prev) =>
                                          prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                                        );
                                      }}
                                      className={`px-2 py-1 rounded-md text-xs transition-colors ${
                                        active
                                          ? 'bg-slate-700 text-white'
                                          : 'bg-white/5 text-slate-400 hover:bg-white/10'
                                      }`}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        {getHumanTagLabel(tag)}
                                        <span className="opacity-60">({count})</span>
                                        {active ? (
                                          <span
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setImportShowAllRecords(true);
                                              if (tag === 'REF_PRESENT') {
                                                setImportSelectedJlptLevels(importJlptAllOptions);
                                              }
                                              if (tag === 'REF_MISSING') {
                                                setImportSelectedJlptLevels(importJlptAllOptions);
                                              }
                                              setImportSelectedTags((prev) => prev.filter((t) => t !== tag));
                                            }}
                                            className="ml-1 inline-flex items-center justify-center rounded hover:bg-white/10"
                                            role="button"
                                            aria-label={`Remove ${getHumanTagLabel(tag)} filter`}
                                            title="Remove"
                                          >
                                            <X className="size-3" />
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {(
                                  [
                                    showSentenceAudioField ? { key: 'sentenceAudio', label: `${t("Sentence Audio")}:` } : null,
                                    showExpressionAudioField ? { key: 'entryAudio', label: `${t("Entry Audio")}:` } : null,
                                    showSentenceField ? { key: 'sentence', label: `${t("Sentence")}:` } : null,
                                    showTranslationField ? { key: 'translation', label: `${t("Translation")}:` } : null,
                                    showGlossaryField ? { key: 'glossary', label: `${t("Glossary")}:` } : null,
                                  ].filter(Boolean) as Array<{ key: keyof typeof importFilters; label: string }>
                                ).map(({ key, label }) => {
                                  const value = importFilters[key];
                                  const display =
                                    value === 'missing' ? t("Missing") : value === 'contains' ? t("Contains") : t("Any");
                                  const color =
                                    value === 'missing'
                                      ? key === 'sentenceAudio'
                                        ? 'text-red-400'
                                        : key === 'entryAudio'
                                          ? 'text-blue-300'
                                          : key === 'sentence'
                                            ? 'text-orange-400'
                                            : key === 'translation'
                                              ? 'text-yellow-400'
                                              : 'text-rose-300'
                                      : value === 'contains'
                                        ? 'text-emerald-400'
                                        : 'text-slate-400';
                                  const active = value !== 'any';
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => {
                                        setImportFilters((prev) => {
                                          const current = prev[key];
                                          const next =
                                            current === 'any' ? 'missing' : current === 'missing' ? 'contains' : 'any';
                                          return { ...prev, [key]: next };
                                        });
                                        setImportShowAllRecords(true);
                                      }}
                                      title={t("Click to cycle: Any → Missing → Contains")}
                                      className={`rounded-md px-2 py-1 text-xs border transition-colors ${
                                        active
                                          ? `bg-slate-800 border-slate-700 ${color}`
                                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      <span className="text-slate-400">{label.replace(/:\s*$/, '')} :</span>
                                      <span className={`ml-1 ${active ? color : 'text-slate-200'}`}>{display}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {/* ===================================================== */}
                    {/* TABLE */}
                    {/* ===================================================== */}

                    <div
                      ref={importTableScrollRef}
                      onScroll={(e) => {
                        const top = e.currentTarget.scrollTop;
                        if (importTableScrollRafRef.current != null) return;
                        importTableScrollRafRef.current = requestAnimationFrame(() => {
                          importTableScrollRafRef.current = null;
                          setImportTableScrollTop(top);
                        });
                      }}
                      className="min-h-[320px] max-h-[55vh] overflow-x-auto overflow-y-auto border border-slate-800 rounded-lg"
                    >

                      <table className="min-w-max w-full text-xs">

                        <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
                          <tr className="text-left text-xs text-slate-400">
                            <th className="px-3 py-3 w-[44px]">
                              <input
                                type="checkbox"
                                checked={importHeaderChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setImportSelectedRowIds(sortedFilteredImportRows.map((r) => r.rowId));
                                    setImportSelectAllFiltered(true);
                                  } else {
                                    setImportSelectedRowIds([]);
                                    setImportSelectAllFiltered(false);
                                  }
                                }}
                                className="h-4 w-4 accent-blue-600"
                                aria-label="Toggle all rows"
                              />
                            </th>
                            <th className="px-4 py-3 min-w-[140px] border-l border-slate-800">{t("Entry")}</th>
                            <th className="px-4 py-3 min-w-[140px] border-l border-slate-800">{t("Reading")}</th>
                            {showGlossaryField ? (
                              <th className="px-4 py-3 min-w-[220px] border-l border-slate-800">{t("Glossary")}</th>
                            ) : null}
                            <th className="px-4 py-3 min-w-[340px] border-l border-slate-800">{t("Content")}</th>
                            <th className="px-4 py-3 w-[120px] border-l border-slate-800">
                              {importJlptTags.length > 0 ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-white/5"
                                      title={t("import.jlpt.sortFilter")}
                                    >
                                      <span>JLPT</span>
                                      <ChevronDown className="size-3.5" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    align="start"
                                    className="w-64 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                                    sideOffset={8}
                                  >
                                    <div className="px-1 pb-2">
                                      <div className="text-[11px] text-slate-400 mb-1">{t("import.jlpt.sortBy")}</div>
                                      <select
                                        value={importJlptSort}
                                        onChange={(e) => setImportJlptSort(e.target.value as 'all' | 'asc' | 'desc')}
                                        className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600/40"
                                      >
                                        <option value="all">{t("import.jlpt.allDefault")}</option>
                                        <option value="asc">JLPT (N5 → N1)</option>
                                        <option value="desc">JLPT (N1 → N5)</option>
                                      </select>
                                    </div>

                                    <div className="border-t border-slate-800 pt-2 px-1">
                                      <div className="text-[11px] text-slate-400 mb-1">{t("import.jlpt.levels")}</div>

                                      <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={
                                            importSelectedJlptLevels.length === importJlptAllOptions.length &&
                                            importJlptAllOptions.length > 0
                                          }
                                          onChange={(e) => {
                                            setImportSelectedJlptLevels(e.target.checked ? importJlptAllOptions : []);
                                          }}
                                        />
                                        <span>{t("import.jlpt.all")}</span>
                                      </label>

                                      {importJlptTags
                                        .slice()
                                        .sort((a, b) => a.tag.localeCompare(b.tag))
                                        .map(({ tag, count }) => {
                                          const checked = importSelectedJlptLevels.includes(tag);
                                          const label = String(tag).replace('JLPT_', '');
                                          return (
                                            <label
                                              key={tag}
                                              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer"
                                            >
                                              <span className="flex items-center gap-2">
                                                <input
                                                  type="checkbox"
                                                  checked={checked}
                                                  onChange={(e) => {
                                                    setImportSelectedJlptLevels((prev) => {
                                                      if (e.target.checked) return [...prev, tag];
                                                      return prev.filter((x) => x !== tag);
                                                    });
                                                  }}
                                                />
                                                <span>{label}</span>
                                              </span>
                                              <span className="text-xs text-slate-500">{count}</span>
                                            </label>
                                          );
                                        })}

                                      <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                                        <span className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={importSelectedJlptLevels.includes(NON_JLPT)}
                                            onChange={(e) => {
                                              setImportSelectedJlptLevels((prev) => {
                                                if (e.target.checked) return [...prev, NON_JLPT];
                                                return prev.filter((x) => x !== NON_JLPT);
                                              });
                                            }}
                                          />
                                          <span>{getHumanTagLabel(NON_JLPT)}</span>
                                        </span>
                                        <span className="text-xs text-slate-500">-</span>
                                      </label>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <span>JLPT</span>
                              )}
                            </th>
                            <th className="px-4 py-3 min-w-[240px] border-l border-slate-800">{t("Tags")}</th>
                          </tr>
                        </thead>

                        <tbody>
                          {importVirtualRange.topSpacer > 0 ? (
                            <tr aria-hidden="true">
                              <td colSpan={importTableColSpan} style={{ height: importVirtualRange.topSpacer }} />
                            </tr>
                          ) : null}

                          {visibleImportRows.map((r) => {
                            const selected = importSelectedRowIdSet.has(r.rowId);

                            const tags = (r.tags || [])
                              .filter((t) => !/^JLPT_N[1-5]$/.test(String(t)));

                            if (
                              typeof r.jlptLevel === 'number' &&
                              r.jlptLevel >= 1 &&
                              r.jlptLevel <= 5
                            ) {
                              tags.unshift(`JLPT N${6 - r.jlptLevel}`);
                            }

                            return (
                              <tr
                                key={r.rowId}
                                className={`h-[60px] border-b border-white/5 hover:bg-white/5 ${selected ? 'bg-blue-500/5' : 'opacity-40'}`}
                              >
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={(e) => {
                                      const next = e.target.checked;
                                      if (!next) setImportSelectAllFiltered(false);
                                      setImportSelectedRowIds((prev) => {
                                        if (next) return prev.includes(r.rowId) ? prev : [...prev, r.rowId];
                                        return prev.filter((id) => id !== r.rowId);
                                      });
                                    }}
                                    className="h-4 w-4 accent-blue-600"
                                    aria-label={`Select ${r.entry}`}
                                  />
                                </td>

                                <td className="px-4 py-2 whitespace-nowrap text-slate-100 font-medium border-l border-white/5">
                                  <span className="inline-flex items-center gap-2">
                                    {showExpressionAudioField ? (
                                      String(r.audioFilename || "").trim() ? (
                                        <span title={t("Contains Entry Audio")} aria-label={t("Contains Entry Audio")}>
                                          <Volume2 className="size-4 text-blue-300" />
                                        </span>
                                      ) : (
                                        <span title={t("Missing Entry Audio")} aria-label={t("Missing Entry Audio")}>
                                          <VolumeX className="size-4 text-slate-500" />
                                        </span>
                                      )
                                    ) : null}
                                    <span
                                      className="cursor-help"
                                      title={t("import.frequencyTooltip", { n: typeof r.frequency === 'number' ? r.frequency : '-' })}
                                    >
                                      {r.entry}
                                    </span>
                                  </span>
                                </td>

                                <td className="px-4 py-2 whitespace-nowrap text-slate-300 border-l border-white/5">
                                  {r.reading || '-'}
                                </td>

                                {showGlossaryField ? (
                                  <td className="px-4 py-2 text-slate-300 border-l border-white/5">
                                    {String(r.translation || '').trim() ? (
                                      <div className="max-w-[340px] truncate">{r.translation}</div>
                                    ) : (
                                      <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-rose-500/10 text-rose-200 border border-rose-500/20">
                                        {t("Missing Glossary")}
                                      </span>
                                    )}
                                  </td>
                                ) : null}

                                <td className="px-4 py-2 text-slate-300 border-l border-white/5">
                                  <div className="flex flex-col gap-1">
                                    {showSentenceField || showSentenceAudioField ? (
                                      <div className="flex items-center justify-between gap-3">
                                        {showSentenceField ? (
                                          String(r.sentence || '').trim() ? (
                                            <div className="max-w-[520px] truncate text-slate-200">{r.sentence}</div>
                                          ) : (
                                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-orange-500/10 text-orange-200 border border-orange-500/20">
                                              {t("Missing Sentence")}
                                            </span>
                                          )
                                        ) : (
                                          <span />
                                        )}
                                        {showSentenceAudioField ? (
                                          String(r.sentenceAudioFilename || "").trim() ? (
                                            <span title={t("Contains SentenceAudio")} aria-label={t("Contains SentenceAudio")}>
                                              <Volume2 className="size-4 text-blue-300" />
                                            </span>
                                          ) : (
                                            <span title={t("Missing SentenceAudio")} aria-label={t("Missing SentenceAudio")}>
                                              <VolumeX className="size-4 text-slate-600" />
                                            </span>
                                          )
                                        ) : null}
                                      </div>
                                    ) : null}
                                    {showTranslationField ? (
                                      <div className="text-slate-400 italic">
                                        {String(r.sentenceTranslation || '').trim() ? (
                                          <div className="max-w-[520px] truncate">{r.sentenceTranslation}</div>
                                        ) : (
                                          <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-200 border border-amber-500/20">
                                            {t("Missing Translation")}
                                          </span>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                </td>

                                <td className="px-4 py-2 whitespace-nowrap text-slate-300 border-l border-white/5">
                                  {typeof r.jlptLevel === 'number' &&
                                  r.jlptLevel >= 1 &&
                                  r.jlptLevel <= 5
                                    ? `N${6 - r.jlptLevel}`
                                    : '-'}
                                </td>

                                <td className="px-4 py-2 border-l border-white/5">

                                  <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-thin">

                                    {tags.slice(0, 3).map((t) => (
                                      <span
                                        key={t}
                                        className="px-2 py-0.5 rounded bg-white/5 text-[10px] text-slate-400 border border-white/5"
                                      >
                                        {String(t).startsWith('JLPT ')
                                          ? t
                                          : getHumanTagLabel(t)}
                                      </span>
                                    ))}

                                    {tags.length > 3 && (
                                      <span
                                        className="text-[10px] text-slate-500 cursor-help"
                                        title={tags
                                          .slice(3)
                                          .map((t) => (String(t).startsWith('JLPT ') ? String(t) : getHumanTagLabel(String(t))))
                                          .join(', ')}
                                      >
                                        +{tags.length - 3}
                                      </span>
                                    )}

                                  </div>

                                </td>
                              </tr>
                            );
                          })}

                          {importVirtualRange.bottomSpacer > 0 ? (
                            <tr aria-hidden="true">
                              <td colSpan={importTableColSpan} style={{ height: importVirtualRange.bottomSpacer }} />
                            </tr>
                          ) : null}
                        </tbody>

                      </table>

                    </div>
                  </>
                )}

              </div>
              </div>
            </div>

            {/* FOOTER */}

            <DialogFooter className="border-t border-slate-800 pt-3 sm:justify-between">

              <div className="text-[11px] text-slate-500">
                {t("import.selectionSummary", { n: importSelectedRowIds.length })}
              </div>

              <div className="flex items-center gap-3">

                <button
                  type="button"
                  onClick={requestCloseImportDialog}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors text-xs"
                >
                  {t("Cancel")}
                </button>

                <button
                  type="button"
                  onClick={() => setImportCommitConfirmOpen(true)}
                  disabled={importCommitRunning || importSelectedRowIds.length === 0}
                  className={`px-3 py-1.5 rounded-lg transition-colors text-xs ${
                    importCommitRunning || importSelectedRowIds.length === 0
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {t("import.commit")}
                </button>

              </div>

            </DialogFooter>

          </DialogContent>
        </Dialog>

        <Dialog open={importMappingDialogOpen} onOpenChange={setImportMappingDialogOpen}>
          <DialogContent
            className={`bg-slate-900 border border-slate-700 text-slate-100 ${
              (importPendingFile?.name || "").toLowerCase().endsWith(".json") ? "max-w-4xl" : "max-w-xl"
            }`}
          >
            <DialogHeader>
              <div className="flex items-center justify-between gap-3">
                <DialogTitle>{t("import.mapping.title")}</DialogTitle>
                {importIsCsvMapping ? (
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-slate-300">{t("import.mapping.separator")}</div>
                    <select
                      value={importCsvDelimiter}
                      onChange={async (e) => {
                        const next = e.target.value;
                        setImportCsvDelimiter(next);
                        const f = importPendingFile;
                        if (!f) return;
                        const { columns, warning, previews } = await detectStructuredColumns(f, next);
                        setImportDetectedColumns(columns);
                        setImportDetectedColumnPreviews(previews || {});
                        setImportColumnMapping(guessMappingFromColumns(columns, previews || {}));
                        setImportMappingWarning(warning);
                      }}
                      className="w-44 bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
                    >
                      <option value=",">{t("import.mapping.separator.comma")}</option>
                      <option value=";">{t("import.mapping.separator.semicolon")}</option>
                      <option value="\t">{t("import.mapping.separator.tab")}</option>
                      <option value="|">{t("import.mapping.separator.pipe")}</option>
                    </select>
                  </div>
                ) : null}
              </div>
              <DialogDescription className="text-slate-300">
                {t("import.mapping.description")}
              </DialogDescription>
            </DialogHeader>

            {importMappingWarning ? (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-200">
                {importMappingWarning}
              </div>
            ) : null}

            <div className="space-y-2">
              {(
                [
                  { key: "expression", label: t("Entry"), required: true },
                  { key: "reading", label: t("Reading"), required: false },
                  showGlossaryField ? { key: "glossary", label: t("Glossary"), required: false } : null,
                  showSentenceField ? { key: "sentence", label: t("Sentence"), required: false } : null,
                  showTranslationField ? { key: "translation", label: t("Sentence Translation"), required: false } : null,
                ].filter(Boolean) as Array<{ key: keyof typeof importColumnMapping; label: string; required: boolean }>
              ).map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-200">
                    {f.label}
                    {f.required ? <span className="text-rose-300"> *</span> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    {(() => {
                      const ext = (importPendingFile?.name || "").toLowerCase().split(".").pop() || "";
                      const isJson = ext === "json";
                      const current = String(importColumnMapping[f.key] ?? "");

                      if (!isJson) {
                        return (
                          <select
                            value={current}
                            onChange={(e) => setImportColumnMapping((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            className="w-64 bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200"
                          >
                            {f.key === "reading" ? (
                              <>
                                <option value="">{t("import.mapping.none")}</option>
                                <option value="__GENERATE__">— {t("Generate")} —</option>
                              </>
                            ) : (
                              <option value="">{t("import.mapping.none")}</option>
                            )}
                            {importDetectedColumns.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        );
                      }

                      const NONE = "__NONE__";
                      const selectValue = current ? current : NONE;
                      const selectedLabel =
                        selectValue === NONE
                          ? t("import.mapping.none")
                          : selectValue === "__GENERATE__"
                            ? `— ${t("Generate")} —`
                            : selectValue;

                      return (
                        <Select
                          value={selectValue}
                          onValueChange={(val) => {
                            const next = val === NONE ? "" : val;
                            setImportColumnMapping((prev) => ({ ...prev, [f.key]: next }));
                          }}
                        >
                          <SelectTrigger className="w-64 bg-slate-950 border-slate-700 text-slate-200 text-xs">
                            <MarqueeText text={selectedLabel} />
                          </SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 text-slate-100 max-h-80">
                            <SelectItem value={NONE} className="text-xs">
                              {t("import.mapping.none")}
                            </SelectItem>
                            {f.key === "reading" ? (
                              <SelectItem value="__GENERATE__" className="text-xs">
                                — {t("Generate")} —
                              </SelectItem>
                            ) : null}
                            {importDetectedColumns.map((c) => (
                              <SelectItem key={c.value} value={c.value} className="text-xs">
                                <MarqueeText text={c.label} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      );
                    })()}
                    {(() => {
                      const ext = (importPendingFile?.name || "").toLowerCase().split(".").pop() || "";
                      if (ext !== "json") return null;
                      const selected = String(importColumnMapping[f.key] ?? "");
                      const preview =
                        selected === "__GENERATE__"
                          ? t("Generate")
                          : selected
                            ? (importDetectedColumnPreviews[selected] ?? "")
                            : "";
                      return (
                        <div className="w-72 bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-[11px] text-slate-300 truncate">
                          {preview || "—"}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setImportMappingDialogOpen(false);
                  setImportPendingFile(null);
                  setImportDetectedColumns([]);
                  setImportDetectedColumnPreviews({});
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors text-xs"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                disabled={!importPendingFile}
                onClick={() => {
                  const f = importPendingFile;
                  if (!f) return;
                  const mappingToSend: Record<string, string> = {};
                  for (const [k, v] of Object.entries(importColumnMapping)) {
                    const value = String(v || "").trim();
                    if (!value) continue;
                    if (k === "reading" && value === "__GENERATE__") continue;
                    mappingToSend[k] = value;
                  }
                  const shouldSendMapping = Boolean(String(mappingToSend.expression || "").trim());
                  setImportMappingDialogOpen(false);
                  setImportPendingFile(null);
                  setImportDetectedColumns([]);
                  setImportDetectedColumnPreviews({});
                  void submitImportPreview(
                    f,
                    shouldSendMapping ? mappingToSend : undefined,
                    importIsCsvMapping ? importCsvDelimiter : undefined
                  );
                }}
                className={`px-3 py-1.5 rounded-lg transition-colors text-xs ${
                  !importPendingFile
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {t("import.mapping.skip")}
              </button>
              <button
                type="button"
                disabled={!importPendingFile || !String(importColumnMapping.expression || "").trim()}
                onClick={() => {
                  const f = importPendingFile;
                  if (!f) return;
                  const mappingToSend: Record<string, string> = {};
                  for (const [k, v] of Object.entries(importColumnMapping)) {
                    const value = String(v || "").trim();
                    if (!value) continue;
                    if (k === "reading" && value === "__GENERATE__") continue;
                    mappingToSend[k] = value;
                  }
                  setImportMappingDialogOpen(false);
                  setImportPendingFile(null);
                  setImportDetectedColumns([]);
                  setImportDetectedColumnPreviews({});
                  void submitImportPreview(f, mappingToSend, importIsCsvMapping ? importCsvDelimiter : undefined);
                }}
                className={`px-3 py-1.5 rounded-lg transition-colors text-xs ${
                  !importPendingFile || !String(importColumnMapping.expression || "").trim()
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {t("Apply")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={importInvalidTxtDialogOpen} onOpenChange={setImportInvalidTxtDialogOpen}>
          <AlertDialogContent className="bg-slate-900 border border-slate-700 text-slate-100">
            <AlertDialogHeader>
              <AlertDialogTitle>{t("import.txtValidation.title")}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300">
                {t("import.txtValidation.noJapanese")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                className="bg-blue-600 text-white hover:bg-blue-500"
                onClick={(e) => {
                  e.preventDefault();
                  setImportInvalidTxtDialogOpen(false);
                  setImportStage('import');
                  window.setTimeout(() => {
                    importFileInputRef.current?.click();
                  }, 50);
                }}
              >
                {t("OK")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={importEnhanceConfirmOpen} onOpenChange={setImportEnhanceConfirmOpen}>
          <AlertDialogContent data-component="import-enhancements-confirm-dialog" className="bg-slate-900 border border-slate-700 text-slate-100">
            <AlertDialogHeader>
              <AlertDialogTitle data-component="import-enhancements-confirm-title">{t("Apply Enhancements?")}</AlertDialogTitle>
              <AlertDialogDescription data-component="import-enhancements-confirm-description" className="text-slate-300">
                {t("These changes will be applied to the current preview selection.")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-2 space-y-2">
              <div data-component="import-enhancements-selection-summary" className="text-sm text-slate-200">{t("import.selectionSummary", { n: importSelectedRowIds.length })}</div>
              {renderLargeActionWarning(importSelectedRowIds.length)}
              <ul className="list-disc list-inside text-sm text-slate-300 space-y-1">
                {importEnhanceAddTranslation ? (
                  <li>
                    {t("Translate to {{language}}", {
                      language: displayTargetLang === "pt-BR" ? t("Portuguese (Brazil)") : t("English (US)"),
                    })}
                    {importEnhanceTranslateExistingGlossary ? ` • ${t("Translate existing into {{language}}", {
                      language: displayTargetLang === "pt-BR" ? t("Portuguese (Brazil)") : t("English (US)"),
                    })}` : ''}
                  </li>
                ) : null}
                {importEnhanceAddAudio ? (
                  <li>
                    {t("import.addAudioSource", { source: importEnhanceAudioSource === "reading" ? t("Reading") : t("Entry") })}
                  </li>
                ) : null}
                {importEnhanceSentencesEffective ? (
                  <li>
                    {t("import.generateExampleSentencesMode", { mode: importEnhanceSentenceMode })}
                    {importEnhanceIncludeSentence ? ` • ${t("Add Sentence")}` : ''}
                    {importEnhanceIncludeSentenceTranslation ? ` • ${t("Add Translation")}` : ''}
                    {importEnhanceIncludeSentenceAudio ? ` • ${t("Add Sentence Audio")}` : ''}
                  </li>
                ) : null}
              </ul>
              {importTranslateLoading || importSentenceLoading || importAudioLoading ? (
                <div className="pt-1 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span data-component="import-enhancements-progress-label">
                      {importSentenceLoading
                        ? t("Generating sentences…")
                        : importTranslateLoading
                          ? t("Translating…")
                          : importAudioLoading
                            ? t("Generating audio…")
                            : t("Working…")}
                    </span>
                    <span>{Math.min(100, Math.max(0, Math.round(importEnhanceProgress)))}%</span>
                  </div>
                  <Progress value={importEnhanceProgress} />
                </div>
              ) : null}
              {importEnhancementsBlocked ? (
                <div className="text-xs text-amber-300">
                  {t("Required API key is missing for the selected enhancements.")}
                </div>
              ) : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel data-component="import-enhancements-cancel-button" disabled={importLoading || importTranslateLoading || importSentenceLoading || importAudioLoading}>
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                data-component="import-enhancements-apply-button"
                disabled={importEnhancementsBlocked || importLoading || importTranslateLoading || importSentenceLoading || importAudioLoading}
                onClick={(e) => {
                  e.preventDefault();
                  setImportEnhanceProgress(0);
                  void handleApplyImportEnhancements();
                }}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {t("Apply")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={importExitConfirmOpen} onOpenChange={setImportExitConfirmOpen}>
          <AlertDialogContent data-component="import-exit-confirm-dialog" className="bg-slate-900 border border-slate-700 text-slate-100">
            <AlertDialogHeader>
            <AlertDialogTitle data-component="import-exit-confirm-title">{t("Exit Import?")}</AlertDialogTitle>
              <AlertDialogDescription data-component="import-exit-confirm-description" className="text-slate-300">
              {t("Do you wish to exit? Any unsaved changes will be lost")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel data-component="import-exit-cancel-button">{t("No")}</AlertDialogCancel>
              <AlertDialogAction data-component="import-exit-confirm-button" onClick={closeImportDialog} className="bg-rose-600 text-white hover:bg-rose-500">
              {t("Yes")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={importCommitConfirmOpen} onOpenChange={setImportCommitConfirmOpen}>
          <AlertDialogContent data-component="import-commit-confirm-dialog" className="bg-slate-900 border border-slate-700 text-slate-100">
            <AlertDialogHeader>
            <AlertDialogTitle data-component="import-commit-confirm-title">{t("Import Cards?")}</AlertDialogTitle>
              <AlertDialogDescription data-component="import-commit-confirm-description" className="text-slate-300">
              {t("import.commitConfirmDescription", { n: importSelectedRowIds.length, deckName: deckName ? `"${deckName}"` : "" })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {renderLargeActionWarning(importSelectedRowIds.length)}
            {importCommitRunning ? (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span data-component="import-commit-progress-label">{t("import.importingEllipsisUnicode")}</span>
                  <span>{Math.min(100, Math.max(0, Math.round(importCommitProgress)))}%</span>
                </div>
                <Progress value={importCommitProgress} />
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel data-component="import-commit-cancel-button" disabled={importCommitRunning}>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction
                data-component="import-commit-confirm-button"
                onClick={(e) => {
                  e.preventDefault();
                  setImportCommitProgress(0);
                  void handleImportCommit();
                }}
                disabled={importCommitRunning || importSelectedRowIds.length === 0}
                className="bg-blue-600 text-white hover:bg-blue-500"
              >
                {importCommitRunning ? t("import.importingEllipsis") : t("import.commit")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={bulkAddMissingOpen} onOpenChange={setBulkAddMissingOpen}>
          <DialogContent
            data-component="bulk-actions-dialog"
            className="w-[95vw] sm:max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden flex flex-col text-sm"
          >
            <DialogHeader>
              <DialogTitle data-component="bulk-actions-dialog-title">{t("Bulk Actions")}</DialogTitle>
              <DialogDescription data-component="bulk-actions-dialog-description">
                {t("bulkActions.selectedCount", { n: bulkIncludedCount })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-auto">
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Popover open={bulkSentenceFieldsOpen} onOpenChange={setBulkSentenceFieldsOpen}>
                    <div className="inline-flex items-stretch">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-200 border border-slate-700 bg-slate-900 px-2.5 py-1 rounded-l-md">
                        <input
                          type="checkbox"
                          checked={bulkEnhanceAddContent}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setBulkEnhanceAddContent(next);
                            if (next) {
                              setBulkEnhanceAddTranslation(
                                showGlossaryField && bulkHasDeeplKey && bulkVisibleMissingCounts.glossary > 0
                              );
                              setBulkEnhanceAddAudio(
                                showExpressionAudioField && bulkHasAzureKey && bulkVisibleMissingCounts.entryAudio > 0
                              );
                              setBulkEnhanceAddSentence(showSentenceField && bulkVisibleMissingCounts.sentence > 0);
                              setBulkEnhanceAddSentenceTranslation(
                                showTranslationField && bulkVisibleMissingCounts.translation > 0
                              );
                              setBulkEnhanceAddSentenceAudio(
                                showSentenceAudioField &&
                                bulkVisibleMissingCounts.sentenceAudio > 0 &&
                                bulkTtsVoiceOptions.length > 0
                              );
                            } else {
                              setBulkEnhanceAddTranslation(false);
                              setBulkEnhanceAddAudio(false);
                              setBulkEnhanceAddSentence(false);
                              setBulkEnhanceAddSentenceTranslation(false);
                              setBulkEnhanceAddSentenceAudio(false);
                              setBulkSentenceFieldsOpen(false);
                            }
                          }}
                          disabled={bulkRunning}
                          data-component="bulk-generate-sentences-checkbox"
                          className="h-4 w-4 accent-blue-600"
                        />
                        <span data-component="bulk-add-content-label" title={t("Select which fields to generate for example sentences")}>
                          {t("bulkActions.addContent")}
                        </span>
                      </label>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={!bulkEnhanceAddContent}
                          onClick={(e) => e.stopPropagation()}
                          data-component="bulk-sentence-fields-trigger"
                          className={`inline-flex items-center justify-center rounded-r-md border border-l-0 border-slate-700 bg-slate-900 px-2 py-1 text-xs transition-colors ${
                            bulkEnhanceAddContent ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-600 cursor-not-allowed'
                          }`}
                          aria-label={t("Sentence fields")}
                          title={t("Sentence fields")}
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                      </PopoverTrigger>
                    </div>
                    <PopoverContent
                      align="start"
                      data-component="bulk-sentence-fields-menu"
                      className="w-80 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                      sideOffset={8}
                    >
                      <div className={`space-y-1 ${bulkEnhanceAddContent ? '' : 'opacity-50 pointer-events-none'}`}>
                        {showGlossaryField && bulkVisibleMissingCounts.glossary > 0 ? (
                          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={bulkEnhanceAddTranslation}
                                onChange={(e) => setBulkEnhanceAddTranslation(e.target.checked)}
                                disabled={bulkRunning || !bulkHasDeeplKey}
                              />
                              <span className="truncate">{t("Add Glossary")}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-rose-500/10 text-rose-200 border border-rose-500/20 shrink-0">
                                {t("bulkActions.missingCountShort", { n: bulkVisibleMissingCounts.glossary })}
                              </span>
                              {!bulkHasDeeplKey ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-amber-300"
                                  title={t("DeepL API key is missing. Configure it in Settings → API Keys.")}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </span>
                              ) : null}
                            </span>
                          </label>
                        ) : null}

                        {showExpressionAudioField && bulkVisibleMissingCounts.entryAudio > 0 ? (
                          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={bulkEnhanceAddAudio}
                                onChange={(e) => setBulkEnhanceAddAudio(e.target.checked)}
                                disabled={bulkRunning || !bulkHasAzureKey}
                              />
                              <span className="truncate">{t("bulkActions.addEntryAudio")}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-200 border border-blue-500/20 shrink-0">
                                {t("bulkActions.missingCountShort", { n: bulkVisibleMissingCounts.entryAudio })}
                              </span>
                              {!bulkHasAzureKey ? (
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-amber-300"
                                title={t("settings.ttsProviderKeyMissing")}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </span>
                              ) : null}
                            </span>
                          </label>
                        ) : null}

                        {showSentenceField && bulkVisibleMissingCounts.sentence > 0 ? (
                          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={bulkEnhanceAddSentence}
                                onChange={(e) => setBulkEnhanceAddSentence(e.target.checked)}
                              />
                              <span className="truncate">{t("bulkActions.addSentence")}</span>
                            </span>
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-orange-500/10 text-orange-200 border border-orange-500/20 shrink-0">
                              {t("bulkActions.missingCountShort", { n: bulkVisibleMissingCounts.sentence })}
                            </span>
                          </label>
                        ) : null}

                        {showTranslationField && bulkVisibleMissingCounts.translation > 0 ? (
                          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={bulkEnhanceAddSentenceTranslation}
                                onChange={(e) => setBulkEnhanceAddSentenceTranslation(e.target.checked)}
                              />
                              <span className="truncate">{t("bulkActions.addTranslation")}</span>
                            </span>
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-200 border border-amber-500/20 shrink-0">
                              {t("bulkActions.missingCountShort", { n: bulkVisibleMissingCounts.translation })}
                            </span>
                          </label>
                        ) : null}

                        {showSentenceAudioField && bulkVisibleMissingCounts.sentenceAudio > 0 ? (
                          <label className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200 cursor-pointer">
                            <span className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={bulkEnhanceAddSentenceAudio}
                                onChange={(e) => setBulkEnhanceAddSentenceAudio(e.target.checked)}
                                disabled={bulkRunning || !bulkHasAzureKey || bulkTtsVoiceOptions.length === 0}
                              />
                              <span className="truncate">{t("bulkActions.addSentenceAudio")}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              {bulkTtsVoiceOptions.length > 0 ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      disabled={!bulkEnhanceAddSentenceAudio}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 transition-colors ${
                                        bulkEnhanceAddSentenceAudio
                                          ? 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                                          : 'bg-slate-900 text-slate-600 opacity-50 cursor-not-allowed'
                                      }`}
                                      aria-label={t("Select TTS model for sentence audio")}
                                      title={getTtsVoiceLabel(bulkEnhanceSentenceAudioVoiceName, bulkTtsVoiceOptions) || t("Select TTS model for sentence audio")}
                                    >
                                      <Volume2 className="size-3.5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    sideOffset={8}
                                    className="z-[200] w-56 bg-slate-900 border border-slate-700 text-slate-100"
                                  >
                                    {bulkTtsVoiceOptions.map((voice) => (
                                      <DropdownMenuItem
                                        key={voice.id}
                                        onSelect={(e) => {
                                          e.preventDefault();
                                          setBulkEnhanceSentenceAudioVoiceName(voice.id);
                                        }}
                                        className="flex items-center justify-between"
                                      >
                                        <span>{voice.label}</span>
                                        {bulkEnhanceSentenceAudioVoiceName === voice.id ? (
                                          <Check className="size-4" />
                                        ) : null}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-200 border border-red-500/20 shrink-0">
                                {t("bulkActions.missingCountShort", { n: bulkVisibleMissingCounts.sentenceAudio })}
                              </span>
                            </span>
                          </label>
                        ) : null}
                      </div>
                    </PopoverContent>
                  </Popover>

                  <div className="ml-auto flex items-center gap-2">
                    <Popover open={bulkClearMenuOpen} onOpenChange={setBulkClearMenuOpen}>
                      <div className="flex items-stretch rounded-md shadow-sm">
                        <button
                          type="button"
                          onClick={() => setBulkClearConfirmOpen(true)}
                          disabled={bulkControlsLocked || bulkClearInternalFields.length === 0 || bulkIncludedCount === 0}
                        data-component="bulk-clear-fields-button"
                          className={`px-3 py-1.5 text-xs font-medium rounded-l-lg transition-colors border border-red-200/50 border-r-0 ${
                            bulkControlsLocked || bulkClearInternalFields.length === 0 || bulkIncludedCount === 0
                              ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                              : 'bg-red-600 text-white hover:bg-red-700'
                          }`}
                        >
                          {t("bulkActions.clearCount", { n: bulkClearInternalFields.length })}
                        </button>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={bulkControlsLocked || bulkClearInternalFields.length === 0}
                          data-component="bulk-clear-fields-menu-trigger"
                            className={`px-1.5 py-1.5 rounded-r-lg transition-colors border border-red-200/50 border-l-0 ${
                              bulkControlsLocked || bulkClearInternalFields.length === 0
                                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                : 'bg-red-600 text-white hover:bg-red-700'
                            }`}
                            aria-label={t("Select fields to clear")}
                          >
                            <ChevronDown
                              className={`size-3.5 transition-transform duration-200 ${bulkClearMenuOpen ? 'rotate-180' : 'rotate-0'}`}
                            />
                          </button>
                        </PopoverTrigger>
                      </div>
                      <PopoverContent
                        align="end"
                        data-component="bulk-clear-fields-menu"
                        className="w-48 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                        sideOffset={8}
                      >
                        <div data-component="bulk-clear-fields-title" className="text-[10px] font-bold text-slate-500 px-2 py-1 uppercase tracking-wider">
                          {t("Fields to wipe")}
                        </div>
                        {clearFieldOptions.map((field) => (
                          <label
                            key={field.id}
                            data-component="bulk-clear-fields-option"
                            data-field={field.id}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={bulkClearInternalFields.includes(field.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                setBulkClearInternalFields((prev) =>
                                  prev.includes(field.id) ? prev.filter((x) => x !== field.id) : [...prev, field.id]
                                );
                              }}
                              className="rounded border-slate-700 bg-slate-800 text-red-500 focus:ring-red-500 size-3.5"
                            />
                            <span className="text-xs text-slate-200">{field.label}</span>
                          </label>
                        ))}
                        <div className="border-t border-slate-800 mt-2 pt-2">
                          <button
                            type="button"
                            data-component="bulk-clear-fields-menu-close-button"
                            onClick={() => setBulkClearMenuOpen(false)}
                            className="w-full py-1 text-[10px] text-slate-400 hover:text-white transition-colors"
                          >
                            {t("Close Menu")}
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>

                    <button
                      type="button"
                      onClick={() => setBulkEnhanceConfirmOpen(true)}
                      disabled={!bulkEnhancementsSelected || bulkEnhancementsBlocked || bulkRunning || bulkIncludedCount === 0}
                      data-component="bulk-apply-enhancements-button"
                      className={`px-3 py-1.5 rounded-lg transition-colors text-xs ${
                        !bulkEnhancementsSelected || bulkEnhancementsBlocked || bulkRunning || bulkIncludedCount === 0
                          ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {t("Apply Enhancements")}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span data-component="bulk-sentence-mode-label" className="text-xs text-slate-300">{t("Sentence Mode:")}</span>
                  <select
                    value={bulkEnhanceSentenceMode}
                    onChange={(e) => setBulkEnhanceSentenceMode(e.target.value as any)}
                    disabled={bulkRunning}
                    data-component="bulk-sentence-mode-select"
                    className="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-slate-200"
                  >
                    <option value="random">{t("Random")}</option>
                    {/* <option value="most_common">{t("Most Common")}</option> */}
                    {/* <option value="jlpt">{t("JLPT Appropriate")}</option> */}
                  </select>

                  {bulkShowTargetLangSelect ? (
                    <>
                      <span data-component="bulk-target-language-label" className="text-xs text-slate-300">{t("Target Language:")}</span>
                      <select
                        value={bulkEnhanceTargetLang}
                        onChange={(e) => setBulkEnhanceTargetLang(e.target.value as 'en-US' | 'pt-BR')}
                        disabled={bulkRunning}
                        data-component="bulk-target-language-select"
                        className="bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1 text-xs text-slate-200"
                      >
                        <option value="en-US">{t("English (US)")}</option>
                        <option value="pt-BR">{t("Portuguese (Brazil)")}</option>
                      </select>
                    </>
                  ) : null}

                  {bulkEnhancementsBlocked ? (
                    <div className="text-xs text-amber-300">
                      {t("Required API key is missing for the selected enhancements.")}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {bulkRandomTotal > 0 && (bulkRunning || bulkRandomDone > 0) ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span data-component="bulk-progress-label">{t("Progress")}</span>
                  <span>
                    {bulkRandomDone}/{bulkRandomTotal}{' '}
                    ({Math.min(100, Math.round((bulkRandomDone / Math.max(1, bulkRandomTotal)) * 100))}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded bg-slate-700 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-[width] duration-200"
                    style={{
                      width: `${Math.min(100, Math.round((bulkRandomDone / Math.max(1, bulkRandomTotal)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-800 bg-slate-950/40">
              <div className="px-3 py-2.5 flex items-center gap-2 overflow-x-auto">
                <span data-component="bulk-filters-label" className="text-xs font-medium text-slate-200 whitespace-nowrap">{t("Filters")}</span>
                {visibleFilterGroups.map((g) => {
                    const mode = getFilterGroupMode(g.missingId, g.containsId);
                    const stateLabel = mode === 'missing' ? t("Missing") : mode === 'contains' ? t("Contains") : t("Any");
                    const color =
                      mode === 'missing' ? g.missingColor : mode === 'contains' ? g.containsColor : 'text-slate-400';
                    const active = Boolean(mode);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        data-component="bulk-filter-sentence-audio"
                        data-filter-group={g.id}
                        onClick={() => cycleFilterGroupState(g.missingId, g.containsId)}
                        disabled={!onFiltersChange || bulkControlsLocked}
                        className={`rounded-md px-2 py-1 text-xs border transition-colors ${
                          active
                            ? `bg-slate-800 border-slate-700 ${color}`
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                        title={t("Click to cycle: Any → Missing → Contains")}
                      >
                        {t(g.label)}: {stateLabel}
                      </button>
                    );
                  })}
                {(filters?.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    data-component="bulk-display-all-records-button"
                    onClick={() => {
                      onFiltersChange?.([]);
                      if (!deckName) return;
                      setBulkDeckMode(true);
                      void loadBulkDeckPage({ reset: true });
                    }}
                    disabled={!deckName || bulkDeckLoading || bulkControlsLocked}
                    className="ml-1 text-xs underline underline-offset-4 text-slate-400 hover:text-slate-200 whitespace-nowrap"
                    title={t("Clear filters (show all records)")}
                  >
                    {t("Display all records")}
                  </button>
                ) : null}
                <div className="ml-auto flex items-center gap-3 whitespace-nowrap">
                  {bulkLastUpdatedNoteIds.length > 0 ? (
                    <button
                      type="button"
                      data-component="bulk-view-in-anki-button"
                      onClick={() => void handleBulkViewInAnki()}
                      disabled={bulkControlsLocked}
                      className={`text-xs underline underline-offset-4 transition-colors ${
                        bulkControlsLocked ? 'text-slate-600 cursor-not-allowed' : 'text-blue-400 hover:text-blue-300'
                      }`}
                      title={
                        bulkLastUpdatedLabel
                          ? t("bulkActions.viewUpdatedSelectionInAnkiWithLabel", { label: bulkLastUpdatedLabel })
                          : t("View updated selection in Anki")
                      }
                    >
                      {t("bulkActions.viewInAnkiCount", { n: bulkLastUpdatedNoteIds.length })}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div ref={bulkTableRef} className="mt-3 flex-1 min-h-0 rounded-lg border border-slate-700 overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-x-auto">
                <div className="w-max">
                  <div
                    className="grid bg-slate-900/40 border-b border-slate-700"
                    style={{ gridTemplateColumns: getBulkGridTemplateColumns() }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="px-2 py-2 text-sm text-slate-200 border-r border-slate-700 select-none flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={bulkHeaderChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              const idSet = new Set(bulkDisplayRows.map((r) => r.noteId));
                              setBulkRandomRows((prev) =>
                                prev.map((r) => (idSet.has(r.noteId) ? { ...r, include: checked } : r))
                              );
                              setBulkSelectAllFiltered(checked);
                            }}
                            disabled={bulkRunning || bulkDisplayRows.length === 0}
                            className="h-4 w-4 accent-blue-600"
                            aria-label={t("Toggle all filtered rows")}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{t("Include all filtered rows.")}</TooltipContent>
                    </Tooltip>

                    <div className="relative px-3 py-2 text-sm text-slate-200 border-r border-slate-700 select-none">
                      {t("Entry")}
                      <div
                        onPointerDown={(e) => {
                          e.preventDefault();
                          startBulkColumnResize('entry', e.clientX);
                        }}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                      />
                    </div>

                    {showGlossaryField ? (
                      <div className="relative px-3 py-2 text-sm text-slate-200 border-r border-slate-700 select-none">
                        {t("Glossary")}
                        <div
                          onPointerDown={(e) => {
                            e.preventDefault();
                            startBulkColumnResize('glossary', e.clientX);
                          }}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                        />
                      </div>
                    ) : null}

                    <div className="relative px-3 py-2 text-sm text-slate-200 select-none">
                      {t("Current Content")}
                      <div
                        onPointerDown={(e) => {
                          e.preventDefault();
                          startBulkColumnResize('details', e.clientX);
                        }}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                      />
                    </div>
                  </div>

                  <div className="min-h-[320px] max-h-[55vh] overflow-y-auto">
                    {bulkTableRows.map((row) => {
                  const card = noteIdToCard.get(row.noteId);
                  const sentenceAudioField = mapping?.sentence_audio ?? 'SentenceAudio';
                  const expressionAudioField = mapping?.expression_audio ?? 'Audio';
                  const sentenceAudioVal = String(card?.fields.find((f) => f.label === sentenceAudioField)?.value ?? '');
                  const expressionAudioVal =
                    String(card?.fields.find((f) => f.label === expressionAudioField)?.value ?? '') ||
                    String(card?.fields.find((f) => /^(Word)?Audio$/i.test(f.label))?.value ?? '');
                  const sentenceSound =
                    row.sentenceAudioFilename ??
                    row.sentenceAudioTagFilename ??
                    extractFirstSoundFilename(sentenceAudioVal);
                  const expressionSound =
                    row.expressionAudioFilename ??
                    row.expressionAudioTagFilename ??
                    extractFirstSoundFilename(expressionAudioVal);
                  const glossaryText = cleanGlossaryText(row.glossary);
                  const glossaryExpanded = bulkExpandedGlossaryNoteIds.includes(row.noteId);
                  const glossaryLong = isGlossaryLong(glossaryText);
                  const justWritten = bulkRecentlyWrittenNoteIds.includes(row.noteId);
                  const previewJustUpdated = bulkPreviewRecentlyUpdatedNoteIds.includes(row.noteId);
                  const writtenChanges = bulkRecentlyWrittenChanges[row.noteId];
                  const entryHighlighted = Boolean(writtenChanges?.entry);
                  const glossaryHighlighted = Boolean(writtenChanges?.glossary);
                  const sentenceHighlighted = Boolean(writtenChanges?.sentence);
                  const translationHighlighted = Boolean(writtenChanges?.translation);

                  return (
                    <div
                      key={row.noteId}
                      ref={(el) => {
                        if (!el) {
                          bulkRowElsRef.current.delete(row.noteId);
                          return;
                        }
                        bulkRowElsRef.current.set(row.noteId, el);
                      }}
                      className={`relative grid py-2 border-b border-slate-800 last:border-b-0 items-start transition-colors ${
                        justWritten ? 'bg-emerald-500/10 ring-1 ring-emerald-400/30' : ''
                      } ${previewJustUpdated ? 'bg-purple-500/10 ring-1 ring-purple-400/30' : ''} ${
                        bulkActiveNoteId === row.noteId ? 'bg-blue-500/10 ring-1 ring-blue-400/30' : ''
                      }`}
                      style={{ gridTemplateColumns: getBulkGridTemplateColumns() }}
                    >
                    <div className="flex items-center justify-center border-r border-slate-800 px-2">
                      <input
                        type="checkbox"
                        checked={row.include}
                        disabled={bulkRunning}
                        onChange={(e) => {
                          const include = e.target.checked;
                          if (!include) setBulkSelectAllFiltered(false);
                          setBulkRandomRows((prev) => prev.map((r) => (r.noteId === row.noteId ? { ...r, include } : r)));
                        }}
                        className="rounded border-slate-700 bg-slate-800"
                        aria-label={`Include ${row.expression || row.noteId}`}
                      />
                    </div>

                    <div className="min-w-0 px-3">
                      <div
                        className={`text-sm text-slate-100 font-medium truncate ${entryHighlighted ? 'rounded bg-emerald-500/10 ring-1 ring-emerald-400/30 px-1 py-0.5' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          <span className="truncate">{row.expression || '—'}</span>
                          {showExpressionAudioField ? (
                            expressionSound ? (
                              <button
                                type="button"
                                onClick={() => playBulkMediaFile(expressionSound)}
                                className="relative inline-flex items-center rounded p-0.5 text-blue-300 hover:bg-white/10 hover:text-blue-200"
                                title={
                                  bulkFailedAudioFilenames.has(expressionSound)
                                    ? t("Failed playing Audio, check source folder")
                                    : "Play entry audio"
                                }
                              >
                                {bulkFailedAudioFilenames.has(expressionSound) ? (
                                  <VolumeX className="size-4" />
                                ) : (
                                  <Volume2 className="size-4" />
                                )}
                                {bulkLoadingAudioFilename === expressionSound ? (
                                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-950">
                                    {bulkLoadingAudioSeconds}
                                  </span>
                                ) : null}
                              </button>
                            ) : (
                              <span title={t("Missing Entry Audio")}>
                                <VolumeX className="size-4 text-slate-600" />
                              </span>
                            )
                          ) : null}
                        </span>
                      </div>
                    </div>

                    {showGlossaryField ? (
                      <div className="min-w-0 px-3 border-r border-slate-800">
                        <div className="flex items-start justify-between gap-2">
                          <div
                            className={`text-xs text-slate-300 break-words whitespace-pre-wrap ${glossaryHighlighted ? 'rounded bg-emerald-500/10 ring-1 ring-emerald-400/30 px-2 py-1' : ''}`}
                            style={
                              glossaryExpanded
                                ? undefined
                                : {
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }
                            }
                          >
                            {glossaryText ? (
                              glossaryText
                            ) : (
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-rose-500/10 text-rose-200 border border-rose-500/20">
                                {t("Missing Glossary")}
                              </span>
                            )}
                          </div>
                          {glossaryLong ? (
                            <button
                              type="button"
                              onClick={() => {
                                setBulkExpandedGlossaryNoteIds((prev) => {
                                  if (prev.includes(row.noteId)) return prev.filter((x) => x !== row.noteId);
                                  return [...prev, row.noteId];
                                });
                              }}
                              className="mt-0.5 rounded p-1 text-slate-400 hover:text-slate-200 hover:bg-white/5"
                              title={glossaryExpanded ? 'Collapse' : 'Expand'}
                              aria-label={glossaryExpanded ? 'Collapse glossary' : 'Expand glossary'}
                            >
                              <ChevronDown className={`size-4 transition-transform ${glossaryExpanded ? 'rotate-180' : 'rotate-0'}`} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    <div className="min-w-0 px-3 border-r border-slate-800">
                      <div className="text-xs text-slate-300 break-words whitespace-pre-wrap">
                        {showSentenceField || showSentenceAudioField ? (
                          (showSentenceField ? row.sentence.trim() : showSentenceAudioField) ? (
                            <span
                              className={`inline-flex flex-wrap items-center gap-1 ${sentenceHighlighted ? 'rounded bg-emerald-500/10 ring-1 ring-emerald-400/30 px-1 py-0.5' : ''}`}
                            >
                              {showSentenceField ? <span>{row.sentence || '—'}</span> : null}
                              {showSentenceAudioField ? (
                                sentenceSound ? (
                                  <button
                                    type="button"
                                    onClick={() => playBulkMediaFile(sentenceSound)}
                                    className="relative inline-flex items-center rounded p-0.5 text-emerald-300 hover:bg-white/10 hover:text-emerald-200"
                                    title={
                                      bulkFailedAudioFilenames.has(sentenceSound)
                                        ? t("Failed playing Audio, check source folder")
                                        : "Play sentence audio"
                                    }
                                  >
                                    {bulkFailedAudioFilenames.has(sentenceSound) ? (
                                      <VolumeOff className="size-4" />
                                    ) : (
                                      <Volume2 className="size-4" />
                                    )}
                                    {bulkLoadingAudioFilename === sentenceSound ? (
                                      <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-950">
                                        {bulkLoadingAudioSeconds}
                                      </span>
                                    ) : null}
                                  </button>
                                ) : (
                                  <span title={t("Missing SentenceAudio")}>
                                    <VolumeX className="size-4 text-slate-600" />
                                  </span>
                                )
                              ) : null}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              {showSentenceField ? (
                                <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-orange-500/10 text-orange-200 border border-orange-500/20">
                                  {t("Missing Sentence")}
                                </span>
                              ) : null}
                              {showSentenceField && row.noSentencesFound ? (
                                <span title={t("No Sentences found in the database")}>
                                  <AlertTriangle className="size-4 text-amber-300" />
                                </span>
                              ) : null}
                              {showSentenceAudioField ? (
                                <span title={t("Missing SentenceAudio")}>
                                  <VolumeX className="size-4 text-slate-600" />
                                </span>
                              ) : null}
                            </span>
                          )
                        ) : null}
                      </div>
                      {showTranslationField ? (
                        <div
                          className={`mt-1 text-xs text-slate-400 break-words whitespace-pre-wrap ${translationHighlighted ? 'rounded bg-emerald-500/10 ring-1 ring-emerald-400/30 px-1 py-0.5' : ''}`}
                        >
                          {row.translation.trim() ? (
                            row.translation
                          ) : (
                            <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-200 border border-amber-500/20">
                              {t("Missing Translation")}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                    </div>
                  );
                })}
                  </div>
                </div>
              </div>
            </div>

            </div>

            <DialogFooter className="mt-4 w-full flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 sm:ml-auto">
                {bulkDeckMode && !bulkTableOverrideNoteIds && bulkVisibleRows.length >= BULK_TABLE_PAGE_SIZE ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">
                      {bulkDeckTotal != null
                        ? t("bulkActions.deckLoadedOfTotal", { loaded: bulkDeckLoaded, total: bulkDeckTotal })
                        : t("bulkActions.deckLoading", { loaded: bulkDeckLoaded })}
                    </span>
                    {bulkDeckTotal != null && bulkDeckOffset < bulkDeckTotal ? (
                      <button
                        type="button"
                        onClick={() => void loadBulkDeckPage()}
                        disabled={bulkDeckLoading}
                        className={`rounded-md px-2 py-1 text-[11px] border transition-colors ${
                          bulkDeckLoading
                            ? 'bg-slate-800 border-slate-800 text-slate-500 cursor-not-allowed'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                        }`}
                      >
                        {bulkDeckLoading ? t("Working...") : t("bulkActions.loadMore")}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {bulkDisplayRows.length >= BULK_TABLE_PAGE_SIZE ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBulkTablePage((p) => Math.max(0, p - 1))}
                      disabled={bulkClampedTablePage <= 0}
                      className={`h-7 w-7 flex items-center justify-center rounded border transition-colors ${
                        bulkClampedTablePage <= 0
                          ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                      }`}
                      aria-label={t("Previous")}
                      title={t("Previous")}
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="text-[11px] text-slate-500">
                      {t("bulkActions.pageOf", { page: bulkClampedTablePage + 1, total: bulkPageCount })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBulkTablePage((p) => Math.min(bulkPageCount - 1, p + 1))}
                      disabled={bulkClampedTablePage >= bulkPageCount - 1}
                      className={`h-7 w-7 flex items-center justify-center rounded border transition-colors ${
                        bulkClampedTablePage >= bulkPageCount - 1
                          ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-800'
                      }`}
                      aria-label={t("Next")}
                      title={t("Next")}
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                ) : null}

              <button
                type="button"
                onClick={() => setBulkWriteConfirmOpen(true)}
                disabled={
                  bulkRunning ||
                  bulkTableOverrideNoteIds != null ||
                  !bulkHasPreviewChanges ||
                  bulkIncludedCount === 0 ||
                  bulkPendingWriteCount === 0
                }
                data-component="bulk-write-to-anki-button"
                className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                  bulkRunning ||
                  bulkTableOverrideNoteIds != null ||
                  !bulkHasPreviewChanges ||
                  bulkIncludedCount === 0 ||
                  bulkPendingWriteCount === 0
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
              >
                {t("bulkActions.writeToAnki")}
              </button>
              <DialogClose asChild>
                <button
                  disabled={bulkRunning}
                  data-component="bulk-actions-close-button"
                  className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600"
                >
                  {t("Close")}
                </button>
              </DialogClose>
              </div>
            </DialogFooter>

            <AlertDialog open={bulkEnhanceConfirmOpen} onOpenChange={setBulkEnhanceConfirmOpen}>
              <AlertDialogContent data-component="bulk-enhancements-confirm-dialog" className="bg-slate-900 border border-slate-700 text-slate-100">
                <AlertDialogHeader>
                  <AlertDialogTitle data-component="bulk-enhancements-confirm-title">{t("Apply Enhancements?")}</AlertDialogTitle>
                  <AlertDialogDescription data-component="bulk-enhancements-confirm-description" className="text-slate-300">
                    {t("bulkActions.applyEnhancementsConfirm", { n: bulkIncludedCount })}
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="mt-2 space-y-2">
                  {bulkEnhancementsSelected ? renderLargeActionWarning(bulkIncludedCount) : null}
                  <ul className="list-disc list-inside text-sm text-slate-300 space-y-1">
                    {bulkEnhanceAddSentence ? (
                      <li>
                        {t("bulkActions.addSentence")} — {t("bulkActions.missingSentenceCount", { n: bulkVisibleMissingCounts.sentence })}
                      </li>
                    ) : null}
                    {bulkEnhanceAddSentenceTranslation ? (
                      <li>
                        {t("bulkActions.addTranslation")} —{' '}
                        {t("bulkActions.missingTranslationCount", { n: bulkVisibleMissingCounts.translation })}
                      </li>
                    ) : null}
                    {bulkEnhanceAddTranslation ? (
                      <li>{t("bulkActions.addGlossaryTarget", { target: bulkEnhanceTargetLang })}</li>
                    ) : null}
                    {bulkEnhanceAddAudio ? (
                      <li>
                        {t("bulkActions.addAudioModel", {
                          model: getTtsVoiceLabel(bulkEnhanceSentenceAudioVoiceName, bulkTtsVoiceOptions),
                        })}
                      </li>
                    ) : null}
                    {bulkEnhanceAddSentenceAudio ? (
                      <li>
                        {t("bulkActions.addSentenceAudio")} —{' '}
                        {t("bulkActions.missingSentenceAudioCount", { n: bulkVisibleMissingCounts.sentenceAudio })}
                      </li>
                    ) : null}
                  </ul>
                  {bulkRunning ? (
                    <div className="pt-1 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span data-component="bulk-enhancements-progress-label">{t("Working…")}</span>
                        <span>
                          {Math.min(100, Math.round((bulkRandomDone / Math.max(1, bulkRandomTotal || 1)) * 100))}%
                        </span>
                      </div>
                      <Progress value={Math.min(100, Math.round((bulkRandomDone / Math.max(1, bulkRandomTotal || 1)) * 100))} />
                    </div>
                  ) : null}
                  {bulkEnhancementsBlocked ? (
                    <div className="text-xs text-amber-300">{t("Required API key is missing for the selected enhancements.")}</div>
                  ) : null}
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel data-component="bulk-enhancements-cancel-button" disabled={bulkRunning}>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    data-component="bulk-enhancements-apply-button"
                    disabled={bulkRunning || !bulkEnhancementsSelected || bulkEnhancementsBlocked || bulkIncludedCount === 0}
                    onClick={(e) => {
                      e.preventDefault();
                      setBulkEnhanceConfirmOpen(false);
                      void handleBulkApplyEnhancements();
                    }}
                    className="bg-blue-600 text-white hover:bg-blue-500"
                  >
                    {bulkRunning ? t("Working...") : t("Apply")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={bulkWriteConfirmOpen} onOpenChange={setBulkWriteConfirmOpen}>
              <AlertDialogContent data-component="bulk-write-confirm-dialog" className="bg-slate-900 border border-slate-700 text-slate-100">
                <AlertDialogHeader>
                  <AlertDialogTitle data-component="bulk-write-confirm-title">{t("bulkActions.writeConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription data-component="bulk-write-confirm-description" className="text-slate-300">
                    {t("bulkActions.writeConfirmDescription", { n: bulkPendingWriteCount })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {renderLargeActionWarning(bulkPendingWriteCount)}
                <AlertDialogFooter>
                  <AlertDialogCancel data-component="bulk-write-cancel-button" disabled={bulkRunning}>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    data-component="bulk-write-confirm-button"
                    disabled={bulkRunning || !bulkHasPreviewChanges || bulkIncludedCount === 0 || bulkPendingWriteCount === 0}
                    onClick={(e) => {
                      e.preventDefault();
                      void handleBulkWriteToAnki();
                    }}
                    className="bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    {t("bulkActions.writeToAnki")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Dialog open={bulkClearConfirmOpen} onOpenChange={setBulkClearConfirmOpen}>
              <DialogContent data-component="bulk-clear-fields-confirm-dialog" className="bg-slate-900/95 border border-slate-700 text-slate-100 shadow-2xl">
                <DialogHeader>
                  <DialogTitle data-component="bulk-clear-fields-confirm-title" className="text-2xl text-rose-400">{t("Confirm Removal")}</DialogTitle>
                  <DialogDescription data-component="bulk-clear-fields-confirm-description" className="text-slate-300">
                    {t("bulkActions.confirmClearFromNotes", { n: bulkIncludedCount })}
                  </DialogDescription>
                </DialogHeader>
                {renderLargeActionWarning(bulkIncludedCount)}

                <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg mt-3">
                  <ul className="list-disc list-inside space-y-1">
                    {clearFieldOptions
                      .filter((opt) => bulkClearInternalFields.includes(opt.id))
                      .map((opt) => (
                        <li key={opt.id} className="text-sm text-slate-200">
                          <span className="font-medium text-slate-100">{opt.label}</span>
                        </li>
                      ))}
                  </ul>
                  <p className="mt-3 text-xs text-amber-500 font-medium">
                    {t("This action will immediately update your Anki deck.")}
                  </p>
                </div>

                <DialogFooter className="mt-4 flex justify-end gap-2">
                  <DialogClose asChild>
                    <button data-component="bulk-clear-fields-cancel-button" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                      {t("Cancel")}
                    </button>
                  </DialogClose>
                  <button
                    data-component="bulk-clear-fields-confirm-button"
                    onClick={(e) => {
                      e.preventDefault();
                      setBulkClearConfirmOpen(false);
                      void handleBulkClearFields();
                    }}
                    disabled={bulkRunning || bulkClearInternalFields.length === 0 || bulkIncludedCount === 0}
                    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      bulkRunning || bulkClearInternalFields.length === 0 || bulkIncludedCount === 0
                        ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                  >
                    {t("Yes, clear fields")}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      </div>
    );
}

WordGrid.displayName = 'WordGrid';
