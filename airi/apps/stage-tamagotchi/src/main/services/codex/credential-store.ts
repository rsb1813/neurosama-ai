// Codex OAuth 자격 증명을 운영체제 보호 저장소로 암호화해 보관합니다.
import type { Buffer } from 'node:buffer'

import type { Credential, CredentialStore } from '@earendil-works/pi-ai'

import process from 'node:process'

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface CodexSafeStorage {
  isEncryptionAvailable: () => boolean
  encryptString: (plaintext: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export interface CodexCredentialStoreDeps {
  filePath: string
  safeStorage: CodexSafeStorage
}

/** pi-ai가 요구하는 직렬 read-modify-write 저장소를 생성합니다. */
export function createCodexCredentialStore(deps: CodexCredentialStoreDeps): CredentialStore {
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.catch(() => undefined).then(task)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    read(providerId) {
      return enqueue(async () => (await readCredentials(deps))[providerId])
    },
    modify(providerId, update) {
      return enqueue(async () => {
        const credentials = await readCredentials(deps)
        const current = credentials[providerId]
        const next = await update(current)
        if (next === undefined)
          return current

        credentials[providerId] = next
        await writeCredentials(deps, credentials)
        return next
      })
    },
    delete(providerId) {
      return enqueue(async () => {
        const credentials = await readCredentials(deps)
        if (credentials[providerId] === undefined)
          return

        delete credentials[providerId]
        if (Object.keys(credentials).length === 0) {
          await unlink(deps.filePath).catch(ignoreMissingFile)
          return
        }
        await writeCredentials(deps, credentials)
      })
    },
  }
}

async function readCredentials(deps: CodexCredentialStoreDeps): Promise<Record<string, Credential>> {
  requireEncryption(deps.safeStorage)
  let encrypted: Buffer
  try {
    encrypted = await readFile(deps.filePath)
  }
  catch (error) {
    if (isMissingFile(error))
      return {}
    throw error
  }

  const parsed: unknown = JSON.parse(deps.safeStorage.decryptString(encrypted))
  if (!isCredentialRecord(parsed))
    throw new Error('Stored Codex credentials are invalid.')
  return parsed
}

async function writeCredentials(deps: CodexCredentialStoreDeps, credentials: Record<string, Credential>): Promise<void> {
  requireEncryption(deps.safeStorage)
  const encrypted = deps.safeStorage.encryptString(JSON.stringify(credentials))
  const temporaryPath = `${deps.filePath}.${process.pid}.tmp`
  await mkdir(dirname(deps.filePath), { recursive: true })
  await writeFile(temporaryPath, encrypted, { mode: 0o600 })
  await rename(temporaryPath, deps.filePath)
}

function requireEncryption(safeStorage: CodexSafeStorage): void {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('Operating-system encryption is unavailable.')
}

function isCredentialRecord(value: unknown): value is Record<string, Credential> {
  if (!isRecord(value))
    return false
  return Object.values(value).every(isCredential)
}

function isCredential(value: unknown): value is Credential {
  if (!isRecord(value))
    return false
  if (value.type === 'api_key')
    return value.key === undefined || typeof value.key === 'string'
  return value.type === 'oauth'
    && typeof value.access === 'string'
    && typeof value.refresh === 'string'
    && typeof value.expires === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function ignoreMissingFile(error: unknown): void {
  if (!isMissingFile(error))
    throw error
}
