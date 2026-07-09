// neru-audio 게이트웨이(Python)를 앱 실행 시 spawn하고 종료 시 kill하는 매니저
import type { ChildProcess } from 'node:child_process'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { is } from '@electron-toolkit/utils'
import { app } from 'electron'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

const HEALTH_URL = 'http://127.0.0.1:3457/v1/models'

// app.getAppPath()(=apps/stage-tamagotchi, dev)에서 위로 올라가며 pnpm-workspace.yaml이
// 있는 airi 루트를 찾는다. ESM/CJS 모듈 형식에 무관(import.meta·__dirname 미사용).
function findWorkspaceRoot(): string {
  let dir = app.getAppPath()
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')))
      return dir
    dir = dirname(dir)
  }
  throw new Error('[neru-audio] pnpm-workspace.yaml을 찾지 못했습니다')
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL)
      if (res.ok)
        return true
    }
    catch {
      // 아직 기동 전 — 재시도
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function createNeruAudioManager() {
  let child: ChildProcess | undefined

  async function start(): Promise<void> {
    if (!is.dev) {
      // 패키지 배포에서의 Python 번들링은 후속 스펙. dev(uv)에서만 자동 기동.
      console.warn('[neru-audio] packaged 모드 자동 기동은 미구현 — 게이트웨이를 수동 실행하세요')
      return
    }
    const serviceDir = join(findWorkspaceRoot(), 'services', 'neru-audio')
    child = spawn('uv', ['run', 'neru-audio'], {
      cwd: serviceDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Windows에서 uv.CMD 해석
    })
    child.stdout?.on('data', d => console.warn(`[neru-audio] ${String(d).trim()}`))
    child.stderr?.on('data', d => console.warn(`[neru-audio] ${String(d).trim()}`))
    child.on('exit', (code) => {
      console.warn(`[neru-audio] exited code=${code}`)
      child = undefined
    })

    const healthy = await waitForHealth()
    if (!healthy)
      console.error('[neru-audio] 헬스 체크 타임아웃 — 게이트웨이가 응답하지 않습니다')
    else
      console.warn('[neru-audio] 게이트웨이 준비됨 (127.0.0.1:3457)')
  }

  function stop(): void {
    if (child?.pid && !child.killed) {
      if (process.platform === 'win32') {
        // Windows는 부모 종료 시 자식 트리(cmd→uv→python)를 정리하지 않으므로 트리째 kill.
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
      }
      else {
        child.kill()
      }
    }
    child = undefined
  }

  return { start, stop }
}

export function setupNeruAudioManager() {
  const manager = createNeruAudioManager()
  onAppBeforeQuit(async () => {
    manager.stop()
  })
  void manager.start()
  return manager
}
