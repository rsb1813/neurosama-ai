// JavaScript 언어 모듈을 TypeScript 랜딩 컴포넌트에서 안전하게 사용하는 선언
export type Locale = "en" | "zh-CN" | "ja" | "ko";
export type SectionCopy = { label: string; title: string; body: string };
export type CapabilityCopy = { state: string; title: string; body: string };
export type SiteCopy = {
  language: string;
  nav: [string, string, string];
  hero: { eyebrow: string; title: string; body: string; primary: string; secondary: string };
  sections: [SectionCopy, SectionCopy, SectionCopy, SectionCopy, SectionCopy];
  flow: [string, string, string, string];
  capabilities: [CapabilityCopy, CapabilityCopy, CapabilityCopy, CapabilityCopy];
  stack: [string, string, string];
  actions: [string, string, string];
};
export const LOCALES: Locale[];
export const DEFAULT_LOCALE: Locale;
export const STORAGE_KEY: "neru-locale";
export const COPY: Record<Locale, SiteCopy>;
export function normalizeLocale(value: unknown): Locale;
export function readStoredLocale(storage?: Pick<Storage, "getItem"> | null): Locale;
export function readBrowserLocale(storageProvider: () => Pick<Storage, "getItem"> | null | undefined): Locale;
