<!-- 승인된 Neru 랜딩 페이지를 테스트 우선으로 구현하고 로컬 미리보기까지 검증하는 실행 계획 -->
# Neru Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an English-first, four-locale Neru product landing page in `site/` and leave it as a verified local private preview without deploying it.

**Architecture:** Initialize the bundled Sites vinext starter inside an isolated top-level `site/` directory. Keep the page static except for one client component that owns locale selection, document-language updates, and local-storage persistence; keep locale normalization in a small plain ES module that Node's built-in test runner can exercise without adding a test framework.

**Tech Stack:** Sites vinext starter, Next.js 16, React 19, TypeScript 5.9, CSS, Node `node:test`, npm.

## Global Constraints

- The visual direction is **Arcane Editorial** with the **Character Centerpiece** hero.
- English is the default; complete locales are `en`, `zh-CN`, `ja`, and `ko`.
- Use the real repository-owned `neru-render-airi.png`; do not generate character art.
- The primary CTA is `https://github.com/rsb1813/neurosama-ai`.
- The roadmap CTA is `https://github.com/rsb1813/neurosama-ai/blob/master/ROADMAP.md`.
- Do not add authentication, persistence beyond the locale preference, analytics, uploads, forms, databases, live chat, or unrelated AIRI changes.
- Do not imply that a packaged download, public demo, or production release exists.
- Keep `.openai/hosting.json` with both `d1` and `r2` set to `null`.
- The final deliverable is a local private preview. Do not invoke Sites hosting or create a public URL.
- Every new source file starts with a one-line Korean role comment, directly after a required directive when one exists.
- Every shell command is prefixed with `rtk`.

## File map

- Create `site/` from the bundled Sites vinext starter.
- Modify `site/app/page.tsx` to render the completed landing component.
- Modify `site/app/layout.tsx` to provide Neru metadata and dynamic absolute social-image URLs.
- Modify `site/app/globals.css` to own the complete editorial visual system and responsive behavior.
- Create `site/app/NeruLanding.tsx` for the single client-side locale and page-composition boundary.
- Create `site/app/i18n.mjs` for locale normalization, safe storage access, and four complete copy objects.
- Create `site/app/i18n.d.ts` for the TypeScript contract consumed by `NeruLanding.tsx`.
- Replace `site/tests/rendered-html.test.mjs` with product-level server-rendering checks.
- Create `site/tests/i18n.test.mjs` for locale normalization and storage-failure behavior.
- Copy `neru-render-airi.png` unchanged to `site/public/neru-render-airi.png`.
- Create `site/public/og.png` from one site-specific social-card generation after the page copy and palette are stable.
- Modify root `.gitignore` to exclude the temporary `.superpowers/` visual-companion session.
- Modify root `checklist.md` and `context-notes.md` only to record verified progress and decisions.

---

### Task 1: Initialize the Sites project and replace the disposable starter

**Files:**
- Create: `site/**` from the bundled Sites starter
- Modify: `site/app/page.tsx`
- Modify: `site/app/layout.tsx`
- Modify: `site/package.json`
- Modify: `site/package-lock.json`
- Replace: `site/tests/rendered-html.test.mjs`
- Delete: `site/app/_sites-preview/SkeletonPreview.tsx`
- Delete: `site/app/_sites-preview/preview.css`
- Copy: `neru-render-airi.png` -> `site/public/neru-render-airi.png`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the Sites initializer at `C:/Users/jolib/.codex/plugins/cache/openai-bundled/sites/0.1.30/scripts/init-site.sh`
- Produces: a buildable `site/` project whose root route server-renders Neru metadata and baseline copy

- [ ] **Step 1: Initialize the selected project surface**

Run from the repository root:

```powershell
rtk proxy "C:\Program Files\Git\bin\bash.exe" /c/Users/jolib/.codex/plugins/cache/openai-bundled/sites/0.1.30/scripts/init-site.sh /c/Users/jolib/Documents/neurosama-ai/site
```

Expected: the starter is copied to `site/` and `npm ci` completes. If dependency retrieval fails with a sandbox network error, rerun this exact command with the required network approval rather than changing package versions.

The initializer creates a nested `site/.git`. Resolve and verify that exact path is under `C:\Users\jolib\Documents\neurosama-ai\site`, then remove only that generated nested repository so the root repository owns the site:

```powershell
rtk proxy powershell -NoProfile -Command '$target=(Resolve-Path -LiteralPath "site\.git").Path; if ($target -ne "C:\Users\jolib\Documents\neurosama-ai\site\.git") { throw "Unexpected nested repository path" }; Remove-Item -LiteralPath $target -Recurse -Force'
```

