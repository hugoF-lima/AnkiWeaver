import { useEffect, useMemo, useRef, useState } from "react";
import { validateApiKey, APIKeyValidation, APIKeyType } from "../lib/APIKeyValidator";
import { Checkbox } from "./ui/checkbox";
import { Plus, Pencil, Check, X, Eye, EyeOff, CircleHelp, Trash2, FolderOpen, Download, Upload } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n, { DISPLAY_LANGUAGE_STORAGE_KEY, DisplayLanguage, setDisplayLanguage } from "../i18n";

type SettingsTab = "Mapping" | "API Keys" | "Language" | "About";

interface MappingEntry {
  anki_field: string;
  internal_field: string;
  active: boolean;
}

const DEFAULT_DATABASE_PATH = "backend/data/tatoeba-multi-lang.db";

const INTERNAL_FIELDS = [
  { id: "expression", label: "Expression" },
  { id: "reading", label: "Reading" },
  { id: "glossary", label: "Glossary" },
  { id: "expression_audio", label: "Expression Audio" },
  { id: "sentence", label: "Sentence" },
  { id: "translation", label: "Sentence Translation" },
  { id: "sentence_audio", label: "Sentence Audio" },
];

interface EnvPayload {
  AZURE_SPEECH_KEY: string;
  DEEPL_AUTH_KEY: string;
  ELEVEN_LABS_SPEECH_KEY: string;
}

interface SettingsProfile {
  name: string;
  env: EnvPayload;
  languageOverride: "auto" | "jp" | "en";
  selectedNoteType?: string;
  databasePath?: string;
  mappings: Record<string, MappingEntry[]>;
}

interface SettingsStore {
  activeProfileId: string;
  profiles: Record<string, SettingsProfile>;
}

interface ImportedProfilesPayload {
  activeProfileId?: string;
  profiles?: Record<string, SettingsProfile>;
}

interface WindowWithFilePicker extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

//type APIKeyType = "AZURE" | "DEEPL" | "ELEVEN";
//type APIKeyValidation = "idle" | "pending" | "valid" | "invalid";

function normalizeMappingEntries(entries: MappingEntry[] | undefined): MappingEntry[] {
  const byInternal = new Map<string, MappingEntry>();
  for (const e of entries ?? []) {
    const k = String(e?.internal_field ?? "").trim();
    if (!k) continue;
    byInternal.set(k, {
      internal_field: k,
      anki_field: String(e?.anki_field ?? ""),
      active: Boolean(e?.active),
    });
  }

  const normalized: MappingEntry[] = INTERNAL_FIELDS.map((f) => {
    const existing = byInternal.get(f.id);
    if (existing) {
      return {
        ...existing,
        active: f.id === "expression" || f.id === "sentence" ? true : existing.active,
      };
    }
    return {
      internal_field: f.id,
      anki_field: "",
      active: true,
    };
  });

  const known = new Set(INTERNAL_FIELDS.map((f) => f.id));
  for (const [k, v] of byInternal.entries()) {
    if (!known.has(k)) normalized.push(v);
  }

  return normalized;
}

function normalizeMappingsRecord(mappings: Record<string, MappingEntry[]>): Record<string, MappingEntry[]> {
  const next: Record<string, MappingEntry[]> = {};
  for (const [noteType, entries] of Object.entries(mappings ?? {})) {
    next[noteType] = normalizeMappingEntries(entries);
  }
  return next;
}

function getInitialDatabasePath(path: string | undefined): string {
  if (path === undefined || path === null) return DEFAULT_DATABASE_PATH;
  return String(path).trim();
}

function isDatabasePathValid(path: string): boolean {
  return path.trim().length > 0;
}

function hydrateSettingsStore(store: SettingsStore): SettingsStore {
  return {
    ...store,
    profiles: Object.fromEntries(
      Object.entries(store.profiles ?? {}).map(([id, profile]) => [
        id,
        {
          ...profile,
          databasePath: getInitialDatabasePath(profile?.databasePath),
        },
      ])
    ),
  };
}

function sanitizeProfile(profile: SettingsProfile): SettingsProfile {
  return {
    name: String(profile?.name ?? "").trim() || "Imported Profile",
    env: {
      AZURE_SPEECH_KEY: String(profile?.env?.AZURE_SPEECH_KEY ?? ""),
      DEEPL_AUTH_KEY: String(profile?.env?.DEEPL_AUTH_KEY ?? ""),
      ELEVEN_LABS_SPEECH_KEY: String(profile?.env?.ELEVEN_LABS_SPEECH_KEY ?? ""),
    },
    languageOverride: profile?.languageOverride === "jp" || profile?.languageOverride === "en" ? profile.languageOverride : "auto",
    selectedNoteType: String(profile?.selectedNoteType ?? ""),
    databasePath: getInitialDatabasePath(profile?.databasePath),
    mappings: normalizeMappingsRecord(profile?.mappings ?? {}),
  };
}

function slugifyProfileId(value: string): string {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `profile_${Date.now()}`;
}

function createUniqueProfileId(baseId: string, existingIds: Set<string>): string {
  let candidate = slugifyProfileId(baseId);
  if (!existingIds.has(candidate)) return candidate;
  let suffix = 2;
  while (existingIds.has(`${candidate}_${suffix}`)) suffix += 1;
  return `${candidate}_${suffix}`;
}

function createUniqueProfileName(baseName: string, existingNames: Set<string>): string {
  const normalizedBaseName = String(baseName || "").trim() || "Imported Profile";
  if (!existingNames.has(normalizedBaseName)) return normalizedBaseName;

  let suffix = 1;
  let candidate = `${normalizedBaseName} (${suffix})`;
  while (existingNames.has(candidate)) {
    suffix += 1;
    candidate = `${normalizedBaseName} (${suffix})`;
  }
  return candidate;
}

function parseImportedProfiles(raw: string): ImportedProfilesPayload {
  const parsed = JSON.parse(raw) as ImportedProfilesPayload | SettingsProfile;
  if (parsed && typeof parsed === "object" && "profiles" in parsed) {
    const profiles = (parsed as ImportedProfilesPayload).profiles;
    if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
      throw new Error("Invalid profiles file.");
    }
    return { activeProfileId: (parsed as ImportedProfilesPayload).activeProfileId, profiles };
  }
  throw new Error("Invalid profiles file.");
}

const iconFor = (state: APIKeyValidation) => {
  if (state === "valid") return <span className="text-emerald-400">✔</span>;
  if (state === "invalid") return <span className="text-rose-400">✖</span>;
  if (state === "pending")
    return (
      <span className="text-blue-300 inline-flex items-center" aria-label="Validating">
        <span className="animate-pulse" style={{ animationDelay: "0ms" }}>
          .
        </span>
        <span className="animate-pulse" style={{ animationDelay: "150ms" }}>
          .
        </span>
        <span className="animate-pulse" style={{ animationDelay: "300ms" }}>
          .
        </span>
      </span>
    );
  return null;
};



