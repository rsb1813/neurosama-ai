// 메인 창 DevTools를 명시적인 디버그 환경에서만 여는 정책을 정의한다.
export function shouldOpenMainDevtools(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env.MAIN_APP_DEBUG || env.APP_DEBUG)
}
