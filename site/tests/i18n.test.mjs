// Neru 사이트의 언어 정규화와 저장소 실패 폴백을 검증하는 테스트
import assert from "node:assert/strict";
import test from "node:test";
import { COPY, DEFAULT_LOCALE, LOCALES, normalizeLocale, readBrowserLocale, readStoredLocale } from "../app/i18n.mjs";

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

test("defines localized accessible labels for every locale", () => {
  assert.deepEqual(COPY.en.a11y, {
    homeLabel: "Neru home",
    primaryNavigation: "Primary navigation",
    characterImageAlt: "Neru's witch Live2D character model",
  });

  for (const locale of LOCALES) {
    for (const label of Object.values(COPY[locale].a11y ?? {})) {
      assert.equal(typeof label, "string");
      assert.equal(label.trim().length > 0, true);
    }
    assert.equal(Object.keys(COPY[locale].a11y ?? {}).length, 3);
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

test("survives a browser storage accessor that throws", () => {
  const browser = {};
  Object.defineProperty(browser, "localStorage", {
    get() {
      throw new Error("blocked");
    },
  });

  assert.equal(readBrowserLocale(() => browser.localStorage), "en");
});