Add this exact ignore entry to the root `.gitignore` with `apply_patch` so the visual-companion session never enters a product commit:

```gitignore
.superpowers/
```

- [ ] **Step 2: Start the starter preview before product edits**

Run `rtk npm run dev` from `site/` in a retained process, capture the exact `Local` URL printed by the server, and open that URL once in Codex. Keep the process running through build validation.

Expected: the starter loading skeleton appears at the printed local URL.

- [ ] **Step 3: Replace the starter test with a failing Neru baseline test**

Replace `site/tests/rendered-html.test.mjs` with:

```js
// Neru 랜딩 페이지의 서버 렌더 결과와 스타터 제거 상태를 검증하는 테스트
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Neru product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Neru — Intelligence, with a stage presence\.<\/title>/i);
  assert.match(html, /Intelligence, with a stage presence\./);
  assert.match(html, /An open character experiment/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("removes the disposable preview and dependency", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
```

- [ ] **Step 4: Run the baseline test and confirm the intended failure**

Run: `rtk npm test` from `site/`.

Expected: FAIL because the starter still renders `Your site is taking shape` and still contains `react-loading-skeleton`.

- [ ] **Step 5: Implement the minimal Neru shell**

Replace `site/app/page.tsx` with:

```tsx
// Neru 랜딩 페이지의 서버 진입점을 제공하는 페이지 컴포넌트
export default function Home() {
  return (
    <main>
      <p>An open character experiment</p>
      <h1>Intelligence, with a stage presence.</h1>
    </main>
  );
}
```

Replace `site/app/layout.tsx` with:

```tsx
// Neru 사이트의 전역 메타데이터와 문서 골격을 제공하는 루트 레이아웃
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neru — Intelligence, with a stage presence.",
  description: "Meet Neru, a local-first open-source AI VTuber with voice, memory, and expression.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Remove `site/app/_sites-preview/`, run `rtk npm uninstall react-loading-skeleton` from `site/`, and copy the existing render without altering the source image:

```powershell
rtk proxy cmd /c copy /Y ..\neru-render-airi.png public\neru-render-airi.png
```

- [ ] **Step 6: Run the baseline test and build**

Run: `rtk npm test` from `site/`.

Expected: PASS for both baseline tests after a successful vinext build.

- [ ] **Step 7: Commit the initialized product shell**

```powershell
rtk git add site
rtk git commit -m "feat(site): initialize Neru landing page"
```

---

### Task 2: Add the four-locale contract and safe preference behavior

**Files:**
- Create: `site/app/i18n.mjs`
- Create: `site/app/i18n.d.ts`
- Create: `site/app/NeruLanding.tsx`
- Create: `site/tests/i18n.test.mjs`
- Modify: `site/app/page.tsx`
- Modify: `site/tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `LOCALES`, `DEFAULT_LOCALE`, `COPY`, `normalizeLocale(value)`, and `readStoredLocale(storage)` from `i18n.mjs`
- Produces: `NeruLanding()` as the page's only client component
- Consumes: browser `localStorage` key `neru-locale`; document root `lang` attribute

- [ ] **Step 1: Write failing locale-domain tests**

Create `site/tests/i18n.test.mjs`:

```js
// Neru 사이트의 언어 정규화와 저장소 실패 폴백을 검증하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import { COPY, DEFAULT_LOCALE, LOCALES, normalizeLocale, readStoredLocale } from "../app/i18n.mjs";

test("defines four complete locales with English as the default", () => {
  assert.deepEqual(LOCALES, ["en", "zh-CN", "ja", "ko"]);
  assert.equal(DEFAULT_LOCALE, "en");
  assert.deepEqual(Object.keys(COPY), LOCALES);
  for (const locale of LOCALES) {
    assert.equal(COPY[locale].hero.title.length > 0, true);
    assert.equal(COPY[locale].sections.length, 5);
    assert.equal(COPY[locale].capabilities.length, 4);
  }
});

test("normalizes missing and invalid locale values to English", () => {
  assert.equal(normalizeLocale(null), "en");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(normalizeLocale("ja"), "ja");
});

test("reads a valid stored locale and survives blocked storage", () => {
  assert.equal(readStoredLocale({ getItem: () => "ko" }), "ko");
  assert.equal(readStoredLocale({ getItem: () => "invalid" }), "en");
  assert.equal(readStoredLocale({ getItem: () => { throw new Error("blocked"); } }), "en");
});
```

