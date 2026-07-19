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
  assert.match(html, /Language/);
  assert.match(html, /<option value="en"[^>]*>EN<\/option>/);
  assert.match(html, /<option value="zh-CN">中文<\/option>/);
  assert.match(html, /<option value="ja">日本語<\/option>/);
  assert.match(html, /<option value="ko">한국어<\/option>/);
  assert.match(html, /Intelligence, with a stage presence\./);
  assert.match(html, /An open character experiment/);
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
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("publishes site-specific social metadata from the request host", async () => {
  const html = await (await render()).text();
  assert.match(html, /<meta(?=[^>]*property="og:title")(?=[^>]*content="Neru — Intelligence, with a stage presence\.")[^>]*>/i);
  assert.match(html, /<meta(?=[^>]*property="og:image")(?=[^>]*content="http:\/\/localhost\/og\.png")[^>]*>/i);
  assert.match(html, /<meta(?=[^>]*name="twitter:card")(?=[^>]*content="summary_large_image")[^>]*>/i);
  await access(new URL("../public/og.png", import.meta.url));
});

test("removes the disposable preview and dependency", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});

test("removes unused authentication and database starter files", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /drizzle-orm|drizzle-kit|db:generate/);

  await Promise.all([
    "../app/chatgpt-auth.ts",
    "../db",
    "../examples",
    "../drizzle",
    "../drizzle.config.ts",
  ].map((path) => assert.rejects(access(new URL(path, import.meta.url)))));
});

test("runs every test suite from the default test command", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.test, /node --test tests\/\*\.test\.mjs/);
});

test("keeps a light-paper focus outline in the dark join section", async () => {
  const stylesheet = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(stylesheet, /\.join a:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--paper-light\)/s);
});

test("documents the local-only Neru landing workflow", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /local-only private preview/i);
  assert.match(readme, /npm run (dev|test|lint|build)/);
  assert.doesNotMatch(readme, /auth|D1|Drizzle|db:generate/i);
});

test("does not package the removed optional Drizzle directory", async () => {
  const plugin = await readFile(new URL("../build/sites-vite-plugin.ts", import.meta.url), "utf8");
  assert.doesNotMatch(plugin, /drizzle|access\(|\bcp\(/i);
});