async function saveEnv(values: EnvPayload) {
  const r = await fetch("/api/settings/env", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const text = await r.text().catch(() => "");
  return { ok: r.ok, error: r.ok ? null : (text || `HTTP ${r.status}`) };
}

async function fetchEnv(): Promise<EnvPayload | null> {
  try {
    const r = await fetch("/api/settings/env");
    if (!r.ok) throw new Error("Failed to load env");
    const data = (await r.json()) as Partial<EnvPayload>;
    return {
      AZURE_SPEECH_KEY: String(data?.AZURE_SPEECH_KEY ?? ""),
      DEEPL_AUTH_KEY: String(data?.DEEPL_AUTH_KEY ?? ""),
      ELEVEN_LABS_SPEECH_KEY: String(data?.ELEVEN_LABS_SPEECH_KEY ?? ""),
    };
  } catch {
    return null;
  }
}

async function fetchSettingsStore(): Promise<SettingsStore | null> {
  try {
    const r = await fetch("/api/settings/profiles");
    if (!r.ok) throw new Error("Failed to load profiles");
    return (await r.json()) as SettingsStore;
  } catch {
    return null;
  }
}

async function saveSettingsStore(store: SettingsStore) {
  const r = await fetch("/api/settings/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(store),
  });
  return r.ok;
}

async function setActiveProfile(profileId: string) {
  const r = await fetch("/api/settings/active-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId }),
  });
  return r.ok;
}

async function fetchNoteTypes() {
  try {
    const r = await fetch("/api/anki/models");
    if (!r.ok) throw new Error("Failed to load note types");
    return await r.json();
  } catch {
    return [];
  }
}

async function fetchNoteTypeFields(modelName: string) {
  try {
    const r = await fetch(`/api/anki/models/${encodeURIComponent(modelName)}/fields`);
    if (!r.ok) throw new Error("Failed to load fields");
    return await r.json();
  } catch {
    return [];
  }
}

async function uploadDatabaseFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const r = await fetch("/api/settings/database/upload", {
    method: "POST",
    body: formData,
  });
  const text = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(text || `HTTP ${r.status}`);
  }
  const data = text ? JSON.parse(text) : {};
  return String(data?.databasePath ?? "").trim();
}

