// src/app/hooks/useSentences.ts
export type SentenceDTO = {
  jp: string;
  en: string;
  has_audio: boolean;
  audio_id?: string;
};

export async function fetchSentencesFor(word: string, perPage = 10) {
  const base = import.meta.env.DEV ? 'http://localhost:8000' : '';
  const url = `${base}/api/sentences?word=${encodeURIComponent(word)}&per_page=${perPage}`;
  const res = await fetch(url);
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.error('fetchSentencesFor -> invalid JSON', {
      url,
      status: res.status,
      textSnippet: text.slice(0, 1000),
    });
    throw new Error('Invalid JSON response from sentences endpoint');
  }

  if (!Array.isArray(data)) {
    console.error('fetchSentencesFor -> expected array but got:', data);
    throw new Error('Sentences endpoint did not return an array');
  }

  return data as SentenceDTO[];
}

// Provide a default export as a convenience (optional)
export default fetchSentencesFor;