- [ ] **Step 2: Run the locale tests and confirm the intended failure**

Run: `rtk node --test tests/i18n.test.mjs` from `site/`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `app/i18n.mjs`.

- [ ] **Step 3: Implement the locale domain with complete copy**

Create `site/app/i18n.mjs`. The exported object must use this exact shape and content; later page markup consumes the arrays rather than duplicating strings:

```js
// Neru 랜딩 페이지의 네 언어 문구와 안전한 언어 선택 규칙을 제공하는 모듈
export const LOCALES = ["en", "zh-CN", "ja", "ko"];
export const DEFAULT_LOCALE = "en";
export const STORAGE_KEY = "neru-locale";

export const COPY = {
  en: {
    language: "Language",
    nav: ["Character", "System", "Contribute"],
    hero: {
      eyebrow: "An open character experiment",
      title: "Intelligence, with a stage presence.",
      body: "Meet Neru, a playful AI witch learning to listen, speak, remember, and grow.",
      primary: "View on GitHub",
      secondary: "See how she works",
    },
    sections: [
      { label: "01 — Meet Neru", title: "A personality, not a prompt.", body: "Warm, witty, and a little cheeky, Neru understands Korean and performs in an English voice with Korean subtitles." },
      { label: "02 — How she comes alive", title: "One conversation. Four living layers.", body: "Korean input flows through a local AI system into English speech, Korean subtitles, and a responsive Live2D presence." },
      { label: "03 — Built in public", title: "A working character, still becoming.", body: "Every capability is built as a real vertical slice, with finished work and open work shown separately." },
      { label: "04 — Under the spell", title: "Local-first by design.", body: "Project AIRI provides the stage while Neru's GPU audio service and local model connection provide her voice and mind." },
      { label: "05 — Join the experiment", title: "Help shape what she becomes.", body: "Follow the code, read the roadmap, or contribute to the next part of Neru's world." },
    ],
    flow: ["Korean input", "Local AI", "English voice + Korean subtitles", "Live2D expression"],
    capabilities: [
      { state: "Verified", title: "English voice", body: "Local Chatterbox speech through the Neru audio gateway." },
      { state: "Verified", title: "Long-term memory", body: "Durable facts can carry across conversations and restarts." },
      { state: "Built", title: "Barge-in", body: "Interrupt handling is merged; final hands-on microphone verification remains." },
      { state: "In progress", title: "Witch expression", body: "The character model and emotion-driven expression system continue to evolve." },
    ],
    stack: ["AIRI desktop stage", "Neru local GPU audio", "Local OpenAI-compatible model"],
    actions: ["GitHub repository", "Read the roadmap", "Open contribution issues"],
  },
  "zh-CN": {
    language: "语言",
    nav: ["角色", "系统", "参与贡献"],
    hero: {
      eyebrow: "一场开放的角色实验",
      title: "拥有舞台感的智能。",
      body: "认识 Neru——一位正在学习倾听、说话、记忆与成长的俏皮 AI 魔女。",
      primary: "在 GitHub 查看",
      secondary: "了解她如何运作",
    },
    sections: [
      { label: "01 — 认识 Neru", title: "不是提示词，而是个性。", body: "温暖、机敏又有一点调皮。Neru 能理解韩语，以英语声音表演，并显示韩语字幕。" },
      { label: "02 — 她如何鲜活起来", title: "一次对话，四个鲜活层次。", body: "韩语输入经过本地 AI 系统，转化为英语语音、韩语字幕与会响应的 Live2D 形象。" },
      { label: "03 — 公开构建", title: "已经能运行，也仍在成长。", body: "每项能力都作为真实的垂直切片构建，已完成与进行中的工作会清楚区分。" },
      { label: "04 — 魔法之下", title: "从设计之初就坚持本地优先。", body: "Project AIRI 提供舞台，Neru 的 GPU 音频服务与本地模型连接则赋予她声音与思维。" },
      { label: "05 — 加入实验", title: "一起塑造她将成为的样子。", body: "关注代码、阅读路线图，或参与构建 Neru 世界的下一部分。" },
    ],
    flow: ["韩语输入", "本地 AI", "英语语音 + 韩语字幕", "Live2D 表情"],
    capabilities: [
      { state: "已验证", title: "英语语音", body: "通过 Neru 音频网关运行的本地 Chatterbox 语音。" },
      { state: "已验证", title: "长期记忆", body: "持久化事实可以跨对话与重启保留。" },
      { state: "已构建", title: "打断响应", body: "打断处理已合并，仍需完成最终的真人麦克风验证。" },
      { state: "开发中", title: "魔女表情", body: "角色模型与情绪驱动的表情系统仍在持续完善。" },
    ],
    stack: ["AIRI 桌面舞台", "Neru 本地 GPU 音频", "本地 OpenAI 兼容模型"],
    actions: ["GitHub 仓库", "阅读路线图", "查看贡献议题"],
  },
  ja: {
    language: "言語",
    nav: ["キャラクター", "システム", "コントリビュート"],
    hero: {
      eyebrow: "オープンなキャラクター実験",
      title: "舞台に立つ、知性。",
      body: "聞き、話し、記憶し、成長することを学ぶ、遊び心のあるAI魔女Neru。",
      primary: "GitHubで見る",
      secondary: "仕組みを見る",
    },
    sections: [
      { label: "01 — Neruとは", title: "プロンプトではなく、人格。", body: "温かく、機知に富み、少し生意気。Neruは韓国語を理解し、英語の声と韓国語字幕で演じます。" },
      { label: "02 — 命が宿る仕組み", title: "ひとつの会話、四つの生きた層。", body: "韓国語入力がローカルAIを通り、英語音声、韓国語字幕、反応するLive2D表現へつながります。" },
      { label: "03 — オープンに開発", title: "動いていて、まだ成長中。", body: "すべての能力を実際に動く垂直スライスとして作り、完成済みと進行中を明確に示します。" },
      { label: "04 — 魔法の内側", title: "設計からローカルファースト。", body: "Project AIRIが舞台を、NeruのGPU音声サービスとローカルモデル接続が声と知性を担います。" },
      { label: "05 — 実験に参加", title: "彼女の未来を一緒につくる。", body: "コードを追い、ロードマップを読み、Neruの世界の次の一歩に貢献できます。" },
    ],
    flow: ["韓国語入力", "ローカルAI", "英語音声 + 韓国語字幕", "Live2D表現"],
    capabilities: [
      { state: "検証済み", title: "英語音声", body: "Neru音声ゲートウェイを通じたローカルChatterbox音声。" },
      { state: "検証済み", title: "長期記憶", body: "会話や再起動をまたいで事実を保持できます。" },
      { state: "実装済み", title: "割り込み", body: "割り込み処理はマージ済みで、最終的な実機マイク検証が残っています。" },
      { state: "開発中", title: "魔女の表情", body: "キャラクターモデルと感情連動の表情システムは進化を続けています。" },
    ],
    stack: ["AIRIデスクトップステージ", "NeruローカルGPU音声", "ローカルOpenAI互換モデル"],
    actions: ["GitHubリポジトリ", "ロードマップを読む", "コントリビュートIssueを見る"],
  },
  ko: {
    language: "언어",
    nav: ["캐릭터", "시스템", "기여하기"],
    hero: {
      eyebrow: "열린 캐릭터 실험",
      title: "무대 위에 선 지능.",
      body: "듣고, 말하고, 기억하고, 성장하는 법을 배우는 장난기 많은 AI 마녀 Neru를 만나보세요.",
      primary: "GitHub에서 보기",
      secondary: "작동 방식 보기",
    },
    sections: [
      { label: "01 — Neru를 만나다", title: "프롬프트가 아닌, 하나의 성격.", body: "따뜻하고 재치 있으며 조금은 짓궂습니다. Neru는 한국어를 이해하고 영어 음성과 한국어 자막으로 연기합니다." },
      { label: "02 — 살아나는 방식", title: "하나의 대화, 네 개의 살아 있는 층.", body: "한국어 입력이 로컬 AI를 거쳐 영어 음성, 한국어 자막, 반응하는 Live2D 표현으로 이어집니다." },
      { label: "03 — 공개적으로 만들기", title: "이미 작동하지만, 계속 성장하는 캐릭터.", body: "각 기능을 실제로 동작하는 수직 슬라이스로 만들고 완료된 작업과 진행 중인 작업을 명확히 나눕니다." },
      { label: "04 — 마법의 안쪽", title: "처음부터 로컬 우선.", body: "Project AIRI가 무대를 맡고 Neru의 GPU 음성 서비스와 로컬 모델 연결이 목소리와 사고를 담당합니다." },
      { label: "05 — 실험에 참여하기", title: "Neru가 될 모습을 함께 만들어 주세요.", body: "코드를 살펴보고, 로드맵을 읽거나, Neru 세계의 다음 단계를 만드는 데 기여할 수 있습니다." },
    ],
    flow: ["한국어 입력", "로컬 AI", "영어 음성 + 한국어 자막", "Live2D 표현"],
    capabilities: [
      { state: "검증됨", title: "영어 음성", body: "Neru 음성 게이트웨이를 통한 로컬 Chatterbox 음성입니다." },
      { state: "검증됨", title: "장기 기억", body: "대화와 앱 재시작을 넘어 사실을 기억할 수 있습니다." },
      { state: "구현됨", title: "끼어들기", body: "중단 처리는 병합됐으며 최종 실사용 마이크 검증이 남아 있습니다." },
      { state: "진행 중", title: "마녀 표정", body: "캐릭터 모델과 감정 기반 표정 시스템은 계속 발전하고 있습니다." },
    ],
    stack: ["AIRI 데스크톱 스테이지", "Neru 로컬 GPU 음성", "로컬 OpenAI 호환 모델"],
    actions: ["GitHub 저장소", "로드맵 읽기", "기여 이슈 보기"],
  },
};

export function normalizeLocale(value) {
  return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

export function readStoredLocale(storage) {
  try {
    return normalizeLocale(storage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}
```

