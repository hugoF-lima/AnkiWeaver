import { forwardRef, useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { fetchSentencesFor } from '../hooks/useSentences';
import { tatoebaAudioUrl } from '../utils/audio.ts';

interface Example {
  sentence: string;
  translation: string;
  audioId?: string;
  hasAudio?: boolean;
}

//for modifying anki flashcard
interface ExampleSentencesProps {
  examples?: Example[];            // optional; if not provided, component will fetch using `word`
  word?: string;                   // the searched word to fetch sentences for
  noteId?: number;                 // optional: noteId to use when updating
  onUpdateCard: (jp: string, en: string, audioId?: string, noteId?: number) => void;
  isActive: boolean;
  onActivate: () => void;
}

export const ExampleSentences = forwardRef<HTMLDivElement, ExampleSentencesProps>(
  ({ examples, onUpdateCard, isActive, onActivate, word, noteId }, ref) => {
    const [localExamples, setLocalExamples] = useState<Example[]>(Array.isArray(examples) ? examples : []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

    useEffect(() => {
      setLocalExamples(Array.isArray(examples) ? examples : []);
    }, [examples]);

    // Clear selection when the examples list changes
    useEffect(() => {
      setSelectedIdx(null);
    }, [localExamples]);

    useEffect(() => {
      let canceled = false;
      if ((!Array.isArray(examples) || examples.length === 0) && word) {
        setLoading(true); setError(null)
        fetchSentencesFor(word, 5)
          .then((sents) => {
            if (canceled) return
            setLocalExamples(sents.map(s =>({sentence: s.jp, translation: s.en, audioId: s.audio_id, hasAudio: s.has_audio})))
          })
          .catch((e) => setError(String(e)))
          .finally(() => setLoading(false))
      }
      return () => { canceled = true }
    }, [word, examples]);

    const handlePlay = (e: React.MouseEvent, example: Example) => {
      e.stopPropagation();
      // 1️⃣ Confirm the handler is actually firing
      console.log('[handlePlay] clicked example:', example);

      // 2️⃣ Inspect the audioId specifically
      console.log('[handlePlay] audioId:', example.audioId, typeof example.audioId);

      // 3️⃣ Inspect the final URL
      
      const url = tatoebaAudioUrl(example.audioId);

      console.log('[handlePlay] audio URL:', url);
      
      if (!url) return;

      const audio = new Audio(url);
      audio.play().catch(err => {
        console.error('Audio playback failed', err);
      });
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

    return (
      <div
        className={`h-full flex flex-col bg-transparent transition-all duration-300 ${
          isActive ? 'border border-blue-400 shadow-lg' : 'border border-slate-300 shadow-sm'
        }`}
        onClick={onActivate}
      >
        <div className="sticky top-0 bg-slate-800 z-10 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-white text-lg font-semibold">Sentence lookup: </h2>
          <button
            onClick={async () => {
              if (!selected || !noteId) return;
              console.log('ExampleSentences: onUpdateCard', { selected, noteId });
              onUpdateCard(
                selected.sentence,
                selected.translation,
                selected.audioId,
                noteId
              );
              setSelectedIdx(null);
            }}
            disabled={topDisabled || !noteId}
            aria-disabled={topDisabled || !noteId}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors shadow-sm ${
              (topDisabled || !noteId) ? 'bg-slate-300 text-slate-600 cursor-not-allowed' : 'bg-blue-500 text-white hover:bg-blue-600'
            }`}
          >
            Update Card w/ Sentence
          </button>
        </div>

        <div ref={ref} className="flex-1 overflow-y-auto p-6 pt-4" onScroll={onActivate}>
          {loading && <p className="p-4 text-slate-600">Loading sentences...</p>}
          {error && <p className="p-4 text-red-500">Error: {error}</p>}
          <div className="space-y-4">
            {(localExamples || []).map((example, index) => {
              const isSelected = selectedIdx === index;
              return (
                <div
                  key={index}
                  onClick={() => handleSelect(index)}
                  onKeyDown={(e) => handleKey(e, index)}
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  className={`p-4 rounded-lg border transition-shadow cursor-pointer focus:outline-none ${
                    isSelected
                      ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300 shadow-md'
                      : 'border-slate-200 bg-white hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={(e) => handlePlay(e, example)}
                      //disabled={!example.audioId}
                      className={`flex-shrink-0 mt-0.5 p-2 rounded-full transition-colors
                        ${example.audioId? 'bg-blue-500 text-white hover:bg-blue-600': 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
                      aria-label="Play audio"
                    >
                      
                      <Volume2 className="size-4" />
                    </button>
                    <div className="flex-1">
                      <p className="text-slate-900 mb-2">{example.sentence}</p>
                      <p className="text-slate-600 italic">{example.translation}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {!loading && localExamples.length === 0 && <p className="text-slate-600 p-4">No sentences found for this word.</p>}
          </div>
        </div>
      </div>
    );
  }
);

ExampleSentences.displayName = 'ExampleSentences';