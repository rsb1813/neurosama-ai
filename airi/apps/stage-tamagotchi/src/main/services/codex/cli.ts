// Codex CLI의 최소 호환 버전을 검사하고 app-server 프로세스를 시작한다.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { CodexCliExecutor, CodexCliInspection } from './types'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'

import { errorMessageFrom } from '@moeru/std'

import { MIN_CODEX_VERSION } from './types'

/** 플랫폼별 Codex CLI 실행 파일과 고정 접두 인수를 반환한다. */
export function codexCliCommand(
  platform: NodeJS.Platform = process.platform,
  commandInterpreter: string | undefined = process.env.ComSpec,
): { executable: string, prefixArgs: string[] } {
  if (platform === 'win32') {
    return {
      executable: commandInterpreter ?? 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'codex'],
    }
  }

  return { executable: 'codex', prefixArgs: [] }
}

/**
 * 설치된 Codex CLI의 버전을 읽어 app-server 최소 지원 여부를 반환한다.
 *
 * Call stack:
 *
 * {@link inspectCodexCli}
 *   -> `codex --version`
 */
export async function inspectCodexCli(execute: CodexCliExecutor = executeCodexVersion): Promise<CodexCliInspection> {
  try {
    const stdout = await execute()
    const version = extractVersion(stdout)

    return {
      installed: true,
      version,
      supported: version !== undefined && isSupportedVersion(version),
    }
  }
  catch (error) {
    return {
      installed: false,
      supported: false,
      error: errorMessageFrom(error) ?? 'Unable to inspect Codex CLI.',
    }
  }
}

/**
 * 파이프된 표준 입출력으로 Codex app-server를 시작한다.
 *
 * Call stack:
 *
 * {@link startCodexAppServer}
 *   -> `codex app-server`
 */
export function startCodexAppServer(): ChildProcessWithoutNullStreams {
  const command = codexCliCommand()
  return spawn(command.executable, [...command.prefixArgs, 'app-server'], { stdio: 'pipe', windowsHide: true })
}

function executeCodexVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = codexCliCommand()
    execFile(command.executable, [...command.prefixArgs, '--version'], (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }

      resolve(stdout.toString())
    })
  })
}

function extractVersion(stdout: string): string | undefined {
  return /^codex-cli (\d+\.\d+\.\d+)$/.exec(stdout.trim())?.[1]
}

function isSupportedVersion(version: string): boolean {
  const candidate = version.split('.').map(Number)
  const minimum = MIN_CODEX_VERSION.split('.').map(Number)

  for (let index = 0; index < minimum.length; index++) {
    const candidatePart = candidate[index] ?? 0
    const minimumPart = minimum[index] ?? 0
    if (candidatePart !== minimumPart)
      return candidatePart > minimumPart
  }

  return true
}
