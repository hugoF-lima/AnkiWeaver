import { useState } from "react";
import { Cog } from "lucide-react";
import SettingsDialog from "./SettingsDialog";
import { useTranslation } from "react-i18next";

export function Header({ onSettingsApplied }: { onSettingsApplied?: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <>
      <header
        data-component="Header"
        className="w-full p-4 border-b transition-all relative overflow-hidden"
        style={{
          background: `linear-gradient(to right, var(--anki-bg-start), var(--anki-bg-end))`,
          borderColor: `var(--anki-border-white)`,
          boxShadow: `var(--anki-inner-glow)`,
        }}
      >
        <div className="relative flex items-center justify-center">
          <div className="absolute left-4">
            {/* optional left controls */}
          </div>

          <h1 data-component="app-title" className="text-xl text-center font-normal tracking-tight text-[var(--anki-text-main)]">
            AnkiWeaver
          </h1>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            data-action="open-settings"
            data-component="open-settings-button"
            className="absolute right-4 rounded-lg border border-slate-600 bg-slate-900/70 p-2 text-slate-100 transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label={t("Open settings")}
          >
            <Cog className="h-5 w-5" />
          </button>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSettingsApplied={onSettingsApplied} />
    </>
  );
}
