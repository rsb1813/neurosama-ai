// neru 장기기억 파일(MEMORY.md)의 메인 프로세스 IO 서비스 — 렌더러의 read/write IPC를 처리한다.
import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import { electronMemoryReadText, electronMemoryWriteText } from '../../../../shared/eventa'

function memoryFilePath(): string {
  return join(app.getPath('userData'), 'neru-memory', 'MEMORY.md')
}

// 파일이 없으면 디렉터리와 빈 파일을 만든다. 반환은 파일 경로.
async function ensureFile(): Promise<string> {
  const path = memoryFilePath()
  await mkdir(dirname(path), { recursive: true })
  try {
    await readFile(path, 'utf-8')
  }
  catch {
    await writeFile(path, '')
  }
  return path
}

export function createMemoryService(params: { context: ReturnType<typeof createContext>['context'] }) {
  // 쓰기를 직렬화한다 — 한 응답에서 remember가 여러 번 호출돼도 파일이 깨지지 않게.
  let writeChain: Promise<unknown> = Promise.resolve()

  defineInvokeHandler(params.context, electronMemoryReadText, async () => {
    const path = await ensureFile()
    const text = await readFile(path, 'utf-8')
    return { path, text }
  })

  defineInvokeHandler(params.context, electronMemoryWriteText, async (payload) => {
    const run = async () => {
      const path = await ensureFile()
      await writeFile(path, payload.text)
      return { path, text: payload.text }
    }
    writeChain = writeChain.then(run, run)
    return writeChain as Promise<{ path: string, text: string }>
  })
}
