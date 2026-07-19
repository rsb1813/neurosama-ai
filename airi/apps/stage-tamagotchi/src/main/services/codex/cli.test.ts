// Codex CLI 버전 검사와 app-server 시작 경계를 검증한다.
import type { CodexCliExecutor } from './types'

import { describe, expect, it } from 'vitest'

import { inspectCodexCli } from './cli'

function fakeExec(stdout: string): CodexCliExecutor {
  return async () => stdout
}

describe('inspectCodexCli', () => {
  it.each([
    ['codex-cli 0.144.4', true],
    ['codex-cli 0.144.3', false],
    ['unexpected', false],
  ])('checks the supported Codex version', async (stdout, supported) => {
    await expect(inspectCodexCli(fakeExec(stdout))).resolves.toMatchObject({ supported })
  })
})
