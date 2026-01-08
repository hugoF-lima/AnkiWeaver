// src/env.d.ts
interface ImportMetaEnv {
  readonly VITE_ANKI_DECK?: string;
  readonly DEV?: boolean;
  readonly PROD?: boolean;
  readonly MODE?: 'development' | 'production' | 'test' | string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}