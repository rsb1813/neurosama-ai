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
