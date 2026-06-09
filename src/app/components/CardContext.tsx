import { useRef, forwardRef, useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronDown, MoreVertical, Languages, ExternalLink, Save, Trash2, Check, RotateCw, Volume2, Pencil } from 'lucide-react';
import { useIsMobile } from './ui/use-mobile';
import { useTranslation } from "react-i18next";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "../i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from "./ui/dialog";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
// Adjust the path to match your folder structure

//"./ui/dialog"

interface CardField {
  label: string;
  value: string;
}

interface CardContextProps {
  fields: CardField[];
  isActive: boolean;
  onActivate: () => void;
  noteId?: number;
  word?: string;
  mapping?: Record<string, string>;
  settingsEpoch?: number;
  // We need a prop/function to let the parent update the actual field data
  onUpdateField?: (noteId: number, label: string, value: string) => void;
  // Pass explicit noteId to avoid races between selection and update
  onUpdateCard?: (jp: string, en: string, audioId?: string, noteId?: number, ttsVoiceName?: string) => void | Promise<void>;
}

const PRIMARY_FIELDS = new Set([
  'Sentence',
  'SentenceTranslation',
  'SentenceAudio',
]);


export const CardContext = forwardRef<HTMLDivElement, CardContextProps>(
  ({ fields, isActive, noteId, word, mapping, settingsEpoch = 0, onActivate, onUpdateField, onUpdateCard }, ref) => {
    const { t } = useTranslation();
    const [showMore, setShowMore] = useState(false);
    
    // State to manage whether the API or manual deep link should be used
    const [useApiTranslation, setUseApiTranslation] = useState(false); // Default to manual link
    const [hasDeeplKey, setHasDeeplKey] = useState(false);
    // State to manage if the translation field is currently editable (for manual paste)
    const [isTranslationEditable, setIsTranslationEditable] = useState(false);
    const [isManualEditMode, setIsManualEditMode] = useState(false);
    const [editPromptFor, setEditPromptFor] = useState<'sentence' | 'translation' | null>(null);
    const [sentenceDraft, setSentenceDraft] = useState('');
    const [translationDraft, setTranslationDraft] = useState('');
    const [manualSaveRunning, setManualSaveRunning] = useState(false);
    const [pasteSaveRunning, setPasteSaveRunning] = useState(false);
    const [translationInvite, setTranslationInvite] = useState(false);
    const translationInviteTimeoutRef = useRef<number | null>(null);

    
    //removing logic and checking availability
    const [isRemoveMenuOpen, setIsRemoveMenuOpen] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    
    //I need to rethink the purpose of fieldsToClear, as it feels redundant with 
    //availableOptions variable.
    
    const [fieldsToClear, setFieldsToClear] = useState<string[]>([]); // (["Sentence", "SentenceAudio", "SentenceTranslation"]);
    const toggleField = (field: string) => {
      setFieldsToClear(prev => 
        prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
      );
    };
    useEffect(() => {
      // Automatically check all boxes that have data whenever we switch cards
      const validIds = availableOptions.map(opt => opt.id);
      setFieldsToClear(validIds);
    }, [noteId]); // Only runs when you click a different word

    //translation related

    const [hasOpenedDeepL, setHasOpenedDeepL] = useState(false);

    const refreshDeeplKey = useCallback(async () => {
      try {
        const res = await fetch('/api/settings/env');
        if (!res.ok) return false;
        const data = await res.json();
        const hasKey = Boolean(String(data?.DEEPL_AUTH_KEY ?? '').trim());
        setHasDeeplKey(hasKey);
        setUseApiTranslation(hasKey);
        return hasKey;
      } catch {
        setHasDeeplKey(false);
        setUseApiTranslation(false);
        return false;
      }
    }, []);

    useEffect(() => {
      if (!isActive) return;
      void refreshDeeplKey();
    }, [isActive, refreshDeeplKey]);

    //checking fields
    const getField = (internalKey: string, defaultLabel: string) => {
      // If mapping is provided, only return fields that are mapped AND exist in note
      if (mapping) {
        const mappedLabel = mapping[internalKey];
        if (!mappedLabel) {
          if (internalKey === 'expression_audio') {
            return fields.find(f => f.label === defaultLabel);
          }
          return undefined;
        } // Disabled
        return fields.find(f => f.label === mappedLabel);
      }
      // Legacy fallback
      return fields.find(f => f.label === defaultLabel);
    };

    const sentence = getField('sentence', 'Sentence');
    const translation = getField('translation', 'SentenceTranslation');
    const audio = getField('sentence_audio', 'SentenceAudio');
    const audioMatch = audio?.value.match(/\[sound:(.+?)\]/);
    const audioFilename = audioMatch?.[1]?.trim();

    const wordAudioField =
      getField('expression_audio', 'Audio') ||
      fields.find((f) => /^(Audio|WordAudio|ExpressionAudio)$/i.test(f.label)) ||
      (audio?.label ? fields.find((f) => /Audio$/i.test(f.label) && f.label !== audio.label) : undefined);
    const wordAudioMatch = wordAudioField?.value.match(/\[sound:(.+?)\]/);
    const wordAudioFilename = wordAudioMatch?.[1]?.trim();

    const isWordAudioDisabled = Boolean(mapping && ('expression_audio' in mapping) && !mapping['expression_audio']);

    const cleanSentenceFieldText = useCallback((value: string) => {
      let s = String(value ?? '');
      s = s.replace(/<br\s*\/?>/gi, '\n');
      s = s.replace(/&nbsp;/gi, ' ');
      s = s.replace(/<[^>]*>/g, '');
      s = s.replace(/\r\n/g, '\n');
      return s.trim();
    }, []);

    const sentenceText = cleanSentenceFieldText(sentence?.value ?? '');
    const translationText = cleanSentenceFieldText(translation?.value ?? '');

    //aid for the remove button logic
    const hasSentence = Boolean(sentenceText);
    const hasTranslation = Boolean(translationText);
    const hasAudio = !!audioMatch; // Uses your existing regex match

    // Determine if the "Clear" button should exist at all
    const hasAnythingToClear = hasSentence || hasTranslation || hasAudio;

    const BACKEND_URL = "http://localhost:8000";

    const audioSrc = audioFilename
      ? `${BACKEND_URL}/media/${encodeURIComponent(audioFilename)}`
      : null;

    const wordAudioSrc = wordAudioFilename
      ? `${BACKEND_URL}/media/${encodeURIComponent(wordAudioFilename)}`
      : null;

    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const audioLoadingIntervalRef = useRef<number | null>(null);
    const audioLoadingHideTimeoutRef = useRef<number | null>(null);
    const audioLoadingKeyRef = useRef<string | null>(null);
    const [audioLoadingKey, setAudioLoadingKey] = useState<string | null>(null);
    const [audioLoadingPercent, setAudioLoadingPercent] = useState(0);
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
    const playAudio = useCallback((url: string | null, key: string) => {
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
          toast.error(t('Audio playback failed. This usually means the Anki media file is missing or invalid.'));
        });
      } catch (err) {
        stopAudioLoading(key);
        console.error('Audio playback failed', err);
        toast.error(t('Audio playback failed. This usually means the Anki media file is missing or invalid.'));
      }
    }, [completeAudioLoading, startAudioLoading, stopAudioLoading, t]);

    useEffect(() => {
      return () => {
        clearAudioLoadingTimers();
        audioLoadingKeyRef.current = null;
        if (audioPlayerRef.current) {
          audioPlayerRef.current.pause();
        }
      };
    }, [clearAudioLoadingTimers]);

    const [isTtsMenuOpen, setIsTtsMenuOpen] = useState(false);
    // Start with empty list — will be populated only when server reports available voices (i.e. keys present)
    const [ttsVoice, setTtsVoice] = useState<string>('');
    const [ttsVoiceOptions, setTtsVoiceOptions] = useState<Array<{ id: string; label: string }>>([]);
    const [ttsGenerating, setTtsGenerating] = useState(false);
    const [ttsPreviewing, setTtsPreviewing] = useState(false);

    const hasWordAudio = Boolean(wordAudioMatch);
    const sentenceAudioEligible = Boolean(noteId && audio && !hasAudio);
    const expressionAudioEligible = Boolean(noteId && wordAudioField && !hasWordAudio && !isWordAudioDisabled && (word || '').trim());

    const canGenerateSentenceAudio = Boolean(sentenceAudioEligible && hasSentence);
    const canGenerateExpressionAudio = Boolean(expressionAudioEligible);

    const [ttsFillSentenceAudio, setTtsFillSentenceAudio] = useState(false);
    const [ttsFillExpressionAudio, setTtsFillExpressionAudio] = useState(false);

    useEffect(() => {
      setTtsFillSentenceAudio(canGenerateSentenceAudio);
      setTtsFillExpressionAudio(canGenerateExpressionAudio);
    }, [noteId, canGenerateSentenceAudio, canGenerateExpressionAudio]);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch('/api/tts/voice');
          if (!res.ok) return;
          const data = await res.json();
          if (cancelled) return;
          const voices = Array.isArray(data?.voices) ? data.voices : [];
          const normalized: Array<{ id: string; label: string }> = voices
            .map((voice: any) => ({
              id: String(voice?.id ?? '').trim(),
              label: String(voice?.label ?? voice?.id ?? '').trim(),
            }))
            .filter((voice: { id: string; label: string }) => voice.id);
          setTtsVoiceOptions(normalized);
          const defaultVoice = String(data?.defaultVoiceName ?? data?.voiceName ?? normalized[0]?.id ?? '').trim();
          setTtsVoice((prev) => (normalized.some((voice) => voice.id === prev) ? prev : defaultVoice));
        } catch {
          if (!cancelled) {
            setTtsVoiceOptions([]);
            setTtsVoice('');
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [settingsEpoch]);

    const canShowTts = Boolean(noteId && (canGenerateSentenceAudio || canGenerateExpressionAudio));
    // Only show TTS UI if voices were fetched from the server (which implies keys are configured)
    const canShowTtsUI = canShowTts && ttsVoiceOptions.length > 0;
    const canGenerateTts = Boolean(
      noteId &&
        ((ttsFillSentenceAudio && canGenerateSentenceAudio) || (ttsFillExpressionAudio && canGenerateExpressionAudio))
    );

    const handleGenerateTtsForNote = useCallback(async () => {
      if (!noteId) return;
      if (!canGenerateTts) return;
      if (ttsGenerating) return;

      setTtsGenerating(true);
      try {
        const res = await fetch(`/api/tts/generate-note-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteId,
            voiceName: ttsVoice,
            generateSentenceAudio: ttsFillSentenceAudio && canGenerateSentenceAudio,
            generateExpressionAudio: ttsFillExpressionAudio && canGenerateExpressionAudio,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();

        const sentenceAudioLabel = mapping?.sentence_audio ?? 'SentenceAudio';
        const sentenceFilename = data.sentenceFilename ? String(data.sentenceFilename) : (data.filename ? String(data.filename) : '');
        if (sentenceFilename) onUpdateField?.(noteId, sentenceAudioLabel, `[sound:${sentenceFilename}]`);

        const expressionFilename = data.expressionFilename ? String(data.expressionFilename) : '';
        if (expressionFilename && wordAudioField) onUpdateField?.(noteId, wordAudioField.label, `[sound:${expressionFilename}]`);

        setIsTtsMenuOpen(false);
        toast.success(t('TTS audio added.'));
      } catch (err: any) {
        toast.error(t("errors.ttsFailed", { message: err?.message ?? String(err) }));
      } finally {
        setTtsGenerating(false);
      }
    }, [noteId, canGenerateTts, ttsGenerating, ttsVoice, mapping, onUpdateField, canGenerateSentenceAudio, canGenerateExpressionAudio, wordAudioField, ttsFillSentenceAudio, ttsFillExpressionAudio]);

    const handlePreviewTtsVoice = useCallback(async () => {
      if (!noteId) return;
      if (ttsPreviewing) return;

      setTtsPreviewing(true);
      try {
        const sampleText = sentenceText || 'こんにちは';
        const res = await fetch(`/api/tts/voice-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: sampleText, voiceName: ttsVoice }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const url = data.audioUrl ? String(data.audioUrl) : '';
        if (!url) throw new Error('No audioUrl returned');
        playAudio(url.startsWith('/') ? `${BACKEND_URL}${url}` : url, 'tts-preview');
      } catch (err: any) {
        toast.error(t("errors.voicePreviewFailed", { message: err?.message ?? String(err) }));
      } finally {
        setTtsPreviewing(false);
      }
    }, [noteId, playAudio, sentenceText, ttsPreviewing, ttsVoice]);

    // Filter the available options for the checkbox menu
    const availableOptions = useMemo(() => {
      const options = [];
      // Only include fields that are both present in the card AND active in mapping
      if (sentence) options.push({ id: sentence.label, label: 'Sentence Text', exists: hasSentence });
      if (audio) options.push({ id: audio.label, label: 'Audio', exists: hasAudio });
      if (translation) options.push({ id: translation.label, label: 'Translation', exists: hasTranslation });
      return options.filter((option) => option.exists);
    }, [hasSentence, hasTranslation, hasAudio, sentence, audio, translation]);

    // ensure the checkbox state evolves when fields appear/disappear:
    useEffect(() => {
      setFieldsToClear((prev) => {
        const nextIds = availableOptions.map((opt) => opt.id);
        if (nextIds.length === 0) return [];

        // keep user choices when possible, add new fields
        const preserved = prev.filter((id) => nextIds.includes(id));
        if (preserved.length > 0) return preserved;
        return nextIds;
      });
    }, [availableOptions, noteId]);

    const translationRef = useRef<HTMLTextAreaElement | null>(null);
    const sentenceRef = useRef<HTMLTextAreaElement | null>(null);
    const sentenceWrapRef = useRef<HTMLDivElement | null>(null);
    const translationWrapRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!noteId) return;
      if (isManualEditMode) return;
      setSentenceDraft(sentenceText);
      setTranslationDraft(translationText);
    }, [noteId, sentenceText, translationText, isManualEditMode]);

    useEffect(() => {
      if (!editPromptFor) return;
      const handler = (e: PointerEvent) => {
        const target = e.target as Node | null;
        const inSentence = sentenceWrapRef.current?.contains(target ?? null) ?? false;
        const inTranslation = translationWrapRef.current?.contains(target ?? null) ?? false;
        if (!inSentence && !inTranslation) setEditPromptFor(null);
      };
      window.addEventListener('pointerdown', handler);
      return () => window.removeEventListener('pointerdown', handler);
    }, [editPromptFor]);

    const beginManualEdit = useCallback(
      (field: 'sentence' | 'translation') => {
        setSentenceDraft(sentenceText);
        setTranslationDraft(translationText);
        setEditPromptFor(null);
        setIsManualEditMode(true);
        setIsTranslationEditable(false);
        window.setTimeout(() => {
          if (field === 'sentence') sentenceRef.current?.focus();
          else translationRef.current?.focus();
        }, 0);
      },
      [sentenceText, translationText]
    );

    const handleSaveManualEdits = useCallback(async () => {
      if (!noteId) return;
      if (!onUpdateCard) return;
      if (manualSaveRunning) return;

      setManualSaveRunning(true);
      try {
        await onUpdateCard(sentenceDraft, translationDraft, undefined, noteId);
        toast.success(t('Saved.'));
        setIsManualEditMode(false);
        setIsTranslationEditable(false);
      } catch (err: any) {
        toast.error(t("errors.saveFailed", { message: err?.message ?? String(err) }));
      } finally {
        setManualSaveRunning(false);
      }
    }, [noteId, onUpdateCard, manualSaveRunning, sentenceDraft, translationDraft]);

    useEffect(() => {
      if (isManualEditMode) return;
      if (isTranslationEditable && !useApiTranslation && translationRef.current) {
        translationRef.current.focus();
        // select existing text (if any) so paste replaces it
        translationRef.current.select();
      }
    }, [isTranslationEditable, useApiTranslation, isManualEditMode]);

    useEffect(() => {
      if (translationInviteTimeoutRef.current != null) {
        window.clearTimeout(translationInviteTimeoutRef.current);
        translationInviteTimeoutRef.current = null;
      }

      if (!isTranslationEditable || isManualEditMode) {
        setTranslationInvite(false);
        return;
      }

      setTranslationInvite(true);
      translationInviteTimeoutRef.current = window.setTimeout(() => {
        setTranslationInvite(false);
        translationInviteTimeoutRef.current = null;
      }, 900);

      return () => {
        if (translationInviteTimeoutRef.current != null) {
          window.clearTimeout(translationInviteTimeoutRef.current);
          translationInviteTimeoutRef.current = null;
        }
      };
    }, [isTranslationEditable, noteId, isManualEditMode]);

    useEffect(() => {
      // reset visual state for each new note
      setShowMore(false);
      setIsTranslationEditable(false);
      setIsManualEditMode(false);
    
      // reset DeepL usage flag for a newly focused note (so previous note's DeepL click doesn't persist)
      setHasOpenedDeepL(false);
      setFieldsToClear(availableOptions.map(opt => opt.id)); // also reset on note change
    }, [noteId]);

    // Use primaryFields definition if needed, otherwise secondaryFields is sufficient
    // const primaryFields = fields.filter((f) => PRIMARY_FIELDS.has(f.label));

    const secondaryFields = fields.filter((f) => !PRIMARY_FIELDS.has(f.label));

    // Determine if the "Translate" button should be visible
    const showTranslateButton =
      Boolean(sentence?.value) &&
      Boolean(translation) &&
      !translation?.value;

    // Placeholder function for translation action
    // Combined and updated handleTranslate function
    const handleTranslate = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.stopPropagation();
        if (!noteId || !sentence?.value) return;

        const displayLang = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY) === "pt-BR" ? "pt-BR" : "en";
        const deeplTargetLang = displayLang === "pt-BR" ? "pt-BR" : "en-US";

        const canUseApi = await refreshDeeplKey();
        if (!canUseApi) {
            //const sourceText = encodeURIComponent(sentence.value);
            await navigator.clipboard.writeText(sentence.value);
            toast.info(t('Text is on the clipboard.'));
            toast.info(t('DeepL will now open. Paste the translation above.'));
            
            // Added https and correct pathing
            setTimeout(() => {
                const deeplUrl = `https://www.deepl.com/en/translator`;
    
                // 1. Open/Grab the window by name
                const deeplWindow = window.open('', "anki_deepl");

                if (deeplWindow) {
                    try {
                        // 2. This check works on the FIRST click (same-origin) 
                        // but throws an error on the SECOND click (cross-origin).
                        if (deeplWindow.location.href === 'about:blank') {
                            deeplWindow.location.href = deeplUrl;
                        }
                    } catch (e) {
                        // 3. If we hit the error, it means the tab is already on DeepL!
                        // We don't need to do anything; the tab is already where it needs to be.
                        console.log("DeepL tab already active on an external domain. Navigation skipped.");
                    }
                    
                    // 4. Focus will work regardless of the error above
                    deeplWindow.focus();
                                        // inside handleTranslate() non-API branch, in the setTimeout after deeplWindow.focus():
                    setIsTranslationEditable(true);
                    // record that user used the DeepL flow so Update button can appear once text exists
                    setHasOpenedDeepL(true);
                }

                // 5. This will now fire even if the try block failed!
                setIsTranslationEditable(true);
            }, 2000);

        } else {
            // --- API Approach ---
            toast.info(t('Fetching translation via API...'));
            try {
                const res = await fetch(`/api/notes/${noteId}/translate`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: sentence.value, target_lang: deeplTargetLang }) 
                });

                if (!res.ok) {
                  const text = await res.text().catch(() => '');
                  throw new Error(text || 'Translation API failed');
                }

                const data = await res.json();
                const translatedText = data.translated_text;

                if (!onUpdateCard) throw new Error('No update handler available');
                await onUpdateCard(sentence.value, translatedText, undefined, noteId);
                onUpdateField?.(noteId, mapping?.translation || 'SentenceTranslation', translatedText);
                toast.success(t('Translation saved to Anki.'));
                setIsManualEditMode(false);
                setIsTranslationEditable(false);
            } catch (error) {
                console.error('Failed to translate', error);
                toast.error(t("errors.failedToTranslateViaApi", { message: error instanceof Error ? error.message : String(error) }));
            }
        }
    };

    // Handler for manual input changes (needs to bubble up to parent state manager)
    const handleTranslationInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newVal = e.target.value;
        if (noteId && onUpdateField) {
            // Immediately update the parent state as user types/pastes
            onUpdateField(noteId, mapping?.translation || 'SentenceTranslation', newVal);
        }
    };

    const showPasteSaveButton =
      Boolean(
        !isManualEditMode &&
          isTranslationEditable &&
          !useApiTranslation &&
          hasOpenedDeepL &&
          noteId &&
          onUpdateCard &&
          (sentence?.value || '').trim() &&
          (translation?.value || '').trim()
      );

    const handleSavePastedTranslation = useCallback(async () => {
      if (!noteId) return;
      if (!onUpdateCard) return;
      if (pasteSaveRunning) return;
      if (!sentence?.value?.trim()) return;
      if (!translation?.value?.trim()) return;

      setPasteSaveRunning(true);
      try {
        await onUpdateCard(sentence.value, translation.value, undefined, noteId);
        toast.success(t('Saved.'));
        setIsTranslationEditable(false);
        setHasOpenedDeepL(false);
      } catch (err: any) {
        toast.error(t("errors.saveFailed", { message: err?.message ?? String(err) }));
      } finally {
        setPasteSaveRunning(false);
      }
    }, [noteId, onUpdateCard, pasteSaveRunning, sentence?.value, translation?.value]);

    
    const handleRemove = async () => {
      // 1. Close the dialogs immediately
      setIsConfirmOpen(false);
      setIsRemoveMenuOpen(false);

      if (!noteId || fieldsToClear.length === 0) return;

      try {
        const res = await fetch(`/api/notes/${noteId}/clear-sentence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: fieldsToClear })
        });

        if (!res.ok) throw new Error('Failed to update Anki');

        toast.success(t('Fields cleared successfully'));

        if (onUpdateField) {
          fieldsToClear.forEach(field => onUpdateField(noteId, field, ''));
        }
      } catch (err) {
        console.error(err);
        toast.error(t('Failed to sync changes with Anki'));
      }
    };
    
    // A reusable Input component for consistent styling
    const DiscreteInput = ({ 
      value, 
      className = '', 
      readOnly = true, 
      onChange, 
      onClick,
      onClear, // New callback
      showClear = false, // New optional parameter
      isBlinking = false, 
      placeholder, 
      inputRef,
      dataComponent,
      enableHorizontalScrollOnHover = false,
    }: { 
      value: string, 
      className?: string, 
      readOnly?: boolean, 
      onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void, 
      onClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void,
      onClear?: () => void,
      showClear?: boolean,
      isBlinking?: boolean, 
      placeholder?: string, 
      inputRef?: React.RefObject<HTMLTextAreaElement | null>,
      dataComponent?: string,
      enableHorizontalScrollOnHover?: boolean,
    }) => {
      return (
        <div data-component={dataComponent ? `${dataComponent}-container` : undefined} className="relative w-full group">
          <textarea
            ref={inputRef}
            data-component={dataComponent ?? undefined}
            value={value}
            readOnly={readOnly}
            onChange={onChange}
            placeholder={placeholder}
            wrap={readOnly && enableHorizontalScrollOnHover ? "off" : undefined}
            className={`
              w-full resize-none bg-transparent outline-none p-1 pr-8
              transition-all duration-500 ease-out
              border-b-[1.5px]
              
              /* Base Border Style */
              ${readOnly ? 'border-white/10' : 'border-white/20'}
              
              /* Focus & Interactive Logic */
              ${!readOnly && 'cursor-text discrete-input-glow no-blink-on-focus'}
              
              /* Invitation Animation (Stops on Focus via CSS) */
              ${isBlinking && !readOnly ? 'animate-blink-invite' : ''} 
              
              ${className}
              ${readOnly && enableHorizontalScrollOnHover ? 'anki-hscroll anki-hscroll--hover' : ''}
            `}        
            rows={1}
            style={{
              height: 'auto',
              overflowY: 'hidden',
              overflowX: readOnly && enableHorizontalScrollOnHover ? 'auto' : 'hidden',
              whiteSpace: readOnly && enableHorizontalScrollOnHover ? 'pre' : undefined,
            }}
            onClick={(e) => {
              onClick?.(e);
              e.stopPropagation();
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${target.scrollHeight}px`;
            }}
          />
          
          {/* Clear Button - Only shows if enabled, not readonly, and has value */}
          {showClear && !readOnly && value && (
            <button
              data-component={dataComponent ? `${dataComponent}-clear` : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
              className="absolute right-1 bottom-2 p-1 rounded-full text-slate-500 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label={t("Clear input")}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      );
    };
    
    const isMobile = useIsMobile();

    return (
      <div
        ref={ref}
        data-component="CardContext"
        data-note-id={noteId ?? undefined}
        className="h-full flex flex-col bg-transparent transition-all duration-300"
        onClick={onActivate}
      >
        {/* Header (Kept original Card Context style) */}
        <div data-component="card-context-header" data-section="header" className="sticky top-0 bg-slate-800 z-10 px-6 py-4 border-b border-slate-600 flex items-center justify-between">
          <h2 data-component="current-sentence-for-title" className="text-white text-lg font-medium">
            {isMobile ? t("Card Details") : (word ? t("cardContext.currentSentenceFor", { word }) : t("Current Sentence:"))} 
            {wordAudioSrc && !isWordAudioDisabled && (
              <button
                data-component="play-word-audio-button"
                onClick={(e) => {
                  e.stopPropagation();
                  playAudio(wordAudioSrc, 'word');
                }}
                className="relative ml-2 p-1 hover:bg-white/10 rounded-full transition-colors inline-flex items-center"
                title={t("Play word audio")}
              >
                🔊
                {audioLoadingKey === 'word' ? (
                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-950">
                    {audioLoadingPercent}%
                  </span>
                ) : null}
              </button>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {isMobile ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button data-component="card-context-mobile-actions-trigger" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
                    <MoreVertical className="size-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent data-component="card-context-mobile-actions-menu" align="end">
                  <DropdownMenuItem 
                    data-component="open-in-anki-menu-item"
                    data-action="open-in-anki"
                    onSelect={async (e) => {
                      e.preventDefault();
                      if (!noteId) return;
                      try {
                        await fetch(`/api/notes/${noteId}/open`, { method: 'POST' });
                        toast.info(t("Opened in Anki"));
                      } catch (err) {
                        console.error('Failed to open note in Anki', err);
                      }
                    }}
                    disabled={!noteId}
                  >
                    <ExternalLink className="size-4 mr-2" />
                    {t("Open in Anki")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem data-component="toggle-more-details-menu-item" onSelect={() => setShowMore(v => !v)}>
                    <ChevronDown className={`size-4 mr-2 transition-transform ${showMore ? 'rotate-180' : ''}`} />
                    {showMore ? t("Show Less") : t("Show More")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <div className="flex items-center gap-2" />
                <button
                  data-component="open-in-anki-button"
                  data-action="open-in-anki"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!noteId) return;
                    try {
                      await fetch(`/api/notes/${noteId}/open`, { method: 'POST' });
                      toast.info(t("Opened in Anki"));
                    } catch (err) {
                      console.error('Failed to open note in Anki', err);
                    }
                  }}
                  disabled={!noteId}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors shadow-sm ${
                    !noteId
                      ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                      : 'bg-emerald-500 text-white hover:bg-emerald-600'
                  }`}
                >
                  {t("Open in Anki")}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div data-component="card-context-content" data-section="content" className="flex-1 flex flex-col gap-4 px-6 py-4 overflow-y-auto" style={{background: `linear-gradient(to bottom right, var(--anki-bg-start), var(--anki-bg-end))`,
          borderColor: `var(--anki-border)` }}>

          {/* Combined Sentence/Translation Block (Formatted like Example Sentences items) */}
          {(sentence || translation) && (
            <div
              data-component="primary-fields-card"
              className="p-4 rounded-lg border border-slate-200 bg-white shadow-sm" style={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.03)', 
                borderColor: 'var(--anki-border-white)' 
              }}
            >
              <div className="flex items-start gap-3">
                {audio && (
                  <button
                    data-component="play-sentence-audio-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playAudio(audioSrc, 'sentence');
                    }}
                    disabled={!audioSrc}
                    className={`flex-shrink-0 mt-0.5 p-2 rounded-full transition-colors ${
                      audioSrc
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    } relative`}
                    aria-label={t("Play audio")}
                  >
                    🔊
                    {audioLoadingKey === 'sentence' ? (
                      <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-950">
                        {audioLoadingPercent}%
                      </span>
                    ) : null}
                  </button>
                )}

                {/* Editable Fields Container */}
                <div className="flex-1">
                  {/* Sentence Field (JP) */}
                  {sentence && (
                    <div className='flex items-center justify-between gap-4'>
                      {isMobile && showTranslateButton ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <div className="flex-1 cursor-pointer">
                              <DiscreteInput
                                  value={sentence.value}
                                  className="text-slate-600 mt-4" 
                                  readOnly={true} 
                                  placeholder={String(sentence.value || '').trim() ? undefined : t("cardContext.emptyPlaceholder")}
                                  enableHorizontalScrollOnHover
                                  dataComponent="sentence-field"
                              />
                            </div>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem data-component="translate-deepl-menu-item" onSelect={handleTranslate as any}>
                              <Languages className="size-4 mr-2" />
                              {t("Translate w DeepL")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <>
                          <div className="relative flex-1" ref={sentenceWrapRef}>
                            <DiscreteInput
                              value={isManualEditMode ? sentenceDraft : sentence.value}
                              className="text-slate-600 mt-4"
                              readOnly={!isManualEditMode}
                              onChange={(e) => setSentenceDraft(e.target.value)}
                              onClick={() => {
                                if (isManualEditMode) return;
                                setEditPromptFor('sentence');
                              }}
                              placeholder={
                                !isManualEditMode && !String(sentence.value || "").trim()
                                  ? t("cardContext.emptyPlaceholder")
                                  : undefined
                              }
                              enableHorizontalScrollOnHover
                              inputRef={sentenceRef}
                              dataComponent="sentence-field"
                            />
                            {editPromptFor === 'sentence' && !isManualEditMode ? (
                              <button
                                type="button"
                                data-component="edit-sentence-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  beginManualEdit('sentence');
                                }}
                                className="absolute right-2 top-2 inline-flex items-center gap-2 rounded-md border border-slate-200/20 bg-slate-900/90 px-2.5 py-1 text-xs text-slate-100 shadow-lg hover:bg-slate-900"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t("Edit")}
                              </button>
                            ) : null}
                          </div>
                          {showTranslateButton && (
                              <button
                                  data-component="translate-deepl-button"
                                  onClick={handleTranslate}
                                  className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg transition-colors shadow-sm bg-blue-600 text-white hover:bg-blue-700"
                                  style={{ height: 'fit-content' }}
                              >
                                  {t("Translate w DeepL")}
                              </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Translation Field (EN) */}
                  {translation && (
                    <div className="relative" ref={translationWrapRef}>
                      <DiscreteInput
                        value={isManualEditMode ? translationDraft : translation.value}
                        className="text-slate-600 italic mt-4"
                        readOnly={!(isTranslationEditable || isManualEditMode)}
                        onChange={(e) => {
                          if (isManualEditMode) {
                            setTranslationDraft(e.target.value);
                            return;
                          }
                          handleTranslationInputChange(e);
                        }}
                        onClick={() => {
                          if (isManualEditMode) return;
                          if (isTranslationEditable) return;
                          setEditPromptFor('translation');
                        }}
                        isBlinking={translationInvite}
                        showClear
                        onClear={() => {
                          if (isManualEditMode) {
                            setTranslationDraft('');
                            return;
                          }
                          handleTranslationInputChange({ target: { value: '' } } as any);
                        }}
                        placeholder={
                          !String(translation.value || '').trim() && !isTranslationEditable && !isManualEditMode
                            ? t("cardContext.emptyPlaceholder")
                            : !useApiTranslation && isTranslationEditable
                              ? 'Paste your translation here...'
                              : undefined
                        }
                        enableHorizontalScrollOnHover={!isTranslationEditable && !isManualEditMode}
                        inputRef={translationRef}
                        dataComponent="translation-field"
                      />
                      {editPromptFor === 'translation' && !isManualEditMode && !isTranslationEditable ? (
                        <button
                          type="button"
                          data-component="edit-translation-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            beginManualEdit('translation');
                          }}
                          className="absolute right-2 top-2 inline-flex items-center gap-2 rounded-md border border-slate-200/20 bg-slate-900/90 px-2.5 py-1 text-xs text-slate-100 shadow-lg hover:bg-slate-900"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          {t("Edit")}
                        </button>
                      ) : null}
                    </div>
                  )}

                  {showPasteSaveButton ? (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        data-component="save-pasted-translation-button"
                        onClick={handleSavePastedTranslation}
                        disabled={!noteId || !onUpdateCard || pasteSaveRunning}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors shadow-sm ${
                          !noteId || !onUpdateCard || pasteSaveRunning
                            ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        <Save className="h-4 w-4" />
                        {pasteSaveRunning ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  ) : null}

                  {isManualEditMode ? (
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        data-component="save-manual-edits-button"
                        onClick={handleSaveManualEdits}
                        disabled={!noteId || !onUpdateCard || manualSaveRunning}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors shadow-sm ${
                          !noteId || !onUpdateCard || manualSaveRunning
                            ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        }`}
                      >
                        <Save className="h-4 w-4" />
                        {manualSaveRunning ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Secondary Fields */}
          {(secondaryFields.length > 0 || canShowTts || hasAnythingToClear) && (
            <div data-component="secondary-fields-section" className="mt-4"> {/* Add remove sentence button here */}
              <div className="flex items-center justify-between mb-2">
                <div />
                
                {(canShowTtsUI || hasAnythingToClear) && (
                  <div data-component="card-context-actions" className="relative flex items-center z-10">
                    <div data-component="card-context-actions-row" className="flex items-stretch gap-2">
                      {canShowTtsUI && (
                        <Popover open={isTtsMenuOpen} onOpenChange={setIsTtsMenuOpen}>
                          <div className="flex items-stretch rounded-md shadow-sm">
                            <button
                              data-component="add-tts-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleGenerateTtsForNote();
                              }}
                              disabled={!canGenerateTts || ttsGenerating}
                              className={`px-3 py-1.5 text-xs font-medium rounded-l-lg transition-colors border border-blue-500/30 border-r-0 ${
                                ttsGenerating
                                  ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                                  : 'bg-blue-600/35 text-blue-100 hover:bg-blue-600/45'
                              }`}
                            >
                              {t("cardContext.addTts")}
                            </button>
                            <PopoverTrigger asChild>
                              <button
                                data-component="tts-options-trigger"
                                disabled={!canGenerateTts}
                                className="px-1.5 py-1.5 rounded-r-lg transition-colors border border-blue-500/30 bg-blue-600/35 text-blue-100 hover:bg-blue-600/45 disabled:bg-slate-700 disabled:text-slate-400"
                                title="TTS options"
                              >
                                <ChevronDown
                                  className={`size-3.5 transition-transform duration-200 ${
                                    isTtsMenuOpen ? 'rotate-180' : 'rotate-0'
                                  }`}
                                />
                              </button>
                            </PopoverTrigger>
                          </div>
                          <PopoverContent
                            align="end"
                            className="w-72 bg-slate-900 border-slate-700 p-3 shadow-2xl z-[100]"
                            sideOffset={8}
                          >
                            <div className="text-[10px] font-bold text-slate-500 px-1 pb-2 uppercase tracking-wider">
                              TTS voice
                            </div>
                            <div className="flex items-center gap-2">
                              <Select value={ttsVoice} onValueChange={setTtsVoice} disabled={ttsGenerating || ttsPreviewing}>
                                <SelectTrigger data-component="tts-voice-select-trigger" className="flex-1 h-9 px-2 bg-slate-800 border-slate-700 text-slate-100 text-xs">
                                  <SelectValue placeholder="Select voice" />
                                </SelectTrigger>
                                <SelectContent className="z-[220] border border-slate-700 bg-slate-900 text-slate-100">
                                  {ttsVoiceOptions.map((voice) => (
                                    <SelectItem
                                      key={voice.id}
                                      value={voice.id}
                                      className="text-slate-100 focus:bg-slate-700 focus:text-slate-100 text-xs"
                                    >
                                      {voice.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <button
                                data-component="tts-voice-preview-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handlePreviewTtsVoice();
                                }}
                                disabled={ttsGenerating || ttsPreviewing}
                                className={`relative h-9 w-9 flex items-center justify-center rounded-lg border transition-colors ${
                                  ttsPreviewing
                                    ? 'bg-slate-800 border-slate-700 text-slate-400 cursor-not-allowed'
                                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                                }`}
                                title="Preview voice"
                              >
                                <Volume2 className="size-4" />
                                {audioLoadingKey === 'tts-preview' ? (
                                  <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-950">
                                    {audioLoadingPercent}%
                                  </span>
                                ) : null}
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-3">
                              <div className="flex flex-col gap-2">
                                <label className={`flex items-center gap-2 text-xs ${canGenerateSentenceAudio ? 'text-slate-200' : 'text-slate-500'}`}>
                                  <input
                                    data-component="tts-fill-sentence-audio-checkbox"
                                    type="checkbox"
                                    checked={ttsFillSentenceAudio}
                                    onChange={(e) => setTtsFillSentenceAudio(e.target.checked)}
                                    disabled={!canGenerateSentenceAudio || ttsGenerating || ttsPreviewing}
                                    className="rounded border-slate-700 bg-slate-800"
                                  />
                                  {t("Fill Sentence audio")}
                                </label>
                                <label className={`flex items-center gap-2 text-xs ${canGenerateExpressionAudio ? 'text-slate-200' : 'text-slate-500'}`}>
                                  <input
                                    data-component="tts-fill-expression-audio-checkbox"
                                    type="checkbox"
                                    checked={ttsFillExpressionAudio}
                                    onChange={(e) => setTtsFillExpressionAudio(e.target.checked)}
                                    disabled={!canGenerateExpressionAudio || ttsGenerating || ttsPreviewing}
                                    className="rounded border-slate-700 bg-slate-800"
                                  />
                                  {t("Fill Expression audio")}
                                </label>
                              </div>
                              <button
                                data-component="tts-generate-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleGenerateTtsForNote();
                                }}
                                disabled={!canGenerateTts || ttsGenerating}
                                className={`flex-1 px-3 py-2 rounded-lg text-xs transition-colors ${
                                  ttsGenerating
                                    ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                                    : 'bg-blue-600 text-white hover:bg-blue-700'
                                }`}
                              >
                                {ttsGenerating ? t('Generating...') : t('Generate')}
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}

                      {hasAnythingToClear && (
                        <>
                          <Popover open={isRemoveMenuOpen} onOpenChange={setIsRemoveMenuOpen}>
                            <div className="flex items-stretch rounded-md shadow-sm">
                              <button
                                data-component="clear-fields-button"
                                onClick={() => setIsConfirmOpen(true)}
                                disabled={fieldsToClear.length === 0}
                                className={`px-3 py-1.5 text-xs font-medium rounded-l-lg transition-colors border border-red-200/50 border-r-0 ${
                                  fieldsToClear.length === 0
                                    ? 'bg-slate-700 text-slate-300 cursor-not-allowed'
                                    : 'bg-red-600 text-white hover:bg-red-700'
                                }`}
                              >
                                {t("cardContext.clearSentenceCount", { n: fieldsToClear.length })}
                              </button>
                              <PopoverTrigger asChild>
                                <button
                                  data-component="clear-fields-menu-trigger"
                                  disabled={fieldsToClear.length === 0}
                                  className={`px-1.5 py-1.5 rounded-r-lg transition-colors border border-red-200/50 border-l-0 ${
                                    fieldsToClear.length === 0
                                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                      : 'bg-red-600 text-white hover:bg-red-700'
                                  }`}
                                >
                                  <ChevronDown
                                    className={`size-3.5 transition-transform duration-200 ${
                                      isRemoveMenuOpen ? 'rotate-180' : 'rotate-0'
                                    }`}
                                  />
                                </button>
                              </PopoverTrigger>
                            
                            {/* PopoverContent uses a Portal by default, so it will break past parent boundaries */}
                            <PopoverContent 
                              align="end" 
                              data-component="clear-fields-menu"
                              className="w-48 bg-slate-900 border-slate-700 p-2 shadow-2xl z-[100]"
                              sideOffset={8}
                            >
                              <div className="text-[10px] font-bold text-slate-500 px-2 py-1 uppercase tracking-wider">
                                {t("Fields to wipe")}
                              </div>
                              
                              {availableOptions.map((field) => (
                                <label 
                                  key={field.id}
                                  className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-800 rounded cursor-pointer transition-colors"
                                >
                                  <input
                                    data-component="clear-fields-option-checkbox"
                                    type="checkbox"
                                    checked={fieldsToClear.includes(field.id)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleField(field.id);
                                    }}
                                    className="rounded border-slate-700 bg-slate-800 text-red-500 focus:ring-red-500 size-3.5"
                                  />
                                  <span className="text-xs text-slate-200">{field.label}</span>
                                </label>
                              ))}
                              
                              <div className="border-t border-slate-800 mt-2 pt-2">
                                <button 
                                  data-component="clear-fields-menu-close-button"
                                  onClick={() => setIsRemoveMenuOpen(false)}
                                  className="w-full py-1 text-[10px] text-slate-400 hover:text-white transition-colors"
                                >
                                  {t("Close Menu")}
                                </button>
                              </div>
                            </PopoverContent>
                            </div>
                          </Popover>
                          {/* --- CONFIRMATION DIALOG --- */}
                          <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
                            <DialogContent data-component="clear-fields-confirm-dialog" className="bg-slate-900/95 border border-slate-700 text-slate-100 shadow-2xl">
                              <DialogHeader>
                                <DialogTitle className="text-2xl text-rose-400">{t("Confirm Removal")}</DialogTitle>
                                <DialogDescription className="text-slate-300">
                                  {t("You are about to clear the following data from this Anki note:")}
                                </DialogDescription>
                              </DialogHeader>

                              <div className="bg-slate-800 border border-slate-700 p-3 rounded-lg mt-3">
                                <ul className="list-disc list-inside space-y-1">
                                  {availableOptions
                                    .filter(opt => fieldsToClear.includes(opt.id))
                                    .map(opt => (
                                      <li key={opt.id} className="text-sm text-slate-200">
                                        <span className="font-medium text-slate-100">{opt.label}</span>
                                      </li>
                                  ))}
                                </ul>
                                <p className="mt-3 text-xs text-amber-500 font-medium">
                                  {t("⚠️ This action will immediately update your Anki deck.")}
                                </p>
                              </div>

                              <DialogFooter className="mt-4 flex justify-end gap-2">
                                <DialogClose asChild>
                                  <button data-component="clear-fields-cancel-button" className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                                    {t("Cancel")}
                                  </button>
                                </DialogClose>
                                <button
                                  data-component="clear-fields-confirm-button"
                                  onClick={handleRemove} // The actual API call happens here
                                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
                                >
                                  {t("Yes, clear fields")}
                                </button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    );
  }
);


CardContext.displayName = 'CardContext';