Create `site/app/i18n.d.ts` with a focused contract matching that shape:

```ts
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
```

- [ ] **Step 4: Run locale tests**

Run: `rtk node --test tests/i18n.test.mjs` from `site/`.

Expected: PASS for all three locale-domain tests.

- [ ] **Step 5: Add the client locale boundary**

Create `site/app/NeruLanding.tsx` initially with the language control and hero. The complete page sections are added in Task 3.

```tsx
"use client";
// Neru 페이지의 언어 선택과 사용자 상호작용을 관리하는 클라이언트 컴포넌트
import { useEffect, useState } from "react";
import { COPY, DEFAULT_LOCALE, LOCALES, STORAGE_KEY, readStoredLocale, type Locale } from "./i18n.mjs";

const GITHUB_URL = "https://github.com/rsb1813/neurosama-ai";

export function NeruLanding() {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const copy = COPY[locale];

  useEffect(() => {
    const storedLocale = readStoredLocale(window.localStorage);
    setLocale(storedLocale);
    document.documentElement.lang = storedLocale;
  }, []);

  function selectLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    try { window.localStorage.setItem(STORAGE_KEY, nextLocale); } catch { /* English and in-memory selection remain usable. */ }
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
```

Replace `site/app/page.tsx` with:

```tsx
// Neru 랜딩 페이지의 서버 진입점을 제공하는 페이지 컴포넌트
import { NeruLanding } from "./NeruLanding";

export default function Home() {
  return <NeruLanding />;
}
```

