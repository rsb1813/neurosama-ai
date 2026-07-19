"use client";
// Neru 페이지의 언어 선택과 사용자 상호작용을 관리하는 클라이언트 컴포넌트
import { useEffect, useState } from "react";
import { COPY, DEFAULT_LOCALE, LOCALES, STORAGE_KEY, readBrowserLocale, type Locale } from "./i18n.mjs";

const GITHUB_URL = "https://github.com/rsb1813/neurosama-ai";

export function NeruLanding() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const copy = COPY[locale];

  useEffect(() => {
    const storedLocale = readBrowserLocale(() => window.localStorage);
    setLocale(storedLocale);
    document.documentElement.lang = storedLocale;
  }, []);

  function selectLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {
      // English and in-memory selection remain usable.
    }
  }

  return (
    <main>
      <label>
        <span>{copy.language}</span>
        <select value={locale} onChange={(event) => selectLocale(event.target.value as Locale)}>
          {LOCALES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <section id="character">
        <p>{copy.hero.eyebrow}</p>
        <h1>{copy.hero.title}</h1>
        <p>{copy.hero.body}</p>
        <a href={GITHUB_URL}>{copy.hero.primary}</a>
        <a href="#system">{copy.hero.secondary}</a>
      </section>
    </main>
  );
}