export default function SettingsDialog({
  open,
  onOpenChange,
  onSettingsApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsApplied?: () => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("Mapping");
  const [azureKey, setAzureKey] = useState("");
  const [deeplKey, setDeeplKey] = useState("");
  const [elevenLabsKey, setElevenLabsKey] = useState("");
  const [showAzureKey, setShowAzureKey] = useState(false);
  const [showDeeplKey, setShowDeeplKey] = useState(false);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [displayLanguageDraft, setDisplayLanguageDraft] = useState<DisplayLanguage>(() => {
    const raw = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY);
    return raw === "pt-BR" ? "pt-BR" : "en";
  });
  const displayLanguageSavedRef = useRef<DisplayLanguage>(
    window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY) === "pt-BR" ? "pt-BR" : "en"
  );

  const [store, setStore] = useState<SettingsStore | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  const [languageOverride, setLanguageOverride] = useState<"auto" | "jp" | "en">("auto");
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");

  const [noteTypes, setNoteTypes] = useState<string[]>([]);
  const [selectedNoteType, setSelectedNoteType] = useState<string>("");
  const [databasePath, setDatabasePath] = useState(DEFAULT_DATABASE_PATH);
  const [noteTypeFields, setNoteTypeFields] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, MappingEntry[]>>({});
  const [databaseUploading, setDatabaseUploading] = useState(false);
  const databaseFileInputRef = useRef<HTMLInputElement | null>(null);
  const importSettingsInputRef = useRef<HTMLInputElement | null>(null);
  const [profileActionsOpen, setProfileActionsOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [selectedExportProfileIds, setSelectedExportProfileIds] = useState<string[]>([]);
  const [exportingSettings, setExportingSettings] = useState(false);
  const [importingSettings, setImportingSettings] = useState(false);

  const [checkState, setCheckState] = useState<Record<APIKeyType, APIKeyValidation>>({
    AZURE: "idle",
    DEEPL: "idle",
    ELEVEN: "idle",
  });

  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [keysDirty, setKeysDirty] = useState(false);
  const [languageDirty, setLanguageDirty] = useState(false);
  const [profileDeleteConfirmOpen, setProfileDeleteConfirmOpen] = useState(false);
  const [profileLoadMessage, setProfileLoadMessage] = useState<string | null>(null);
  const [profileLoadMessageVisible, setProfileLoadMessageVisible] = useState(false);
  const deeplValidationTimeoutRef = useRef<number | null>(null);
  const elevenValidationTimeoutRef = useRef<number | null>(null);
  const profileLoadFadeTimeoutRef = useRef<number | null>(null);
  const profileLoadClearTimeoutRef = useRef<number | null>(null);

  const clearProfileLoadTimers = () => {
    if (profileLoadFadeTimeoutRef.current != null) {
      window.clearTimeout(profileLoadFadeTimeoutRef.current);
      profileLoadFadeTimeoutRef.current = null;
    }
    if (profileLoadClearTimeoutRef.current != null) {
      window.clearTimeout(profileLoadClearTimeoutRef.current);
      profileLoadClearTimeoutRef.current = null;
    }
  };

  const openExportDialog = () => {
    const profileIds = Object.keys(store?.profiles ?? {});
    if (profileIds.length === 0) {
      toast.error(t("No profile loaded."));
      return;
    }
    setSelectedExportProfileIds(profileIds);
    setProfileActionsOpen(false);
    setExportDialogOpen(true);
  };

  const applyHydratedStore = (next: SettingsStore, nextActiveId?: string) => {
    const hydrated = hydrateSettingsStore(next);
    const resolvedActiveId = nextActiveId || hydrated.activeProfileId || Object.keys(hydrated.profiles || {})[0] || "default";
    const profile = hydrated.profiles?.[resolvedActiveId];
    setStore(hydrated);
    setActiveProfileId(resolvedActiveId);
    setMappings(normalizeMappingsRecord(profile?.mappings ?? {}));
    setLanguageOverride(profile?.languageOverride ?? "auto");
    setSelectedNoteType(profile?.selectedNoteType ?? "");
    setDatabasePath(getInitialDatabasePath(profile?.databasePath));
    setEditingProfileName(false);
    setProfileNameDraft(profile?.name ?? "");
    setMappingDirty(false);
    setKeysDirty(false);
    setLanguageDirty(false);
  };

  const downloadTextFile = async (filename: string, contents: string) => {
    const pickerWindow = window as WindowWithFilePicker;
    if (typeof pickerWindow.showSaveFilePicker === "function") {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "JSON Files", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return;
    }

    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const exportSelectedProfiles = async () => {
    if (!store) return;
    const selectedIds = selectedExportProfileIds.filter((id) => store.profiles?.[id]);
    if (selectedIds.length === 0) {
      toast.error(t("Select at least one profile."));
      return;
    }

    const exportStore: SettingsStore = {
      activeProfileId: selectedIds.includes(activeProfileId) ? activeProfileId : selectedIds[0],
      profiles: Object.fromEntries(selectedIds.map((id) => [id, sanitizeProfile(store.profiles[id])])),
    };

    setExportingSettings(true);
    try {
      await downloadTextFile("ankiweaver-profile-settings.json", JSON.stringify(exportStore, null, 2));
      setExportDialogOpen(false);
      toast.success(t("Settings exported."));
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast.error(err?.message || t("Failed to export settings."));
      }
    } finally {
      setExportingSettings(false);
    }
  };

  const importSettingsFromFile = async (file: File) => {
    if (!store) return;
    setImportingSettings(true);
    try {
      const text = await file.text();
      const parsed = parseImportedProfiles(text);
      const incomingProfiles = parsed.profiles ?? {};
      const existingIds = new Set(Object.keys(store.profiles ?? {}));
      const existingNames = new Set(
        Object.values(store.profiles ?? {}).map((profile) => String(profile?.name ?? "").trim()).filter(Boolean)
      );
      const mergedProfiles: Record<string, SettingsProfile> = { ...(store.profiles ?? {}) };
      let importedCount = 0;

      for (const [rawId, profile] of Object.entries(incomingProfiles)) {
        const sanitized = sanitizeProfile(profile);
        const nextId = createUniqueProfileId(rawId || profile?.name || "profile", existingIds);
        const nextName = createUniqueProfileName(sanitized.name, existingNames);
        existingIds.add(nextId);
        existingNames.add(nextName);
        mergedProfiles[nextId] = {
          ...sanitized,
          name: nextName,
        };
        importedCount += 1;
      }

      if (importedCount === 0) {
        throw new Error(t("No profiles found in import file."));
      }

      const nextStore: SettingsStore = {
        activeProfileId: activeProfileId || store.activeProfileId,
        profiles: mergedProfiles,
      };
      const ok = await saveSettingsStore(nextStore);
      if (!ok) {
        throw new Error(t("Failed to import settings."));
      }

      applyHydratedStore(nextStore, activeProfileId || nextStore.activeProfileId);
      void refreshEnvFromBackend();
      onSettingsApplied?.();
      toast.success(
        importedCount === 1
          ? t("Imported 1 profile.")
          : t("Imported {{count}} profiles.", { count: importedCount })
      );
    } finally {
      setImportingSettings(false);
    }
  };

  const showProfileLoadNotice = (profileName: string) => {
    clearProfileLoadTimers();
    setProfileLoadMessage(t("settings.profileLoaded", { profileName }));
    setProfileLoadMessageVisible(true);
    profileLoadFadeTimeoutRef.current = window.setTimeout(() => {
      setProfileLoadMessageVisible(false);
      profileLoadClearTimeoutRef.current = window.setTimeout(() => {
        setProfileLoadMessage(null);
        profileLoadClearTimeoutRef.current = null;
      }, 250);
      profileLoadFadeTimeoutRef.current = null;
    }, 5000);
  };

  const saveProfileRename = async (nameOverride?: string) => {
    const v = String(nameOverride ?? profileNameDraft).trim();
    if (!v) return;
    if (!store || !activeProfileId) return;
    const existing = store.profiles?.[activeProfileId];
    if (!existing) return;
    const next: SettingsStore = {
      ...store,
      profiles: {
        ...store.profiles,
        [activeProfileId]: {
          ...existing,
          name: v,
        },
      },
    };
    const ok = await saveSettingsStore(next);
    if (!ok) {
      toast.error(t("Failed to rename profile."));
      return;
    }
    setStore(next);
    setProfileNameDraft(v);
    setEditingProfileName(false);
    showProfileLoadNotice(v);
    toast.success(t("Profile renamed."));
  };

  const refreshEnvFromBackend = async () => {
    const env = await fetchEnv();
    if (!env) return;
    setAzureKey(env.AZURE_SPEECH_KEY || "");
    setDeeplKey(env.DEEPL_AUTH_KEY || "");
    setElevenLabsKey(env.ELEVEN_LABS_SPEECH_KEY || "");
    setShowAzureKey(false);
    setShowDeeplKey(false);
    setShowElevenLabsKey(false);

    setCheckState((prev) => ({ ...prev, AZURE: "idle", DEEPL: "idle", ELEVEN: "idle" }));
    if (env.AZURE_SPEECH_KEY) void runValidation("AZURE", env.AZURE_SPEECH_KEY);
    if (env.DEEPL_AUTH_KEY) void runValidation("DEEPL", env.DEEPL_AUTH_KEY);
    if (env.ELEVEN_LABS_SPEECH_KEY) void runValidation("ELEVEN", env.ELEVEN_LABS_SPEECH_KEY);
  };

  useEffect(() => {
    if (!open) return;
    const current = window.localStorage.getItem(DISPLAY_LANGUAGE_STORAGE_KEY) === "pt-BR" ? "pt-BR" : "en";
    displayLanguageSavedRef.current = current;
    setDisplayLanguageDraft(current);
    
    // Load Note Types
    fetchNoteTypes().then(setNoteTypes);

    fetchSettingsStore().then((s) => {
      if (!s) return;
      const hydrated = hydrateSettingsStore(s);
      setStore(hydrated);
      const id = hydrated.activeProfileId || Object.keys(hydrated.profiles || {})[0] || "default";
      setActiveProfileId(id);
      const profile = hydrated.profiles?.[id];
      setMappings(normalizeMappingsRecord(profile?.mappings ?? {}));
      setLanguageOverride(profile?.languageOverride ?? "auto");
      setSelectedNoteType(profile?.selectedNoteType ?? "");
      setDatabasePath(getInitialDatabasePath(profile?.databasePath));
      setEditingProfileName(false);
      setProfileNameDraft(profile?.name ?? "");
      setProfileLoadMessage(null);
      setProfileLoadMessageVisible(false);

      setMappingDirty(false);
      setKeysDirty(false);
      setLanguageDirty(false);

      void refreshEnvFromBackend();
    });
  }, [open]);

  useEffect(() => {
    if (selectedNoteType) {
      fetchNoteTypeFields(selectedNoteType).then(setNoteTypeFields);
    } else {
      setNoteTypeFields([]);
    }
  }, [selectedNoteType]);

  const currentMapping = useMemo(() => {
    if (!selectedNoteType) return [];
    
    return normalizeMappingEntries(mappings[selectedNoteType]);
  }, [selectedNoteType, mappings]);

  const handleMappingChange = (internalId: string, ankiField: string) => {
    setMappings(prev => {
      const existing = normalizeMappingEntries(prev[selectedNoteType]);
      const updated = existing.map((m) =>
        m.internal_field === internalId ? { ...m, anki_field: ankiField } : m
      );
      return { ...prev, [selectedNoteType]: updated };
    });
    setMappingDirty(true);
  };

  const handleActiveChange = (internalId: string, active: boolean) => {
    if (internalId === "expression" || internalId === "sentence") return;
    setMappings(prev => {
      const existing = normalizeMappingEntries(prev[selectedNoteType]);
      const updated = existing.map((m) => (m.internal_field === internalId ? { ...m, active } : m));
      return { ...prev, [selectedNoteType]: updated };
    });
    setMappingDirty(true);
  };

  useEffect(() => {
    if (!profileLoadMessage) {
      setProfileLoadMessageVisible(false);
      return;
    }
    const profileName = store?.profiles?.[activeProfileId]?.name?.trim();
    if (!profileName) return;
    const nextMessage = t("settings.profileLoaded", { profileName });
    if (profileLoadMessage !== nextMessage) {
      setProfileLoadMessage(nextMessage);
    }
  }, [activeProfileId, profileLoadMessage, store]);

  useEffect(() => {
    return () => {
      clearProfileLoadTimers();
    };
  }, []);

  const keysValid = [
    azureKey.trim() ? checkState.AZURE === "valid" : true,
    deeplKey.trim() ? checkState.DEEPL === "valid" : true,
    elevenLabsKey.trim() ? checkState.ELEVEN === "valid" : true,
  ].every(Boolean);
  const databasePathRequired = activeTab === "Mapping" && !isDatabasePathValid(databasePath);

  async function runValidation(provider: APIKeyType, value: string): Promise<APIKeyValidation> {
    const trimmed = value.trim();
    if (!trimmed) {
      setCheckState((prev) => ({ ...prev, [provider]: "idle" }));
      return "idle";
    }
    setCheckState((prev) => ({ ...prev, [provider]: "pending" }));
    const validated = await validateApiKey(provider, trimmed);
    setCheckState((prev) => ({ ...prev, [provider]: validated }));
    return validated;
  }

  useEffect(() => {
    if (!open) return;
    if (activeTab !== "API Keys") return;

    if (deeplValidationTimeoutRef.current != null) {
      window.clearTimeout(deeplValidationTimeoutRef.current);
      deeplValidationTimeoutRef.current = null;
    }

    const trimmed = deeplKey.trim();
    if (!trimmed) {
      setCheckState((s) => ({ ...s, DEEPL: "idle" }));
      return;
    }

    deeplValidationTimeoutRef.current = window.setTimeout(() => {
      deeplValidationTimeoutRef.current = null;
      void runValidation("DEEPL", trimmed);
    }, 700);

    return () => {
      if (deeplValidationTimeoutRef.current != null) {
        window.clearTimeout(deeplValidationTimeoutRef.current);
        deeplValidationTimeoutRef.current = null;
      }
    };
  }, [open, activeTab, deeplKey]);

  useEffect(() => {
    if (!open) return;
    if (activeTab !== "API Keys") return;

    if (elevenValidationTimeoutRef.current != null) {
      window.clearTimeout(elevenValidationTimeoutRef.current);
      elevenValidationTimeoutRef.current = null;
    }

    const trimmed = elevenLabsKey.trim();
    if (!trimmed) {
      setCheckState((s) => ({ ...s, ELEVEN: "idle" }));
      return;
    }

    elevenValidationTimeoutRef.current = window.setTimeout(() => {
      elevenValidationTimeoutRef.current = null;
      void runValidation("ELEVEN", trimmed);
    }, 700);

    return () => {
      if (elevenValidationTimeoutRef.current != null) {
        window.clearTimeout(elevenValidationTimeoutRef.current);
        elevenValidationTimeoutRef.current = null;
      }
    };
  }, [open, activeTab, elevenLabsKey]);

  const tabItems = useMemo<SettingsTab[]>(() => ["Mapping", "API Keys", "Language", "About"], []);

  const getContent = () => {
    if (activeTab === "Mapping") {
      return (
        <div className="space-y-6 p-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">{t("Anki Note Type")}</label>
            <Select
              value={selectedNoteType}
              onValueChange={(v) => {
                setSelectedNoteType(v);
                setStore((prev) => {
                  if (!prev) return prev;
                  const existing = prev.profiles?.[activeProfileId];
                  if (!existing) return prev;
                  return {
                    ...prev,
                    profiles: {
                      ...prev.profiles,
                      [activeProfileId]: {
                        ...existing,
                        selectedNoteType: v,
                      },
                    },
                  };
                });
                setMappingDirty(true);
              }}
            >
              <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-slate-100">
                <SelectValue placeholder={t("Select a note type...")} />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                {noteTypes.map(type => (
                  <SelectItem key={type} value={type} className="hover:bg-slate-800 focus:bg-slate-800">
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedNoteType && (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800/50 border-b border-slate-700">
                    <th className="px-4 py-2 text-left text-xs font-bold text-slate-400 uppercase">{t("Internal Field")}</th>
                    <th className="px-4 py-2 text-left text-xs font-bold text-slate-400 uppercase">{t("Anki Field")}</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-slate-400 uppercase">{t("Status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {INTERNAL_FIELDS.map((internal) => {
                    const mapping = currentMapping.find(m => m.internal_field === internal.id);
                    return (
                      <tr key={internal.id} className="hover:bg-slate-800/30">
                        <td className="px-4 py-3 text-slate-200">{t(internal.label)}</td>
                        <td className="px-4 py-3">
                          <Select 
                            value={mapping?.anki_field || ""} 
                            onValueChange={(val) => handleMappingChange(internal.id, val)}
                          >
                            <SelectTrigger className="h-8 bg-slate-900 border-slate-700 text-slate-300 text-xs">
                              <SelectValue placeholder={t("Map field...")} />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                              {noteTypeFields.map(field => (
                                <SelectItem key={field} value={field} className="text-xs">
                                  {field}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {internal.id === "expression" || internal.id === "sentence" ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex justify-center">
                                    <Checkbox 
                                      checked={true} 
                                      disabled={true}
                                      className="border-slate-600 data-[state=checked]:bg-blue-600/50 data-[state=checked]:border-blue-600/50 opacity-50 cursor-not-allowed"
                                    />
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent className="bg-slate-800 border-slate-700 text-xs">
                                  {internal.id === "expression"
                                    ? t("Expression is required for the Grid to work")
                                    : t("settings.sentenceAlwaysEnabled")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <Checkbox 
                              checked={mapping?.active ?? true} 
                              onCheckedChange={(checked) => handleActiveChange(internal.id, !!checked)}
                              className="border-slate-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className={`block text-xs uppercase tracking-wider ${
                  databasePathRequired ? "text-rose-400" : "text-slate-400"
                }`}
              >
                {t("Database Path")}
              </label>
              {databasePathRequired ? (
                <span className="text-xs font-medium text-rose-400">{t("Required")}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={databasePath}
                onChange={(e) => {
                  setDatabasePath(e.target.value);
                  setMappingDirty(true);
                }}
                className={`w-full rounded-lg border bg-slate-800 px-3 py-2 text-slate-100 outline-none focus:ring-2 ${
                  databasePathRequired
                    ? "border-rose-500 focus:ring-rose-500"
                    : "border-slate-700 focus:ring-blue-500"
                }`}
                placeholder={t("settings.databasePathPlaceholder")}
                autoComplete="off"
                aria-invalid={databasePathRequired}
              />
              <button
                type="button"
                onClick={() => databaseFileInputRef.current?.click()}
                disabled={databaseUploading}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
                <span>{databaseUploading ? t("Loading files...") : t("Browse")}</span>
              </button>
              <input
                ref={databaseFileInputRef}
                type="file"
                accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (!file) return;

                  setDatabaseUploading(true);
                  void uploadDatabaseFile(file)
                    .then((nextPath) => {
                      setDatabasePath(nextPath);
                      setMappingDirty(true);
                    })
                    .catch((err: any) => {
                      toast.error(err?.message || t("settings.databaseUploadFailed"));
                    })
                    .finally(() => {
                      setDatabaseUploading(false);
                    });
                }}
              />
            </div>
          </div>

          {!selectedNoteType && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <p>{t("Select a Note Type to configure mapping.")}</p>
            </div>
          )}
        </div>
      );
    }

    if (activeTab === "Language") {
      return (
        <div className="space-y-4 p-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">{t("Deck Language Override")}</label>
            <Select
              value={languageOverride}
              onValueChange={(v) => {
                const next = (v as any) as "auto" | "jp" | "en";
                setLanguageOverride(next);
                setLanguageDirty(true);
              }}
            >
              <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-slate-100">
                <SelectValue placeholder={t("Auto")} />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                <SelectItem value="auto">{t("Auto")}</SelectItem>
                <SelectItem value="jp">{t("Japanese")}</SelectItem>
                <SelectItem value="en">{t("English")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-2">{t("Display Language")}</label>
            <Select
              value={displayLanguageDraft}
              onValueChange={(v) => {
                const next = (v === "pt-BR" ? "pt-BR" : "en") as DisplayLanguage;
                setDisplayLanguageDraft(next);
                setLanguageDirty(true);
              }}
            >
              <SelectTrigger className="w-full bg-slate-800 border-slate-700 text-slate-100">
                <SelectValue placeholder={t("English (Default)")} />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 text-slate-100">
                <SelectItem value="en">{t("English (Default)")}</SelectItem>
                <SelectItem value="pt-BR">{t("Brazillian Portuguese")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }

    if (activeTab === "About") {
      return (
        <div className="space-y-3 p-4 text-slate-300">
          <p className="text-sm">{t("about.description")}</p>
          <p className="text-sm">{t("about.originally")}</p>
          <p className="text-sm">
            {t("about.sourcePrefix")}{" "}
            <a
              href="https://github.com/hugoF-lima/AnkiWeaver/"
              target="_blank"
              rel="noreferrer"
              className="text-blue-300 underline hover:text-blue-200"
            >
              {t("Github")}
            </a>
            .
          </p>
        </div>
      );
    }

    if (activeTab !== "API Keys") {
      return (
        <div className="p-4 text-slate-300">
          <p className="text-sm">{t("Content coming soon.")}</p>
        </div>
      );
    }

    return (
      <div className="space-y-4 p-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span>Azure API Key {iconFor(checkState.AZURE)}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-200"
                      aria-label={t("settings.azureApiKeyHelp")}
                    >
                      <CircleHelp className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-800 border-slate-700 text-xs max-w-xs">
                    <span>
                      {t("settings.azureApiKeyHelpText")}{" "}
                      <a
                        href="https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-text-to-speech"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {t("here")}
                      </a>
                      .
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </label>
          <div className="relative">
            <input
              type={showAzureKey ? "text" : "password"}
              value={azureKey}
              onChange={(e) => {
                const v = e.target.value;
                setAzureKey(v);
                setCheckState((s) => ({ ...s, AZURE: v.trim() ? "pending" : "idle" }));
                setKeysDirty(true);
              }}
              onBlur={() => runValidation("AZURE", azureKey)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="AZURE_SPEECH_KEY"
              autoComplete="off"
            />
            {azureKey.trim() ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowAzureKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-300 hover:text-white hover:bg-white/10"
                aria-label={showAzureKey ? t("settings.hideAzureKey") : t("settings.showAzureKey")}
              >
                {showAzureKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
          {/* <div className="mt-1">{iconFor(checkState.AZURE)}</div> */}
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span>DeepL API Key {iconFor(checkState.DEEPL)}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-200"
                      aria-label={t("settings.deeplApiKeyHelp")}
                    >
                      <CircleHelp className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-800 border-slate-700 text-xs max-w-xs">
                    <span>
                      {t("You need a Deepl API Key for instantly translating sentences. Learn how to get one")}{" "}
                      <a
                        href="https://www.deepl.com/pro-api"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {t("here")}
                      </a>
                      .
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </label>
          {/* <label>
            Azure API Key {iconFor(checkState.AZURE)}
          </label> */}
          <div className="relative">
            <input
              type={showDeeplKey ? "text" : "password"}
              value={deeplKey}
              onChange={(e) => {
                const v = e.target.value;
                setDeeplKey(v);
                setCheckState((s) => ({ ...s, DEEPL: v.trim() ? "pending" : "idle" }));
                setKeysDirty(true);
              }}
              onBlur={() => runValidation("DEEPL", deeplKey)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="DEEPL_AUTH_KEY"
              autoComplete="off"
            />
            {deeplKey.trim() ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowDeeplKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-300 hover:text-white hover:bg-white/10"
                aria-label={showDeeplKey ? t("settings.hideDeeplKey") : t("settings.showDeeplKey")}
              >
                {showDeeplKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span>ElevenLabs API Key {iconFor(checkState.ELEVEN)}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-slate-200"
                      aria-label={t("settings.elevenlabsApiKeyHelp")}
                    >
                      <CircleHelp className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="bg-slate-800 border-slate-700 text-xs max-w-xs">
                    <span>
                      {t("settings.elevenlabsApiKeyHelpText")}{" "}
                      <a
                        href="https://elevenlabs.io/app/settings/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {t("here")}
                      </a>
                      .
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          </label>
          <div className="relative">
            <input
              type={showElevenLabsKey ? "text" : "password"}
              value={elevenLabsKey}
              onChange={(e) => {
                const v = e.target.value;
                setElevenLabsKey(v);
                setCheckState((s) => ({ ...s, ELEVEN: v.trim() ? "pending" : "idle" }));
                setKeysDirty(true);
              }}
              onBlur={() => {
                if (elevenValidationTimeoutRef.current != null) {
                  window.clearTimeout(elevenValidationTimeoutRef.current);
                  elevenValidationTimeoutRef.current = null;
                }
                void runValidation("ELEVEN", elevenLabsKey);
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-10 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ELEVEN_LABS_SPEECH_KEY"
              autoComplete="off"
            />
            {elevenLabsKey.trim() ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowElevenLabsKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-300 hover:text-white hover:bg-white/10"
                aria-label={showElevenLabsKey ? t("settings.hideElevenlabsKey") : t("settings.showElevenlabsKey")}
              >
                {showElevenLabsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-component="SettingsDialog"
        className="w-[95vw] max-w-4xl max-h-[85vh] bg-slate-900/95 border border-slate-700 text-slate-100 shadow-2xl overflow-hidden flex flex-col"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div>
            <DialogTitle data-component="settings-dialog-title">{t("Settings")}</DialogTitle>
            <DialogDescription data-component="settings-dialog-description">
              {t("Global configuration for AnkiWeaver.")}
            </DialogDescription>
          </div>

          <div className="flex items-start gap-2">
            <div className="min-w-[240px]">
              <Select
                value={activeProfileId}
                onValueChange={async (id) => {
                  if (!id) return;
                  if (id === activeProfileId) return;
                  const ok = await setActiveProfile(id);
                  if (!ok) {
                    toast.error(t("Failed to switch profile."));
                    return;
                  }
                  const next = await fetchSettingsStore();
                  if (!next) {
                    toast.error(t("Failed to reload profile."));
                    return;
                  }
                  const hydrated = hydrateSettingsStore(next);
                  setStore(hydrated);
                  setActiveProfileId(hydrated.activeProfileId);
                  const profile = hydrated.profiles?.[hydrated.activeProfileId];
                  setMappings(normalizeMappingsRecord(profile?.mappings ?? {}));
                  setLanguageOverride(profile?.languageOverride ?? "auto");
                  setSelectedNoteType(profile?.selectedNoteType ?? "");
                  setDatabasePath(getInitialDatabasePath(profile?.databasePath));
                  void refreshEnvFromBackend();
                  setEditingProfileName(false);
                  setProfileNameDraft(profile?.name ?? "");
                  showProfileLoadNotice(profile?.name || id);
                  setMappingDirty(false);
                  setKeysDirty(false);
                  setLanguageDirty(false);
                  onSettingsApplied?.();
                }}
              >
                <SelectTrigger
                  data-component="profile-select-trigger"
                  className={`w-full border text-slate-100 ${
                    editingProfileName
                      ? "bg-slate-700/60 border-blue-500 ring-2 ring-blue-500/40"
                      : "bg-slate-800 border-slate-700"
                  }`}
                >
                  {editingProfileName ? (
                    <input
                      data-component="profile-name-input"
                      value={profileNameDraft}
                      onChange={(e) => setProfileNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveProfileRename();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setProfileNameDraft(store?.profiles?.[activeProfileId]?.name ?? "");
                          setEditingProfileName(false);
                        }
                      }}
                      onBlur={() => {
                        setProfileNameDraft(store?.profiles?.[activeProfileId]?.name ?? "");
                        setEditingProfileName(false);
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                      placeholder={t("Name profile...")}
                      autoFocus
                    />
                  ) : (
                    <SelectValue data-component="profile-select-placeholder" placeholder={t("Select a profile...")} />
                  )}
                </SelectTrigger>
                <SelectContent data-component="profile-select-menu" className="bg-slate-900 border-slate-700 text-slate-100">
                  {Object.entries(store?.profiles ?? {}).map(([id, p]) => (
                    <SelectItem data-component="profile-select-option" key={id} value={id} className="hover:bg-slate-800 focus:bg-slate-800">
                      {p.name || id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {editingProfileName ? (
              <div className="mt-0.5 inline-flex h-9 w-[72px] overflow-hidden rounded-full border border-slate-700 bg-slate-800">
                <button
                  type="button"
                  data-component="profile-rename-confirm-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    void saveProfileRename();
                  }}
                  className="flex h-full w-1/2 items-center justify-center bg-emerald-600 text-white hover:bg-emerald-500"
                  aria-label={t("Confirm rename")}
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-component="profile-rename-cancel-button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setProfileNameDraft(store?.profiles?.[activeProfileId]?.name ?? "");
                    setEditingProfileName(false);
                  }}
                  className="flex h-full w-1/2 items-center justify-center bg-red-600 text-white hover:bg-red-500"
                  aria-label={t("Cancel rename")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-component="profile-actions-button"
                    className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-slate-100 hover:bg-slate-600 disabled:opacity-50"
                    aria-label={t("Profile actions")}
                    disabled={!store || !activeProfileId}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-44 border-slate-700 bg-slate-900 text-slate-100"
                >
                  <DropdownMenuItem
                    data-component="profile-rename-start-button"
                    onSelect={(e) => {
                      e.preventDefault();
                      if (!store || !activeProfileId) return;
                      const existing = store.profiles?.[activeProfileId];
                      if (!existing) return;
                      setProfileNameDraft(existing.name ?? "");
                      setEditingProfileName(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    <span>{t("Rename profile")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-component="profile-delete-button"
                    variant="destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      setProfileDeleteConfirmOpen(true);
                    }}
                    disabled={!store || Object.keys(store?.profiles ?? {}).length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{t("Delete profile")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            
            <DropdownMenu open={profileActionsOpen} onOpenChange={setProfileActionsOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-component="profile-add-button"
                  className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                  aria-label={t("Add profile")}
                  disabled={!store || importingSettings}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-52 border-slate-700 bg-slate-900 text-slate-100"
              >
                <DropdownMenuItem
                  data-component="profile-add-menu-item"
                  onSelect={(e) => {
                    e.preventDefault();
                    if (!store) return;
                    setProfileActionsOpen(false);
                    void (async () => {
                      const now = Date.now();
                      const newId = `profile_${now}`;
                      const current = store.profiles?.[activeProfileId];
                      const next: SettingsStore = {
                        ...store,
                        activeProfileId: newId,
                        profiles: {
                          ...(store.profiles ?? {}),
                          [newId]: {
                            name: `Profile ${Object.keys(store.profiles ?? {}).length + 1}`,
                            env: current?.env ?? { AZURE_SPEECH_KEY: "", DEEPL_AUTH_KEY: "", ELEVEN_LABS_SPEECH_KEY: "" },
                            languageOverride: current?.languageOverride ?? "auto",
                            selectedNoteType: current?.selectedNoteType ?? "",
                            databasePath: getInitialDatabasePath(current?.databasePath),
                            mappings: normalizeMappingsRecord(current?.mappings ?? {}),
                          },
                        },
                      };
                      const ok = await saveSettingsStore(next);
                      if (!ok) {
                        toast.error(t("Failed to add profile."));
                        return;
                      }
                      applyHydratedStore(next, newId);
                      void refreshEnvFromBackend();
                      setEditingProfileName(true);
                      setProfileNameDraft(next.profiles[newId].name ?? "");
                      showProfileLoadNotice(next.profiles[newId].name ?? newId);
                      onSettingsApplied?.();
                      toast.success(t("Profile added."));
                    })();
                  }}
                >
                  <Plus className="h-4 w-4" />
                  <span>{t("Add profile")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-component="profile-export-menu-item"
                  onSelect={(e) => {
                    e.preventDefault();
                    openExportDialog();
                  }}
                  disabled={!store || Object.keys(store?.profiles ?? {}).length === 0}
                >
                  <Download className="h-4 w-4" />
                  <span>{t("Export Settings")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-component="profile-import-menu-item"
                  onSelect={(e) => {
                    e.preventDefault();
                    setProfileActionsOpen(false);
                    importSettingsInputRef.current?.click();
                  }}
                  disabled={!store || importingSettings}
                >
                  <Upload className="h-4 w-4" />
                  <span>{t("Import Settings")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={importSettingsInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.currentTarget.value = "";
                if (!file) return;
                void importSettingsFromFile(file).catch((err: any) => {
                  toast.error(err?.message || t("Failed to import settings."));
                });
              }}
            />

            
          </div>
        </DialogHeader>

        <div className="mt-3 grid grid-cols-12 gap-4 flex-1 min-h-0">
          <aside data-component="settings-sidebar" className="col-span-3 flex flex-col rounded-lg border border-slate-700 bg-slate-800/70 p-2 overflow-y-auto">
            {tabItems.map((tab) => (
              <button
                type="button"
                key={tab}
                onClick={() => setActiveTab(tab)}
                data-component="settings-tab-button"
                data-tab={tab}
                className={`mb-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  tab === activeTab
                    ? "bg-blue-600 text-white"
                    : "bg-slate-900/60 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {t(tab)}
              </button>
            ))}
          </aside>

          <section data-component="settings-content" className="col-span-9 rounded-lg border border-slate-700 bg-slate-800/70 overflow-y-auto min-h-0">
            {getContent()}
          </section>
        </div>

        <DialogFooter className="mt-4 flex items-center justify-between gap-2">
          <div className="min-h-[20px] text-sm">
            {profileLoadMessage ? (
              <span
                className={`inline-flex items-center rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200 transition-opacity duration-300 ${
                  profileLoadMessageVisible ? "opacity-100" : "opacity-0"
                }`}
              >
                {profileLoadMessage}
              </span>
            ) : status ? (
              <span className="text-slate-300">{status}</span>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <button data-component="settings-close-button" className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600">
              {t("Close")}
            </button>
          </DialogClose>

          <button
            data-component="settings-save-button"
            onClick={async () => {
              setSaving(true);
              setStatus(null);

              try {
                if (activeTab === "API Keys") {
                  const res = await saveEnv({
                    AZURE_SPEECH_KEY: azureKey,
                    DEEPL_AUTH_KEY: deeplKey,
                    ELEVEN_LABS_SPEECH_KEY: elevenLabsKey,
                  });

                  if (res.ok) {
                    const validations: Promise<APIKeyValidation>[] = [];
                    if (azureKey.trim() && (keysDirty || checkState.AZURE !== "valid")) {
                      validations.push(runValidation("AZURE", azureKey));
                    }
                    if (deeplKey.trim() && (keysDirty || checkState.DEEPL !== "valid")) {
                      validations.push(runValidation("DEEPL", deeplKey));
                    }
                    if (elevenLabsKey.trim() && (keysDirty || checkState.ELEVEN !== "valid")) {
                      validations.push(runValidation("ELEVEN", elevenLabsKey));
                    }
                    if (validations.length) await Promise.all(validations);
                    setKeysDirty(false);
                    if (store && activeProfileId) {
                      setStore((prev) => {
                        if (!prev) return prev;
                        const existing = prev.profiles?.[activeProfileId];
                        if (!existing) return prev;
                        return {
                          ...prev,
                          profiles: {
                            ...prev.profiles,
                            [activeProfileId]: {
                              ...existing,
                              env: {
                                AZURE_SPEECH_KEY: azureKey,
                                DEEPL_AUTH_KEY: deeplKey,
                                ELEVEN_LABS_SPEECH_KEY: elevenLabsKey,
                              },
                            },
                          },
                        };
                      });
                    }
                    onSettingsApplied?.();
                    toast.success(i18n.t("Changes saved"));
                    setStatus(null);
                  } else {
                    setStatus(res.error || "Failed to save");
                    toast.error(t("settings.failedToSaveSeeError"));
                  }
                } else if (activeTab === "Mapping") {
                  if (!store || !activeProfileId) {
                    toast.error(t("No profile loaded."));
                    return;
                  }
                  if (!isDatabasePathValid(databasePath)) {
                    setStatus(t("settings.databasePathRequired"));
                    toast.error(t("settings.databasePathRequired"));
                    return;
                  }
                  const existing = store.profiles?.[activeProfileId];
                  if (!existing) {
                    toast.error(t("Profile not found."));
                    return;
                  }
                  const next: SettingsStore = {
                    ...store,
                    activeProfileId,
                    profiles: {
                      ...store.profiles,
                      [activeProfileId]: {
                        ...existing,
                        mappings: normalizeMappingsRecord(mappings),
                        selectedNoteType,
                        databasePath: databasePath.trim(),
                      },
                    },
                  };
                  const ok = await saveSettingsStore(next);
                  if (ok) {
                    setStore(next);
                    setMappingDirty(false);
                    onSettingsApplied?.();
                    toast.success(i18n.t("Changes saved"));
                    setStatus(null);
                  } else {
                    setStatus("Failed to save profiles.");
                    toast.error(t("settings.failedToSaveSeeError"));
                  }
                } else if (activeTab === "Language") {
                  if (!store || !activeProfileId) {
                    toast.error(t("No profile loaded."));
                    return;
                  }
                  const existing = store.profiles?.[activeProfileId];
                  if (!existing) {
                    toast.error(t("Profile not found."));
                    return;
                  }
                  const next: SettingsStore = {
                    ...store,
                    activeProfileId,
                    profiles: {
                      ...store.profiles,
                      [activeProfileId]: {
                        ...existing,
                        languageOverride,
                      },
                    },
                  };
                  const ok = await saveSettingsStore(next);
                  if (ok) {
                    setStore(next);
                    if (displayLanguageDraft !== displayLanguageSavedRef.current) {
                      await setDisplayLanguage(displayLanguageDraft);
                      displayLanguageSavedRef.current = displayLanguageDraft;
                    }
                    setLanguageDirty(false);
                    onSettingsApplied?.();
                    toast.success(i18n.t("Changes saved"));
                    setStatus(null);
                  } else {
                    setStatus("Failed to save language.");
                    toast.error(t("settings.failedToSaveSeeError"));
                  }
                }
              } catch (err: any) {
                setStatus(err?.message || "Unknown error");
                toast.error(t("settings.failedToSaveSeeError"));
              } finally {
                setSaving(false);
              }
            }}
            disabled={
              saving ||
              (activeTab === "API Keys" && !keysDirty) ||
              (activeTab === "Mapping" && (!mappingDirty || !isDatabasePathValid(databasePath))) ||
              (activeTab === "Language" && !languageDirty) ||
              (activeTab !== "API Keys" && activeTab !== "Mapping" && activeTab !== "Language")
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? t("Saving...") : t("Save")}
          </button>
          </div>
        </DialogFooter>
        <Dialog
          open={exportDialogOpen}
          onOpenChange={(nextOpen) => {
            setExportDialogOpen(nextOpen);
            if (!nextOpen) setProfileActionsOpen(false);
          }}
        >
          <DialogContent className="max-w-lg border border-slate-700 bg-slate-900 text-slate-100">
            <DialogHeader>
              <DialogTitle>{t("Export Profile Settings")}</DialogTitle>
              <DialogDescription>
                {t("Choose which profiles to include in the exported JSON file.")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{t("Profiles")}</span>
                <button
                  type="button"
                  onClick={() => {
                    const allIds = Object.keys(store?.profiles ?? {});
                    setSelectedExportProfileIds((prev) =>
                      prev.length === allIds.length ? [] : allIds
                    );
                  }}
                  className="text-blue-300 hover:text-blue-200"
                >
                  {selectedExportProfileIds.length === Object.keys(store?.profiles ?? {}).length
                    ? t("Clear selection")
                    : t("Select all")}
                </button>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                {Object.entries(store?.profiles ?? {}).map(([id, profile]) => {
                  const checked = selectedExportProfileIds.includes(id);
                  return (
                    <label
                      key={id}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 hover:bg-slate-800"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-100">{profile.name || id}</span>
                        <span className="block truncate text-xs text-slate-400">{id}</span>
                      </span>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          setSelectedExportProfileIds((prev) =>
                            nextChecked
                              ? [...prev, id]
                              : prev.filter((profileId) => profileId !== id)
                          );
                        }}
                        className="border-slate-600 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
            <DialogFooter className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportDialogOpen(false)}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-100 hover:bg-slate-600"
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void exportSelectedProfiles();
                }}
                disabled={exportingSettings || selectedExportProfileIds.length === 0}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {exportingSettings ? t("Exporting...") : t("Export")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog open={profileDeleteConfirmOpen} onOpenChange={setProfileDeleteConfirmOpen}>
          <AlertDialogContent className="border border-slate-700 bg-slate-900 text-slate-100">
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Delete profile?")}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-300">
                {t("This will permanently delete the current profile and its settings.")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700"
              >
                {t("Cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                data-component="profile-delete-confirm-button"
                className="bg-rose-600 text-white hover:bg-rose-500"
                onClick={async (e) => {
                  e.preventDefault();
                  if (!store || !activeProfileId) return;
                  const profileCount = Object.keys(store.profiles ?? {}).length;
                  if (profileCount <= 1) {
                    toast.error(t("At least one profile must remain."));
                    setProfileDeleteConfirmOpen(false);
                    return;
                  }

                  const nextProfiles = { ...(store.profiles ?? {}) };
                  const deletedName = nextProfiles[activeProfileId]?.name ?? activeProfileId;
                  delete nextProfiles[activeProfileId];
                  const nextActiveId = Object.keys(nextProfiles)[0] ?? "";
                  if (!nextActiveId) {
                    toast.error(t("Failed to delete profile."));
                    setProfileDeleteConfirmOpen(false);
                    return;
                  }

                  const next: SettingsStore = {
                    activeProfileId: nextActiveId,
                    profiles: nextProfiles,
                  };

                  const ok = await saveSettingsStore(next);
                  if (!ok) {
                    toast.error(t("Failed to delete profile."));
                    return;
                  }

                  setStore(next);
                  setActiveProfileId(nextActiveId);
                  const profile = next.profiles[nextActiveId];
                  setMappings(normalizeMappingsRecord(profile?.mappings ?? {}));
                  setLanguageOverride(profile?.languageOverride ?? "auto");
                  setSelectedNoteType(profile?.selectedNoteType ?? "");
                  setDatabasePath(getInitialDatabasePath(profile?.databasePath));
                  void refreshEnvFromBackend();
                  setEditingProfileName(false);
                  setProfileNameDraft(profile?.name ?? "");
                  showProfileLoadNotice(profile?.name || nextActiveId);
                  setMappingDirty(false);
                  setKeysDirty(false);
                  setLanguageDirty(false);
                  setProfileDeleteConfirmOpen(false);
                  onSettingsApplied?.();
                  toast.success(t("Profile deleted."), {
                    description: t("settings.profileDeletedDescription", { profileName: deletedName }),
                  });
                }}
              >
                {t("Delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