Extend the server-render test with assertions for `Language`, all four option values, and the English hero. Run `rtk npm test` and expect all tests to pass.

- [ ] **Step 6: Commit locale behavior**

```powershell
rtk git add site/app/i18n.mjs site/app/i18n.d.ts site/app/NeruLanding.tsx site/app/page.tsx site/tests
rtk git commit -m "feat(site): add Neru multilingual content"
```

---

### Task 3: Build the Arcane Editorial landing page

**Files:**
- Modify: `site/app/NeruLanding.tsx`
- Replace: `site/app/globals.css`
- Modify: `site/tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: the exact `SiteCopy` arrays from Task 2
- Produces: semantic anchors `#character`, `#system`, `#progress`, `#stack`, and `#contribute`
- Produces: external actions for the repository, roadmap, and contribution issues

- [ ] **Step 1: Add failing product-structure assertions**

Extend the first test in `site/tests/rendered-html.test.mjs` with:

```js
assert.match(html, /A personality, not a prompt\./);
assert.match(html, /One conversation\. Four living layers\./);
assert.match(html, /A working character, still becoming\./);
assert.match(html, /Local-first by design\./);
assert.match(html, /Help shape what she becomes\./);
assert.match(html, /Korean input/);
assert.match(html, /Long-term memory/);
assert.match(html, /In progress/);
assert.match(html, /https:\/\/github\.com\/rsb1813\/neurosama-ai/);
assert.match(html, /https:\/\/github\.com\/rsb1813\/neurosama-ai\/blob\/master\/ROADMAP\.md/);
assert.match(html, /src="\/neru-render-airi\.png"/);
assert.doesNotMatch(html, /download|waitlist|public demo/i);
```

Run: `rtk npm test` from `site/`.

Expected: FAIL because the five complete sections, status ledger, real image, and roadmap link are not yet rendered.

- [ ] **Step 2: Complete the semantic page composition**

Expand `NeruLanding.tsx` while preserving the locale logic from Task 2. Use native elements and these exact destinations:

