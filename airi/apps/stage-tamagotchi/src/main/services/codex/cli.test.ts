// Codex CLI 버전 검사와 app-server 시작 경계를 검증한다.
import type { CodexCliExecutor } from './types'

import { describe, expect, it } from 'vitest'

import { codexCliCommand, inspectCodexCli } from './cli'

function fakeExec(stdout: string): CodexCliExecutor {
  return async () => stdout
}

describe('inspectCodexCli', () => {
  it.each([
    ['codex-cli 0.144.4', true],
    ['codex-cli 0.144.3', false],
    ['unexpected', false],
    ['codex-cli 0.144.4-beta', false],
    ['unexpected 0.144.4', false],
    ['codex-cli 0.144.4.1', false],
  ])('checks the supported Codex version', async (stdout, supported) => {
    await expect(inspectCodexCli(fakeExec(stdout))).resolves.toMatchObject({
      installed: true,
      supported,
    })
  })

  it('reports a missing CLI instead of throwing executor failures', async () => {
    const executor: CodexCliExecutor = async () => Promise.reject(new Error('spawn codex ENOENT'))

    await expect(inspectCodexCli(executor)).resolves.toMatchObject({
      installed: false,
      supported: false,
      error: 'spawn codex ENOENT',
    })
  })
})

describe('codexCliCommand', () => {
  it('uses the Windows command interpreter so npm shims win over app execution aliases', () => {
    expect(codexCliCommand('win32', 'C:/Windows/System32/cmd.exe')).toEqual({
      executable: 'C:/Windows/System32/cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'codex'],
    })
  })

  it('executes Codex directly on non-Windows platforms', () => {
    expect(codexCliCommand('linux')).toEqual({ executable: 'codex', prefixArgs: [] })
  })
})
