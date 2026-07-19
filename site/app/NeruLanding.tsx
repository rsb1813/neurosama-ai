"use client";
// Neru 페이지의 언어 선택과 사용자 상호작용을 관리하는 클라이언트 컴포넌트
import Image from "next/image";
import { startTransition, useEffect, useState } from "react";
import { COPY, DEFAULT_LOCALE, STORAGE_KEY, readBrowserLocale, type Locale } from "./i18n.mjs";

const GITHUB_URL = "https://github.com/rsb1813/neurosama-ai";
const ROADMAP_URL = `${GITHUB_URL}/blob/master/ROADMAP.md`;
const ISSUES_URL = `${GITHUB_URL}/issues`;

export function NeruLanding() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const copy = COPY[locale];

  useEffect(() => {
    const storedLocale = readBrowserLocale(() => window.localStorage);
    startTransition(() => setLocale(storedLocale));
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
    <>
      <header className="masthead">
        <a className="wordmark" href="#character" aria-label="Neru home">NERU / AI VTUBER</a>
        <nav aria-label="Primary navigation">
          <a href="#character">{copy.nav[0]}</a>
          <a href="#system">{copy.nav[1]}</a>
          <a href="#contribute">{copy.nav[2]}</a>
        </nav>
        <label className="locale-control">
          <span className="sr-only">{copy.language}</span>
          <select aria-label={copy.language} value={locale} onChange={(event) => selectLocale(event.target.value as Locale)}>
            <option value="en">EN</option>
            <option value="zh-CN">中文</option>
            <option value="ja">日本語</option>
            <option value="ko">한국어</option>
          </select>
        </label>
      </header>
      <main>
        <section className="hero" id="character">
          <div className="hero-copy">
            <p className="eyebrow">{copy.hero.eyebrow}</p>
            <h1>{copy.hero.title}</h1>
            <p className="lede">{copy.hero.body}</p>
            <div className="actions">
              <a className="button primary" href={GITHUB_URL}>{copy.hero.primary}</a>
              <a className="button secondary" href="#system">{copy.hero.secondary}</a>
            </div>
          </div>
          <figure className="hero-figure">
            <div className="hero-crop">
              <Image src="/neru-render-airi.png" width={2560} height={1440} priority unoptimized alt="Neru's witch Live2D character model" />
            </div>
            <figcaption>CHARACTER STUDY / 001</figcaption>
          </figure>
          <p className="folio">NERU — ISSUE 01</p>
        </section>
        <section className="editorial-section meet">
          <p className="section-label">{copy.sections[0].label}</p>
          <div>
            <h2>{copy.sections[0].title}</h2>
            <p>{copy.sections[0].body}</p>
          </div>
        </section>
        <section className="editorial-section flow-section" id="system">
          <p className="section-label">{copy.sections[1].label}</p>
          <div>
            <h2>{copy.sections[1].title}</h2>
            <p>{copy.sections[1].body}</p>
            <ol className="flow">
              {copy.flow.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}
            </ol>
          </div>
        </section>
        <section className="editorial-section progress-section" id="progress">
          <p className="section-label">{copy.sections[2].label}</p>
          <div>
            <h2>{copy.sections[2].title}</h2>
            <p>{copy.sections[2].body}</p>
            <div className="capabilities">
              {copy.capabilities.map((item) => <article key={item.title}><p className="status">{item.state}</p><h3>{item.title}</h3><p>{item.body}</p></article>)}
            </div>
          </div>
        </section>
        <section className="editorial-section stack-section" id="stack">
          <p className="section-label">{copy.sections[3].label}</p>
          <div>
            <h2>{copy.sections[3].title}</h2>
            <p>{copy.sections[3].body}</p>
            <ol className="stack">
              {copy.stack.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}
            </ol>
          </div>
        </section>
        <section className="join" id="contribute">
          <p className="section-label">{copy.sections[4].label}</p>
          <h2>{copy.sections[4].title}</h2>
          <p>{copy.sections[4].body}</p>
          <div className="join-links">
            <a href={GITHUB_URL}>{copy.actions[0]}</a>
            <a href={ROADMAP_URL}>{copy.actions[1]}</a>
            <a href={ISSUES_URL}>{copy.actions[2]}</a>
          </div>
        </section>
      </main>
      <footer><span>NERU / OPEN CHARACTER EXPERIMENT</span><span>EN · 中文 · 日本語 · 한국어</span></footer>
    </>
  );
}
