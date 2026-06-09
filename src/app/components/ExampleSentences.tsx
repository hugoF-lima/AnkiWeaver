import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Filter, Search, Volume2 } from 'lucide-react';
import { fetchSentencesFor } from '../hooks/useSentences';
import { tatoebaAudioUrl } from '../utils/audio.ts';
import { useIsMobile } from './ui/use-mobile';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

interface Example {
  sentence: string;
  translation: string;
  translationLang?: "en" | "pt";
  audioId?: string;
  hasAudio?: boolean;
  source?: 'tatoeba';
}

type SentenceMode = "jp-en" | "jp-pt" | "all";

//for modifying anki flashcard
interface ExampleSentencesProps {
  examples?: Example[];            // optional; if not provided, component will fetch using `word`
  word?: string;                   // the searched word to fetch sentences for
  noteId?: number;                 // optional: noteId to use when updating
  mapping?: Record<string, string>;
  settingsEpoch?: number;
  onUpdateCard: (jp: string, en: string, audioId?: string, noteId?: number, ttsVoiceName?: string) => void | Promise<void>;
  isActive: boolean;
  onActivate: () => void;
  //onSentenceUpdated?: () => void
}

export const ExampleSentences = forwardRef<HTMLDivElement, ExampleSentencesProps>(
  ({ examples, onUpdateCard, isActive, onActivate, word, noteId, mapping, settingsEpoch = 0 }, ref) => {
    const { t, i18n } = useTranslation();
    const [localExamples, setLocalExamples] = useState<Example[]>([]);
    const [fetchedExamples, setFetchedExamples] = useState<Array<Omit<Example, "translation"> & { en: string; pt: string }>>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
    const [page, setPage] = useState(0);
    const perPage = 10;
    const [hasNextPage, setHasNextPage] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
    const [selectedSources, setSelectedSources] = useState<string[]>(['tatoeba']);
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const audioLoadingIntervalRef = useRef<number | null>(null);
    const audioLoadingHideTimeoutRef = useRef<number | null>(null);
    const audioLoadingKeyRef = useRef<string | null>(null);
    const displayLang = i18n.language === "pt-BR" ? "pt-BR" : "en";
    const [sentenceMode, setSentenceMode] = useState<SentenceMode>(displayLang === "pt-BR" ? "jp-pt" : "jp-en");
    const [translateToDisplayEnabled, setTranslateToDisplayEnabled] = useState(false);

    type SentencePreviewSelection = { mode: 'none' | 'tatoeba' | 'tts'; ttsVoiceName: string };
    const [previewSelections, setPreviewSelections] = useState<Record<string, SentencePreviewSelection>>({});
    const [ttsPreviewing, setTtsPreviewing] = useState(false);
    const [previewMenuOpenKey, setPreviewMenuOpenKey] = useState<string | null>(null);
    // Start empty — only populated when server reports available voices (implies keys present)
    const [ttsVoiceOptions, setTtsVoiceOptions] = useState<Array<{ id: string; label: string }>>([]);
    const [audioLoadingKey, setAudioLoadingKey] = useState<string | null>(null);
    const [audioLoadingPercent, setAudioLoadingPercent] = useState(0);

    const getExampleKey = useCallback((ex: Example) => {
      return `${ex.sentence}|||${ex.translation}|||${ex.audioId ?? ''}`;
    }, []);

    const clearAudioLoadingTimers = useCallback(() => {
      if (audioLoadingIntervalRef.current != null) {
        window.clearInterval(audioLoadingIntervalRef.current);
        audioLoadingIntervalRef.current = null;
      }
      if (audioLoadingHideTimeoutRef.current != null) {
        window.clearTimeout(audioLoadingHideTimeoutRef.current);
        audioLoadingHideTimeoutRef.current = null;
      }
    }, []);

    const startAudioLoading = useCallback((key: string) => {
      clearAudioLoadingTimers();
      audioLoadingKeyRef.current = key;
      setAudioLoadingKey(key);
      setAudioLoadingPercent(0);
      audioLoadingIntervalRef.current = window.setInterval(() => {
        setAudioLoadingPercent((prev) => (prev >= 90 ? prev : Math.min(90, prev + 5)));
      }, 120);
    }, [clearAudioLoadingTimers]);

    const stopAudioLoading = useCallback((key?: string) => {
      if (key && audioLoadingKeyRef.current !== key) return;
      clearAudioLoadingTimers();
      audioLoadingKeyRef.current = key && audioLoadingKeyRef.current !== key ? audioLoadingKeyRef.current : null;
      setAudioLoadingKey((prev) => (key && prev !== key ? prev : null));
      setAudioLoadingPercent(0);
    }, [clearAudioLoadingTimers]);

    const completeAudioLoading = useCallback((key?: string) => {
      if (key && audioLoadingKeyRef.current !== key) return;
      if (audioLoadingIntervalRef.current != null) {
        window.clearInterval(audioLoadingIntervalRef.current);
        audioLoadingIntervalRef.current = null;
      }
      setAudioLoadingPercent(100);
      audioLoadingHideTimeoutRef.current = window.setTimeout(() => {
        audioLoadingKeyRef.current = key && audioLoadingKeyRef.current !== key ? audioLoadingKeyRef.current : null;
        setAudioLoadingKey((prev) => (key && prev !== key ? prev : null));
        setAudioLoadingPercent(0);
        audioLoadingHideTimeoutRef.current = null;
      }, 600);
    }, []);

    const playAudio = useCallback((url: string | null | undefined, key: string) => {
      if (!url) return;

      let player = audioPlayerRef.current;
      if (!player) {
        player = new Audio();
        player.preload = 'auto';
        audioPlayerRef.current = player;
      }

      try {
        if (!player.paused) {
          player.pause();
        }
        startAudioLoading(key);
        if (player.src !== url) {
          player.src = url;
          player.load();
        }
        player.currentTime = 0;
        const updateProgress = () => {
          try {
            if (!Number.isFinite(player!.duration) || player!.duration <= 0 || player!.buffered.length === 0) {
              return;
            }
            const bufferedEnd = player!.buffered.end(player!.buffered.length - 1);
            const ratio = Math.max(0, Math.min(1, bufferedEnd / player!.duration));
            const nextPercent = Math.min(99, Math.max(5, Math.round(ratio * 100)));
            setAudioLoadingPercent((prev) => Math.max(prev, nextPercent));
          } catch {
            // Ignore buffered-range errors while the browser is still attaching media data.
          }
        };
        const handleReady = () => {
          completeAudioLoading(key);
          cleanupListeners();
        };
        const handleError = () => {
          stopAudioLoading(key);
          cleanupListeners();
        };
        const cleanupListeners = () => {
          player?.removeEventListener('loadedmetadata', updateProgress);
          player?.removeEventListener('progress', updateProgress);
          player?.removeEventListener('canplaythrough', updateProgress);
          player?.removeEventListener('canplay', handleReady);
          player?.removeEventListener('playing', handleReady);
          player?.removeEventListener('error', handleError);
        };
        player.addEventListener('loadedmetadata', updateProgress);
        player.addEventListener('progress', updateProgress);
        player.addEventListener('canplaythrough', updateProgress);
        player.addEventListener('canplay', handleReady, { once: true });
        player.addEventListener('playing', handleReady, { once: true });
        player.addEventListener('error', handleError, { once: true });
        void player.play().catch((err) => {
          stopAudioLoading(key);
          cleanupListeners();
          console.error('Audio playback failed', err);
        });
      } catch (err) {
        stopAudioLoading(key);
        console.error('Audio playback failed', err);
      }
    }, [completeAudioLoading, startAudioLoading, stopAudioLoading]);

    useEffect(() => {
      return () => {
        clearAudioLoadingTimers();
        audioLoadingKeyRef.current = null;
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
        }
      };
    }, [clearAudioLoadingTimers]);

    useEffect(() => {
      const q = (word || "").trim();
      if (q) return;
      setLocalExamples(Array.isArray(examples) ? examples : []);
    }, [examples, word]);

    useEffect(() => {
      setSearchInput('');
      setDebouncedSearch('');
      setPage(0);
      setSelectedIdx(null);
      setLocalExamples([]);
      setFetchedExamples([]);
      setHasNextPage(false);
    }, [word]);

    useEffect(() => {
      setSentenceMode(displayLang === "pt-BR" ? "jp-pt" : "jp-en");
      setTranslateToDisplayEnabled(false);
    }, [displayLang]);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch('/api/tts/voice');
          if (!res.ok) return;
          const data = await res.json();
          if (cancelled) return;
          const voices = Array.isArray(data?.voices) ? data.voices : [];
          const normalized = voices
            .map((voice: any) => ({
              id: String(voice?.id ?? '').trim(),
              label: String(voice?.label ?? voice?.id ?? '').trim(),
            }))
            .filter((voice: { id: string; label: string }) => voice.id);
          setTtsVoiceOptions(normalized);
        } catch {
          if (!cancelled) setTtsVoiceOptions([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [settingsEpoch]);

    const isTtsVoiceAvailable = useCallback(
      (voiceName: string) => ttsVoiceOptions.some((voice) => voice.id === voiceName),
      [ttsVoiceOptions]
    );

    const getDefaultPreviewSelection = useCallback(
      (hasTatoebaAudio: boolean): SentencePreviewSelection =>
        hasTatoebaAudio ? { mode: 'tatoeba', ttsVoiceName: '' } : { mode: 'none', ttsVoiceName: '' },
      []
    );

    useEffect(() => {
      const t = window.setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
      return () => window.clearTimeout(t);
    }, [searchInput]);

    // Clear selection when the examples list changes
    useEffect(() => {
      setSelectedIdx(null);
    }, [localExamples]);

    useEffect(() => {
      let canceled = false;
      const hasTatoeba = selectedSources.includes('tatoeba');
      const q = (word || '').trim();
      if (!q || !hasTatoeba) {
        setLocalExamples([]);
        setHasNextPage(false);
        return;
      }

      setLoading(true);
      setError(null);
      fetchSentencesFor(q, perPage, page)
        .then((sents) => {
          if (canceled) return;
          const mapped = sents.map((s) => ({
            sentence: s.jp,
            en: String(s.en || ""),
            pt: String(s.pt || ""),
            audioId: s.audio_id,
            hasAudio: s.has_audio,
            source: 'tatoeba' as const,
          }));

          setFetchedExamples(mapped);
          setHasNextPage(mapped.length >= perPage);
        })
        .catch((e) => {
          if (!canceled) setError(String(e));
        })
        .finally(() => {
          if (!canceled) setLoading(false);
        });

      return () => {
        canceled = true;
      };
    }, [word, page, selectedSources]);

    useEffect(() => {
      if (fetchedExamples.length === 0) return;

      const mapped = fetchedExamples
        .map((ex) => {
          if (sentenceMode === "jp-en") {
            return {
              sentence: ex.sentence,
              translation: ex.en,
              translationLang: "en" as const,
              audioId: ex.audioId,
              hasAudio: ex.hasAudio,
              source: ex.source,
            };
          }
          if (sentenceMode === "jp-pt") {
            return {
              sentence: ex.sentence,
              translation: ex.pt,
              translationLang: "pt" as const,
              audioId: ex.audioId,
              hasAudio: ex.hasAudio,
              source: ex.source,
            };
          }

          const en = ex.en || "";
          const pt = ex.pt || "";
          if (displayLang === "pt-BR") {
            return {
              sentence: ex.sentence,
              translation: pt || en,
              translationLang: pt ? ("pt" as const) : en ? ("en" as const) : undefined,
              audioId: ex.audioId,
              hasAudio: ex.hasAudio,
              source: ex.source,
            };
          }
          return {
            sentence: ex.sentence,
            translation: en || pt,
            translationLang: en ? ("en" as const) : pt ? ("pt" as const) : undefined,
            audioId: ex.audioId,
            hasAudio: ex.hasAudio,
            source: ex.source,
          };
        })
        .filter((ex) => {
          if (sentenceMode === "jp-en") return Boolean(ex.translation.trim());
          if (sentenceMode === "jp-pt") return Boolean(ex.translation.trim());
          return true;
        });

      setLocalExamples(mapped);
    }, [displayLang, fetchedExamples, sentenceMode]);

    const handlePlay = (e: React.MouseEvent, example: Example) => {
      e.stopPropagation();
      const key = getExampleKey(example);
      const hasTatoebaAudio = Boolean(example.audioId);
      const preview = previewSelections[key] ?? getDefaultPreviewSelection(hasTatoebaAudio);

      if (preview.mode === 'none') return;
      if (preview.mode === 'tts') {
        const text = (example.sentence || '').trim();
        if (!text) return;
        if (ttsPreviewing) return;
        if (!isTtsVoiceAvailable(preview.ttsVoiceName)) return;
        setTtsPreviewing(true);
        fetch(`/api/tts/voice-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceName: preview.ttsVoiceName }),
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(await res.text());
            return res.json();
          })
          .then((data) => {
            const url = data?.audioUrl ? String(data.audioUrl) : '';
            if (!url) return;
            playAudio(url, `${key}:tts`);
          })
          .catch((err) => {
            console.error('TTS preview failed', err);
          })
          .finally(() => {
            setTtsPreviewing(false);
          });
        return;
      }

      // 1️⃣ Confirm the handler is actually firing
      console.log('[handlePlay] clicked example:', example);

      // 2️⃣ Inspect the audioId specifically
      console.log('[handlePlay] audioId:', example.audioId, typeof example.audioId);

      // 3️⃣ Inspect the final URL
      const url = tatoebaAudioUrl(example.audioId);

      console.log('[handlePlay] audio URL:', url);

      if (!url) return;
      playAudio(url, `${key}:tatoeba`);
    };

    const handleSelect = (index: number) => {
      setSelectedIdx(prev => (prev === index ? null : index));
    };

    const handleKey = (e: React.KeyboardEvent, index: number) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect(index);
      }
    };

    const selected = selectedIdx !== null ? localExamples[selectedIdx] : null;
    const topDisabled = selected === null;
    const isMobile = useIsMobile();

    // Check mapping for active fields
    const isSentenceActive = !mapping || !!mapping['sentence'];
    const isTranslationActive = !mapping || !!mapping['translation'];
    const isAudioActive = !mapping || !!mapping['sentence_audio'];
    const deeplTargetLang = displayLang === "pt-BR" ? "pt-BR" : "en-US";
    const displayLanguageLabel =
      displayLang === "pt-BR" ? t("Portuguese (Brazil)") : t("English (US)");
    const selectionIsMismatched =
      displayLang === "pt-BR"
        ? selected?.translationLang === "en" || sentenceMode === "jp-en"
        : selected?.translationLang === "pt" || sentenceMode === "jp-pt";
    const showTranslateSwitch =
      isTranslationActive &&
      Boolean(noteId) &&
      selectionIsMismatched &&
      Boolean((selected?.translation || "").trim());

    const visibleExamples = debouncedSearch
      ? localExamples.filter((ex) => {
          const q = debouncedSearch.toLowerCase();
          return (
            ex.sentence.toLowerCase().includes(q) ||
            ex.translation.toLowerCase().includes(q)
          );
        })
      : localExamples;

    return (
      <div
        data-component="ExampleSentences"
        className={`flex flex-col bg-transparent transition-all duration-300 rounded-lg overflow-hidden ${
          isActive ? 'border border-blue-400 shadow-lg' : 'border border-slate-300 shadow-sm'
        }`}
        onClick={onActivate}
      >
        <div data-component="example-sentences-header" data-section="header" className="sticky top-0 bg-slate-800 z-10 px-6 py-4 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <h2 data-component="recommended-sentences-title" className="text-white text-lg font-medium">{t("Recommended Sentences:")}</h2>
            <button
              data-component="update-card-with-sentence-button"
              data-action="update-card-with-sentence"
              onClick={async () => {
                if (!selected || !noteId) return;
                console.log('ExampleSentences: onUpdateCard', { selected, noteId });
                
                // Only pass fields that are active in mapping
                const selectedKey = getExampleKey(selected);
                const hasTatoebaAudio = Boolean(selected.audioId);
                const preview = previewSelections[selectedKey] ?? getDefaultPreviewSelection(hasTatoebaAudio);
                const wantsTts = preview.mode === 'tts' && isTtsVoiceAvailable(preview.ttsVoiceName);
                const shouldGenerateTts = Boolean(wantsTts && isAudioActive && isSentenceActive && selected.sentence.trim());
                const sentenceToSave = isSentenceActive ? selected.sentence : "";
                let translationToSave = isTranslationActive ? selected.translation : "";
                if (showTranslateSwitch && translateToDisplayEnabled) {
                  const base = (translationToSave || "").trim();
                  if (base) {
                    try {
                      const res = await fetch(`/api/notes/${noteId}/translate`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text: base, target_lang: deeplTargetLang }),
                      });
                      if (res.ok) {
                        const data = await res.json().catch(() => null);
                        const translatedText = data?.translated_text ? String(data.translated_text) : "";
                        if (translatedText.trim()) {
                          translationToSave = translatedText;
                        }
                      }
                    } catch (e) {
                      console.error("Translate-to-display failed", e);
                    }
                  }
                }

                await Promise.resolve(
                  onUpdateCard(
                    sentenceToSave,
                    translationToSave,
                    !shouldGenerateTts && isAudioActive ? selected.audioId : undefined,
                    noteId,
                    shouldGenerateTts ? preview.ttsVoiceName : undefined,
                  ),
                );
                setSelectedIdx(null);
              }}
              disabled={topDisabled || !noteId}
              aria-disabled={topDisabled || !noteId}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors shadow-sm ${
                (topDisabled || !noteId) ? 'bg-slate-300 text-slate-600 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
              }`}
            >
              {isMobile ? t("Update") : t("Update Card w/ Sentence")}
            </button>
          </div>

          <div data-component="example-sentences-controls" className="mt-3 flex items-center gap-2">
            <div data-component="example-sentences-search" className="relative flex-1">
              <input
                data-component="sentence-search-input"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-9 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("Search sentences...")}
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={sentenceMode}
                onValueChange={(v) => {
                  const next = (v as any) as SentenceMode;
                  setSentenceMode(next);
                  setTranslateToDisplayEnabled(false);
                  setPage(0);
                }}
              >
                <SelectTrigger
                  className="h-10 w-[140px] bg-slate-900 border-slate-700 text-slate-100"
                  aria-label={t("Sentence pair")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                  <SelectItem value="jp-en">{t("JP -> EN")}</SelectItem>
                  <SelectItem value="jp-pt">{t("JP -> PT")}</SelectItem>
                  <SelectItem value="all">{t("All")}</SelectItem>
                </SelectContent>
              </Select>

              {showTranslateSwitch && (
                <label className="flex items-center gap-2 text-xs text-slate-200 select-none">
                  <Switch
                    checked={translateToDisplayEnabled}
                    onCheckedChange={(v) => setTranslateToDisplayEnabled(Boolean(v))}
                  />
                  <span>{t("Translate to {{language}}", { language: displayLanguageLabel })}</span>
                </label>
              )}
            </div>

            <Popover open={sourceMenuOpen} onOpenChange={setSourceMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-component="sources-filter-trigger"
                  className={`h-10 px-3 rounded-lg border transition-colors flex items-center gap-2 ${
                    selectedSources.length > 0
                      ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                  title={t("Sources")}
                >
                  <Filter className="size-4" />
                  <span className="text-xs">{t("Sources")}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                data-component="sources-filter-menu"
                className="w-48 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                sideOffset={8}
              >
                <button
                  type="button"
                  data-component="sources-filter-option-tatoeba"
                  onClick={() => {
                    const enabled = selectedSources.includes('tatoeba');
                    setSelectedSources(enabled ? [] : ['tatoeba']);
                    setPage(0);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-slate-800"
                >
                  <span className="text-slate-200">Tatoeba</span>
                  {selectedSources.includes('tatoeba') ? <Check className="size-4 text-blue-400" /> : null}
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div ref={ref} data-component="example-sentences-content" className="p-6 pt-4" style={{background: `linear-gradient(to bottom right, var(--anki-bg-start), var(--anki-bg-end))`,
          borderColor: `var(--anki-border)` }} onScroll={onActivate}>
          {loading && <p data-component="example-sentences-loading" className="p-4 text-slate-600">{t("Loading sentences...")}</p>}
          {error && <p data-component="example-sentences-error" className="p-4 text-red-500">{t("common.errorWithMessage", { error })}</p>}
          <div data-component="example-sentences-list" className="space-y-4">
            {(visibleExamples || []).map((example, index) => {
              const isSelected = selectedIdx === index;
              const exampleKey = getExampleKey(example);
              const hasTatoebaAudio = Boolean(example.audioId);
              const preview = previewSelections[exampleKey] ?? getDefaultPreviewSelection(hasTatoebaAudio);
              const canPlay =
                preview.mode === 'tts'
                  ? Boolean(example.sentence?.trim()) && isTtsVoiceAvailable(preview.ttsVoiceName)
                  : preview.mode === 'tatoeba'
                  ? Boolean(example.audioId)
                  : false;
              return (
                <div
                  key={index}
                  data-component="example-sentence-item"
                  onClick={() => handleSelect(index)}
                  onKeyDown={(e) => handleKey(e, index)}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  className={`relative p-4 rounded-lg border transition-shadow cursor-pointer focus:outline-none ${
                    isSelected
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300 shadow-md'
                      : 'border-slate-200 bg-white hover:shadow-md'
                  }`} style={{background: `linear-gradient(to bottom right, var(--anki-bg-start), var(--anki-bg-end))`}}
                >
                  <div className="flex items-start gap-3">
                    {isAudioActive && (
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="inline-flex items-stretch rounded-lg bg-slate-900/60 shadow-sm overflow-hidden">
                          <button
                            data-component="example-audio-play-button"
                            onClick={(e) => handlePlay(e, example)}
                            className={`relative m-0.5 p-2 rounded-full transition-colors ${
                              (!canPlay || ttsPreviewing)
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                : 'bg-blue-500 text-white hover:bg-blue-600'
                            }`}
                            disabled={!canPlay || ttsPreviewing}
                            aria-label={t("Play audio")}
                            title={
                              preview.mode === 'tts'
                                ? t("Preview TTS")
                                : preview.mode === 'tatoeba'
                                ? t("Play Tatoeba audio")
                                : t("Choose preview options")
                            }
                          >
                            <Volume2 className="size-4" />
                            {audioLoadingKey?.startsWith(`${exampleKey}:`) ? (
                              <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-950">
                                {audioLoadingPercent}%
                              </span>
                            ) : null}
                          </button>

                          <Popover
                            open={previewMenuOpenKey === exampleKey}
                            onOpenChange={(open) => {
                              setPreviewMenuOpenKey(open ? exampleKey : null);
                            }}
                          >
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                data-component="example-preview-options-trigger"
                                onClick={(e) => e.stopPropagation()}
                                className="m-0.5 w-5 flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800/80 transition-colors"
                                title={t("Preview options")}
                                aria-label={t("Preview options")}
                              >
                                <ChevronDown className="size-4" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              data-component="example-preview-options-menu"
                              className="w-56 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                              sideOffset={8}
                            >
                              {hasTatoebaAudio ? (
                                <>
                                  <div data-component="preview-source-title" className="text-[10px] font-bold text-slate-500 px-1 pb-2 uppercase tracking-wider">
                                    {t("Preview Source")}
                                  </div>
                                  <button
                                    type="button"
                                    data-component="preview-source-tatoeba-button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPreviewSelections((prev) => ({
                                        ...prev,
                                        [exampleKey]: { mode: 'tatoeba', ttsVoiceName: preview.ttsVoiceName },
                                      }));
                                      setPreviewMenuOpenKey(null);
                                    }}
                                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-slate-800 ${
                                      preview.mode === 'tatoeba' ? 'text-blue-200' : 'text-slate-200'
                                    }`}
                                  >
                                    <span className="text-sm">{t("Tatoeba audio")}</span>
                                    {preview.mode === 'tatoeba' ? <Check className="size-4 text-blue-400" /> : null}
                                  </button>
                                </>
                              ) : null}

                              {ttsVoiceOptions.length > 0 ? (
                                <>
                                  <div data-component="tts-models-title" className={`${hasTatoebaAudio ? 'mt-2' : ''} text-[10px] font-bold text-slate-500 px-1 pb-2 uppercase tracking-wider`}>
                                    {t("TTS Models")}
                                  </div>
                                  {ttsVoiceOptions.map((voice) => (
                                    <button
                                      key={voice.id}
                                      type="button"
                                      data-component="tts-model-option-button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewSelections((prev) => ({
                                          ...prev,
                                          [exampleKey]: { mode: 'tts', ttsVoiceName: voice.id },
                                        }));
                                        setPreviewMenuOpenKey(null);
                                      }}
                                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-slate-800 ${
                                        preview.mode === 'tts' && preview.ttsVoiceName === voice.id
                                          ? 'text-blue-200'
                                          : 'text-slate-200'
                                      }`}
                                    >
                                      <span className="text-sm">{voice.label}</span>
                                      {preview.mode === 'tts' && preview.ttsVoiceName === voice.id ? (
                                        <Check className="size-4 text-blue-400" />
                                      ) : null}
                                    </button>
                                  ))}
                                </>
                              ) : null}
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    )}
                    <div className="flex-1 pt-4">
                      <span data-component="example-source-tag" className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full bg-slate-800/60 text-slate-200 border border-slate-700">
                        {example.source === 'tatoeba' ? 'Tatoeba' : 'Tatoeba'}
                      </span>
                      {isSentenceActive && <p data-component="example-sentence-text" className="text-slate-600 mb-2">{example.sentence}</p>}
                      {isTranslationActive && <p data-component="example-translation-text" className="text-slate-600 italic">{example.translation}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
            {!loading && visibleExamples.length === 0 && (
              <p data-component="example-sentences-empty-state" className="text-slate-600 p-4">
                {localExamples.length === 0 ? t("No sentences found for this word.") : t("No results on this page.")}
              </p>
            )}
          </div>

          <div data-component="example-sentences-pagination" className="mt-4 flex items-center justify-between">
            <div data-component="page-indicator" className="text-xs text-slate-400">
              {t("common.page", { page: page + 1 })}
            </div>
            <div data-component="pagination-controls" className="flex items-center gap-2">
              <button
                type="button"
                data-component="previous-page-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPage((p) => Math.max(0, p - 1));
                }}
                disabled={page === 0}
                className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors ${
                  page === 0 ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
                aria-label={t("Previous page")}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                data-component="next-page-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!hasNextPage) return;
                  setPage((p) => p + 1);
                }}
                disabled={!hasNextPage}
                className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors ${
                  !hasNextPage ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed' : 'bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800'
                }`}
                aria-label={t("Next page")}
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ExampleSentences.displayName = 'ExampleSentences';
