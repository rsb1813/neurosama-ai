// Codex CLI의 최소 호환 버전을 검사하고 app-server 프로세스를 시작한다.
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { CodexCliExecutor, CodexCliInspection } from './types'

import { execFile, spawn } from 'node:child_process'

import { errorMessageFrom } from '@moeru/std'

import { MIN_CODEX_VERSION } from './types'

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
  // 셸을 거치지 않아 경로 해석과 인수 전달이 플랫폼별 셸 문법에 영향을 받지 않는다.
  return spawn('codex', ['app-server'], { stdio: 'pipe', windowsHide: true })
}

function executeCodexVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    // 셸 없이 직접 실행해 사용자 PATH의 Codex CLI만 검사한다.
    execFile('codex', ['--version'], (error, stdout) => {
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
