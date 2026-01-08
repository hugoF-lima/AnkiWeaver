// export function tatoebaAudioUrl(audioId?: string): string | null {
//   return audioId
//     ? `https://tatoeba.org/en/audio/download/${audioId}`
//     : null;
// }

export function tatoebaAudioUrl(audioId?: string): string | null {
  if (!audioId) return null;
  // Ensure we encode the id for safe URL usage
  return `https://tatoeba.org/en/audio/download/${encodeURIComponent(audioId)}`;
}

export function getPlayableAudioUrlFromField(fieldValue?: string): string | null {
  const m = fieldValue?.match(/\[sound:(.+?)\]/);
  if (!m) return null;
  let name = m[1].trim();

  // If it's a 'tatoeba_' filename, treat the rest as the Tatoeba id
  if (name.startsWith('tatoeba_')) {
    let base = name.slice('tatoeba_'.length);
    if (base.endsWith('.mp3')) base = base.slice(0, -4);
    return tatoebaAudioUrl(base);
  }

  const numMatch = name.match(/(\d{4,})\.?mp3?$/);
  if (numMatch) {
    return tatoebaAudioUrl(numMatch[1]);
  }
  
  // If the filename looks like a file (has spaces or ends with .mp3) => play from /media/<filename>
  if (name.includes(' ') || name.endsWith('.mp3') || name.includes('%')) {
    return `/media/${encodeURIComponent(name)}`;
  }

  // Otherwise assume it's a raw Tatoeba id (maybe without .mp3)
  let id = name.endsWith('.mp3') ? name.slice(0, -4) : name;
  return tatoebaAudioUrl(id);
}