```tsx
import Image from "next/image";

const GITHUB_URL = "https://github.com/rsb1813/neurosama-ai";
const ROADMAP_URL = `${GITHUB_URL}/blob/master/ROADMAP.md`;
const ISSUES_URL = `${GITHUB_URL}/issues`;
```

The returned tree must contain:

```tsx
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
        <option value="en">EN</option><option value="zh-CN">中文</option><option value="ja">日本語</option><option value="ko">한국어</option>
      </select>
    </label>
  </header>
  <main>
    <section className="hero" id="character">
      <div className="hero-copy"><p className="eyebrow">{copy.hero.eyebrow}</p><h1>{copy.hero.title}</h1><p className="lede">{copy.hero.body}</p><div className="actions"><a className="button primary" href={GITHUB_URL}>{copy.hero.primary}</a><a className="button secondary" href="#system">{copy.hero.secondary}</a></div></div>
      <figure className="hero-figure"><div className="hero-crop"><Image src="/neru-render-airi.png" width={2560} height={1440} priority unoptimized alt="Neru's witch Live2D character model" /></div><figcaption>CHARACTER STUDY / 001</figcaption></figure>
      <p className="folio">NERU — ISSUE 01</p>
    </section>
    <section className="editorial-section meet"><p className="section-label">{copy.sections[0].label}</p><div><h2>{copy.sections[0].title}</h2><p>{copy.sections[0].body}</p></div></section>
    <section className="editorial-section flow-section" id="system"><p className="section-label">{copy.sections[1].label}</p><div><h2>{copy.sections[1].title}</h2><p>{copy.sections[1].body}</p><ol className="flow">{copy.flow.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ol></div></section>
    <section className="editorial-section progress-section" id="progress"><p className="section-label">{copy.sections[2].label}</p><div><h2>{copy.sections[2].title}</h2><p>{copy.sections[2].body}</p><div className="capabilities">{copy.capabilities.map((item) => <article key={item.title}><p className="status">{item.state}</p><h3>{item.title}</h3><p>{item.body}</p></article>)}</div></div></section>
    <section className="editorial-section stack-section" id="stack"><p className="section-label">{copy.sections[3].label}</p><div><h2>{copy.sections[3].title}</h2><p>{copy.sections[3].body}</p><ol className="stack">{copy.stack.map((item, index) => <li key={item}><span>{index + 1}</span>{item}</li>)}</ol></div></section>
    <section className="join" id="contribute"><p className="section-label">{copy.sections[4].label}</p><h2>{copy.sections[4].title}</h2><p>{copy.sections[4].body}</p><div className="join-links"><a href={GITHUB_URL}>{copy.actions[0]}</a><a href={ROADMAP_URL}>{copy.actions[1]}</a><a href={ISSUES_URL}>{copy.actions[2]}</a></div></section>
  </main>
  <footer><span>NERU / OPEN CHARACTER EXPERIMENT</span><span>EN · 中文 · 日本語 · 한국어</span></footer>
</>
```

- [ ] **Step 3: Implement the complete editorial stylesheet**

Replace `site/app/globals.css` with a single stylesheet that defines these exact foundations and applies them consistently to the classes above:

