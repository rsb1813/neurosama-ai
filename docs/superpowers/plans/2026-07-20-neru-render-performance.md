# Neru 데스크톱 렌더 성능 개선 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 개발 앱의 불필요한 DevTools 렌더러를 제거하고, Neru Live2D의 기본 렌더 부하를 사용자 선택을 보존하면서 낮춘다.

**Architecture:** Codex OAuth 설정 경로는 요청 시에만 동작하므로 변경하지 않는다. 메인 창의 DevTools는 명시적 디버그 환경 변수에서만 열고, Neru 프리시드에서 아직 조정하지 않은 AIRI 기본 Live2D 값 `0 FPS 제한·2배 스케일`만 `30 FPS·1배 스케일`로 1회 마이그레이션한다.

**Tech Stack:** Electron, TypeScript, Vue localStorage 프리시드, Vitest.

## 전역 제약

- 기존 사용자가 직접 선택한 Live2D FPS와 렌더 스케일은 덮어쓰지 않는다.
- 성능 프리시드는 별도 센티넬로 한 번만 실행한다.
- `MAIN_APP_DEBUG` 또는 `APP_DEBUG`를 명시하면 DevTools를 계속 열 수 있다.
- Codex 모델 목록과 실행 설정 계약은 변경하지 않는다.

---

### Task 1: DevTools 명시적 실행 정책

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/windows/main/devtools-policy.ts`
- Create: `airi/apps/stage-tamagotchi/src/main/windows/main/devtools-policy.test.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/windows/main/index.ts`

**Interfaces:**
- Produces: `shouldOpenMainDevtools(env): boolean`.

- [x] **Step 1: 기본 개발 환경에서는 false이고 명시적 플래그에서는 true인 실패 테스트 작성**
- [x] **Step 2: 테스트가 정책 함수 부재로 실패하는지 확인**
- [x] **Step 3: 순수 정책 함수를 구현하고 메인 창에서 사용**
- [x] **Step 4: 집중 테스트와 ESLint 통과 확인**

---

### Task 2: Neru Live2D 성능 프리시드

**Files:**
- Modify: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`
- Modify: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.test.ts`

**Interfaces:**
- Consumes: `settings/live2d/max-fps`, `settings/live2d/render-scale`.
- Produces: `neru/live2d-performance-seeded` 센티넬과 기본 `30 FPS·1배 스케일`.

- [x] **Step 1: 신규·레거시 기본값은 최적화하고 사용자 지정값은 보존하는 실패 테스트 작성**
- [x] **Step 2: 테스트가 현재 프리시드에 성능 정책이 없어 실패하는지 확인**
- [x] **Step 3: 센티넬과 알려진 AIRI 기본값에만 적용되는 최소 마이그레이션 구현**
- [x] **Step 4: 집중 테스트, 전체 관련 테스트, 타입 검사 통과 확인**
- [x] **Step 5: 앱을 재시작하고 메인 렌더러 CPU·메모리 전후 측정**

측정 결과: 변경 전 4초 동안 메인 렌더러 CPU 시간이 5.94초 증가했고, 변경 후 4.06초 동안 2.52초 증가했다. 동일 프로세스 기준 지속 CPU 점유가 약 58% 감소했으며 자동 DevTools 렌더러 약 231MB도 제거됐다.
