import { useEffect, useState } from "react";

export type SettingsApiKeys = {
  AZURE_SPEECH_KEY: string;
  DEEPL_AUTH_KEY: string;
  ELEVEN_LABS_SPEECH_KEY: string;
};

export function useSettings() {
  const [keys, setKeys] = useState<SettingsApiKeys>({
    AZURE_SPEECH_KEY: "",
    DEEPL_AUTH_KEY: "",
    ELEVEN_LABS_SPEECH_KEY: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/settings/env");
        if (!res.ok) throw new Error("Failed to load settings");
        const data = await res.json();
        setKeys({
          AZURE_SPEECH_KEY: data.AZURE_SPEECH_KEY ?? "",
          DEEPL_AUTH_KEY: data.DEEPL_AUTH_KEY ?? "",
          ELEVEN_LABS_SPEECH_KEY: data.ELEVEN_LABS_SPEECH_KEY ?? "",
        });
      } catch (e: any) {
        setError(e.message ?? "Unknown");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const save = async (next: SettingsApiKeys) => {
    const res = await fetch("/api/settings/env", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error("Failed to save settings");
    setKeys(next);
  };

  return { keys, loading, error, save };
}