```css
/* Neru 랜딩 페이지의 아케인 에디토리얼 시각 체계와 반응형 레이아웃 */
@import "tailwindcss";

:root { --paper:#e9e0d1; --paper-light:#f7f1e7; --ink:#251f1a; --muted:#6c5f54; --rule:#b9aa98; --brick:#8b5138; --violet:#6551a5; }
* { box-sizing:border-box; }
html { scroll-behavior:smooth; background:var(--paper); }
body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter,"Noto Sans CJK SC","Noto Sans JP","Noto Sans KR",system-ui,sans-serif; }
a { color:inherit; text-decoration:none; }
a:focus-visible, select:focus-visible { outline:3px solid var(--violet); outline-offset:4px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.masthead { position:sticky; z-index:20; top:0; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; min-height:72px; padding:0 4vw; border-bottom:1px solid var(--rule); background:rgba(233,224,209,.94); backdrop-filter:blur(12px); }
.wordmark { font-size:.78rem; font-weight:800; letter-spacing:.12em; }
.masthead nav { display:flex; gap:2rem; font-size:.72rem; letter-spacing:.1em; text-transform:uppercase; }
.locale-control { justify-self:end; }
.locale-control select { border:0; border-bottom:1px solid var(--ink); border-radius:0; background:transparent; color:var(--ink); font-family:inherit; font-size:.75rem; font-weight:700; line-height:1; }
.hero { position:relative; display:grid; grid-template-columns:minmax(18rem,.8fr) minmax(22rem,1.2fr); min-height:calc(100vh - 72px); overflow:hidden; border-bottom:1px solid var(--rule); }
.hero-copy { z-index:3; align-self:center; padding:7vw 3vw 8vw 8vw; }
.eyebrow,.section-label,.folio,figcaption { color:var(--brick); font-size:.68rem; font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
h1,h2 { font-family:"Iowan Old Style","Palatino Linotype","Book Antiqua","Noto Serif CJK SC","Noto Serif JP","Noto Serif KR",serif; font-weight:500; letter-spacing:-.055em; }
h1 { max-width:10ch; margin:.7rem 0 1.25rem; font-size:clamp(3.5rem,7vw,7.5rem); line-height:.88; }
h2 { max-width:13ch; margin:0 0 1.25rem; font-size:clamp(2.5rem,5vw,5.3rem); line-height:.95; }
.lede,.editorial-section>div>p,.join>p { max-width:42rem; color:var(--muted); font-size:clamp(1rem,1.35vw,1.3rem); line-height:1.7; }
.actions { display:flex; flex-wrap:wrap; gap:.75rem; margin-top:2rem; }
.button { display:inline-flex; min-height:46px; align-items:center; padding:.8rem 1.1rem; border:1px solid var(--ink); font-size:.78rem; font-weight:800; letter-spacing:.06em; }
.button.primary { background:var(--ink); color:var(--paper-light); }
.hero-figure { position:relative; min-width:0; margin:0; }
.hero-crop { position:absolute; inset:2rem 0 0; overflow:hidden; }
.hero-crop img { position:absolute; width:clamp(2500px,205vw,3900px); max-width:none; top:0; left:clamp(-310px,-12vw,-140px); }
.hero-figure figcaption { position:absolute; right:2rem; bottom:2rem; writing-mode:vertical-rl; }
.folio { position:absolute; left:2rem; bottom:1.4rem; }
.editorial-section { display:grid; grid-template-columns:minmax(9rem,.28fr) minmax(0,1fr); gap:5vw; padding:9rem 8vw; border-bottom:1px solid var(--rule); }
.section-label { padding-top:.75rem; }
.flow,.stack { display:grid; gap:0; margin:4rem 0 0; padding:0; list-style:none; border-top:1px solid var(--ink); }
.flow li,.stack li { display:grid; grid-template-columns:4rem 1fr; align-items:center; min-height:84px; border-bottom:1px solid var(--rule); font:500 clamp(1.1rem,2vw,1.8rem)/1.2 "Iowan Old Style",serif; }
.flow li span,.stack li span { color:var(--brick); font:700 .72rem/1 ui-monospace,monospace; }
.capabilities { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); margin-top:4rem; border-top:1px solid var(--ink); border-left:1px solid var(--rule); }
.capabilities article { min-height:220px; padding:2rem; border-right:1px solid var(--rule); border-bottom:1px solid var(--rule); }
.capabilities h3 { margin:2.5rem 0 .7rem; font:500 clamp(1.4rem,2.2vw,2.2rem)/1 "Iowan Old Style",serif; }
.capabilities article>p:last-child { color:var(--muted); line-height:1.55; }
.status { color:var(--brick); font-size:.7rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
.join { padding:11rem 8vw; background:var(--ink); color:var(--paper-light); }
.join .section-label { color:#c58b70; }
.join>p { color:#cfc2b4; }
.join-links { display:flex; flex-wrap:wrap; gap:1rem 2.5rem; margin-top:3rem; }
.join-links a { border-bottom:1px solid currentColor; padding-bottom:.25rem; font-weight:700; }
footer { display:flex; justify-content:space-between; gap:2rem; padding:2rem 4vw; background:var(--ink); color:#a99b8e; font-size:.65rem; letter-spacing:.12em; }
@media(max-width:800px){.masthead{grid-template-columns:1fr auto}.masthead nav{display:none}.hero{grid-template-columns:1fr;min-height:auto}.hero-figure{grid-row:1;min-height:58vh}.hero-copy{grid-row:2;padding:4rem 6vw 6rem}.hero-crop img{width:2850px;left:-205px}.folio{display:none}.editorial-section{grid-template-columns:1fr;padding:6rem 6vw}.capabilities{grid-template-columns:1fr}.join{padding:7rem 6vw}footer{flex-direction:column}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
```

- [ ] **Step 4: Run product tests, type/build validation, and lint**

