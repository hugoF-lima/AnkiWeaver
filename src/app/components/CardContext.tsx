import { useRef, forwardRef, useState, useEffect } from 'react';
import { toast } from 'sonner';
import {getPlayableAudioUrlFromField} from '../utils/audio';

interface CardField {
  label: string;
  value: string;
}

interface CardContextProps {
  fields: CardField[];
  isActive: boolean;
  onActivate: () => void;
  noteId?: number;
  // We need a prop/function to let the parent update the actual field data
  onUpdateField?: (noteId: number, label: string, value: string) => void;
  // Pass explicit noteId to avoid races between selection and update
  onUpdateCard?: (jp: string, en: string, audioId?: string, noteId?: number) => void;
}

const PRIMARY_FIELDS = new Set([
  'Sentence',
  'SentenceTranslation',
  'SentenceAudio',
]);


export const CardContext = forwardRef<HTMLDivElement, CardContextProps>(
  ({ fields, isActive, noteId, onActivate, onUpdateField, onUpdateCard }, ref) => {
    const [showMore, setShowMore] = useState(false);
    const [showUpdateButton, setShowUpdateButton] = useState(false);
    
    // State to manage whether the API or manual deep link should be used
    const [useApiTranslation, setUseApiTranslation] = useState(false); // Default to manual link
    // State to manage if the translation field is currently editable (for manual paste)
    const [isTranslationEditable, setIsTranslationEditable] = useState(false);

    const [hasOpenedDeepL, setHasOpenedDeepL] = useState(false);

    const sentence = fields.find((f) => f.label === 'Sentence');
    const translation = fields.find((f) => f.label === 'SentenceTranslation');
    const audio = fields.find((f) => f.label === 'SentenceAudio');

    const audioMatch = audio?.value.match(/\[sound:(.+?)\]/);
    // Fixed logic for audio source extraction
    const audioSrc = audioMatch
      ? `/media/${audioMatch[1]}`
      : null;

    // near top of component

    const audioCardUrl = getPlayableAudioUrlFromField(audio?.value);

    const translationRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
      if (isTranslationEditable && !useApiTranslation && translationRef.current) {
        translationRef.current.focus();
        // select existing text (if any) so paste replaces it
        translationRef.current.select();
      }
    }, [isTranslationEditable, useApiTranslation]);

        // Replace the existing effect that runs on [noteId, translation?.value]
    useEffect(() => {
      // reset visual state for each new note
      setShowMore(false);
      setIsTranslationEditable(false);
    
      // reset DeepL usage flag for a newly focused note (so previous note's DeepL click doesn't persist)
      setHasOpenedDeepL(false);
    
      // hide update button until DeepL is used & translation text exists
      setShowUpdateButton(false);
    }, [noteId]);

    useEffect(() => {
      setShowUpdateButton(Boolean(hasOpenedDeepL && translation?.value && translation.value.trim() !== ''));
    }, [translation?.value, hasOpenedDeepL]);

    // Use primaryFields definition if needed, otherwise secondaryFields is sufficient
    // const primaryFields = fields.filter((f) => PRIMARY_FIELDS.has(f.label));

    const secondaryFields = fields.filter((f) => !PRIMARY_FIELDS.has(f.label));

    // Determine if the "Translate" button should be visible
    const showTranslateButton = 
      !!sentence?.value && // Sentence field has a value
      !translation?.value; // Translation field is empty/missing value

    // Placeholder function for translation action
    // Combined and updated handleTranslate function
    const handleTranslate = async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        e.stopPropagation();
        if (!noteId || !sentence?.value) return;

        if (!useApiTranslation) {
            //const sourceText = encodeURIComponent(sentence.value);
            await navigator.clipboard.writeText(sentence.value);
            toast.info('Text is on the clipboard.');
            toast.info('DeepL will now open. Paste the translation above.');
            
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
            toast.info('Fetching translation via API...');
            try {
                const res = await fetch(`/api/notes/${noteId}/translate`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: sentence.value, target_lang: 'en-US' }) 
                });

                if (!res.ok) throw new Error('Translation API failed');

                const data = await res.json();
                const translatedText = data.translated_text;

                // Call the parent function to update the state with the API result
                onUpdateField?.(noteId, 'SentenceTranslation', translatedText); 

                toast.success('Translation successful and field updated!');
                setIsTranslationEditable(false); // Disable editing once API updates
            } catch (error) {
                console.error('Failed to translate', error);
                toast.error('Failed to translate via API');
            }
        }
    };

    // Handler for manual input changes (needs to bubble up to parent state manager)
    const handleTranslationInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newVal = e.target.value;
        if (noteId && onUpdateField) {
            // Immediately update the parent state as user types/pastes
            onUpdateField(noteId, 'SentenceTranslation', newVal);
        }
        setShowUpdateButton(Boolean(hasOpenedDeepL && newVal && newVal.trim() !== ''));
    };

    const handleUpdateCardClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (!noteId || !sentence?.value || !translation?.value) return;
      const audioId = audioMatch ? audioMatch[1] : undefined;
      // Debug: ensure this handler fires and what values it will send
      console.log('CardContext: handleUpdateCardClick', { noteId, sentence: sentence.value, translation: translation.value, audioId });
      // Pass explicit noteId to avoid race conditions in App
      //onUpdateCard?.(sentence.value, translation.value, audioId, noteId);
      onUpdateCard?.(sentence.value, translation.value, undefined, noteId);
      setShowUpdateButton(false);

    }

    
    // A reusable Input component for consistent styling
    const DiscreteInput = ({ value, className = '', readOnly = true, onChange, isBlinking = false, placeholder, inputRef }: { value: string, className?: string, readOnly?: boolean, onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void, isBlinking?: boolean, placeholder?: string, inputRef?: React.RefObject<HTMLTextAreaElement> } ) => (
      <textarea
        ref={inputRef}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
        placeholder={placeholder}
        // Tailwind styling to make it look like a <p> but with a discrete bottom border
        className={`w-full resize-none bg-transparent outline-none border-b-2 !border-white transition-all duration-150 p-1 ${isBlinking ? 'animate-blink-highlight' : ''} ${className}`}        
        rows={1} // Start with one row
        style={{ height: 'auto', overflowY: 'hidden' }} // Allows height to adjust dynamically if needed
        onClick={(e) => e.stopPropagation()}
      />
    );
    
    return (
      <div
        ref={ref}
        className="h-full flex flex-col bg-transparent transition-all duration-300"
        onClick={onActivate}
      >
        {/* Header (Kept original Card Context style) */}
        <div className="sticky top-0 bg-slate-800 z-10 px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-white text-lg font-semibold">Current Sentence: </h2>
            <div className="flex items-center gap-2">
              {showUpdateButton && (
                <button
                  onClick={handleUpdateCardClick}
                  disabled={!noteId || !onUpdateCard}
                  className="px-3 py-1.5 text-sm rounded-lg transition-colors shadow-sm bg-blue-500 text-white hover:bg-blue-600"
                >
                  Update Card
                </button>
              )}
            </div>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (!noteId) return;
              try {
                await fetch(`/api/notes/${noteId}/open`, { method: 'POST' });
                toast.info('Opened in Anki');
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
            Open in Anki
          </button>
        </div>

        {/* Content Area */}
        <div className="flex flex-col gap-4 px-6 py-4 overflow-y-auto">

          {/* Combined Sentence/Translation Block (Formatted like Example Sentences items) */}
          {sentence && translation && (
            <div
              // Apply Example Sentences item styling
              className="p-4 rounded-lg border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!audioCardUrl) return;
                    console.log('Playing audio URL:', audioCardUrl);
                    new Audio(audioCardUrl).play()
                      .catch(err => {
                        console.error('Audio playback failed', err);
                        toast.error('Audio playback failed (see console)');
                      });
                  }}
                  disabled={!audioCardUrl}
                  // Apply Example Sentences audio button styling
                  className={`flex-shrink-0 mt-0.5 p-2 rounded-full transition-colors ${
                    audioCardUrl
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                  aria-label="Play audio"
                >
                  {/* Using emoji as a placeholder for an icon component like Volume2 */}
                  🔊
                </button>

                {/* Editable Fields Container */}
                <div className="flex-1">
                  {/* Sentence Field (JP) */}
                  <div className='flex items-center justify-between gap-4'>
                    <DiscreteInput
                        value={sentence.value}
                        className="text-white" 
                        readOnly={true} 
                    />
                    
                    {/* Translate Button is now placed here, next to the JP sentence */}
                    {showTranslateButton && (
                        <button
                            onClick={handleTranslate}
                            className="flex-shrink-0 px-3 py-1.5 text-xs rounded-lg transition-colors shadow-sm bg-blue-600 text-white hover:bg-blue-700"
                            style={{ height: 'fit-content' }} // Optional: better vertical alignment
                        >
                            Translate w DeepL
                        </button>
                    )}
                  </div>
                  
                  {/* Translation Field (EN) */}
                  <DiscreteInput
                    value={translation.value}
                    className="text-slate-600 italic mt-4" // Added margin top for spacing
                    readOnly={!isTranslationEditable} 
                    onChange={handleTranslationInputChange} // Prevents parent onActivate from firing when interacting with the input
                    isBlinking={isTranslationEditable} 
                    placeholder={!useApiTranslation && isTranslationEditable ? 'Paste your translation here...' : undefined}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Secondary Fields (More Details logic remains intact) */}
          {secondaryFields.length > 0 && (
            <div className="mt-4">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMore((v) => !v);
                }}
                className="text-sm text-slate-600 hover:text-slate-800 flex items-center gap-1 font-medium"
              >
                {showMore ? 'Less details ▲' : 'More details ▾'}
              </button>

              {showMore && (
                <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-top-1">
                  {secondaryFields.map((field, index) => (
                    <div key={index} className="group">
                      <label className="block text-slate-400 mb-1 text-[10px] uppercase tracking-wider font-semibold">
                        {field.label}
                      </label>
                      <div className="text-slate-700 bg-slate-50/50 px-3 py-2 rounded-lg border border-slate-200 text-xs max-h-32 overflow-auto break-words whitespace-pre-wrap">
                        {field.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
);


CardContext.displayName = 'CardContext';
//This isn't right and needs fixing...