Run from `site/`:

```powershell
rtk npm test
rtk npm run lint
```

Expected: the build completes, all Node tests pass, and ESLint reports no errors.

- [ ] **Step 5: Commit the complete page**

```powershell
rtk git add site/app site/tests site/public/neru-render-airi.png
rtk git commit -m "feat(site): build Neru editorial landing page"
```

---

### Task 4: Add social metadata and finish the private preview

**Files:**
- Create: `site/public/og.png`
- Modify: `site/app/layout.tsx`
- Modify: `site/tests/rendered-html.test.mjs`
- Modify: `checklist.md`
- Modify: `context-notes.md`

**Interfaces:**
- Consumes: stable hero copy, palette, and editorial motif from Task 3
- Produces: absolute host-derived Open Graph and X image metadata
- Produces: a verified local private preview with no hosting action

- [ ] **Step 1: Write failing social-metadata assertions**

Add to `site/tests/rendered-html.test.mjs`:

```js
test("publishes site-specific social metadata from the request host", async () => {
  const html = await (await render()).text();
  assert.match(html, /<meta(?=[^>]*property="og:title")(?=[^>]*content="Neru — Intelligence, with a stage presence\.")[^>]*>/i);
  assert.match(html, /<meta(?=[^>]*property="og:image")(?=[^>]*content="http:\/\/localhost\/og\.png")[^>]*>/i);
  assert.match(html, /<meta(?=[^>]*name="twitter:card")(?=[^>]*content="summary_large_image")[^>]*>/i);
  await access(new URL("../public/og.png", import.meta.url));
});
```

Run: `rtk npm test` from `site/`.

Expected: FAIL because `og.png` and the absolute Open Graph metadata do not exist.

- [ ] **Step 2: Generate exactly one site-specific social card**

Use the image generation skill once with this exact creative brief:

```text
Create a complete 1200x630 social preview card for Neru, matching a human-authored independent editorial magazine. Warm ivory paper, near-black brown ink, muted brick-red rule lines, and one restrained violet accent. Large elegant serif headline: “Intelligence, with a stage presence.” Small masthead: “NERU / AI VTUBER”. Small footer: “VOICE · MEMORY · EXPRESSION”. Strong negative space, fine print-registration details, no character illustration, no neon, no glassmorphism, no gradients, no mock browser frame, no watermark, and no extra text.
```

Inspect the result. Retry once only if required text is incorrect or missing. Save the accepted image as `site/public/og.png`. If neither result has correct text, omit `og:image`, remove the image assertion, and do not ship an unusable fallback.

- [ ] **Step 3: Add host-derived metadata**

Replace the metadata export in `site/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "Neru — Intelligence, with a stage presence.";
const description = "Meet Neru, a local-first open-source AI VTuber with voice, memory, and expression.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return { title, description, openGraph: { title, description, type: "website", images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}
```

Keep the existing `RootLayout` body unchanged.

- [ ] **Step 4: Run final automated verification**

Run from `site/`:

```powershell
rtk npm test
rtk npm run lint
```

Expected: production build succeeds, all rendering and locale tests pass, and ESLint reports no errors.

Run from the repository root:

```powershell
rtk git diff --check
rtk git status --short
```

Expected: no whitespace errors; only intended site and progress-document changes are present, while pre-existing `.pnpm-store/` remains untouched.

- [ ] **Step 5: Review the final diff and local preview**

Confirm every changed line maps to the approved design, no debug code or unused starter imports remain, and `site/app/_sites-preview` plus `react-loading-skeleton` are absent. Keep the retained development server alive and provide its exact local URL as the private preview.

Do not call `sites-hosting`, `package-site.sh`, a deployment command, or any API that creates a hosted URL.

- [ ] **Step 6: Record verified progress and commit**

Mark the corresponding landing-page items in root `checklist.md` only after their checks pass. Append the final preview and validation facts to `context-notes.md` without overwriting earlier decisions.

```powershell
rtk git add site checklist.md context-notes.md
rtk git commit -m "feat(site): finalize Neru private preview"
```

## Final self-review checklist

- [x] Every requirement in `docs/superpowers/specs/2026-07-19-neru-landing-page-design.md` maps to a task above.
- [x] `Locale`, `SiteCopy`, locale IDs, storage key, anchors, and external URLs are identical across tasks.
- [x] No unspecified backend, database, authentication, analytics, form, download, or public-demo behavior is introduced.
- [x] The actual Neru image is unchanged and any social image does not invent character art.
- [x] The final action returns a local URL only and performs no deployment.
