// Codex OAuth 자격 증명의 암호화 저장과 직렬 갱신을 검증합니다.
import type { OAuthCredential } from '@earendil-works/pi-ai'

import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCodexCredentialStore } from './credential-store'

const cleanupDirectories: string[] = []

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('createCodexCredentialStore', () => {
  it('stores only encrypted bytes and serializes modifications', async () => {
    const harness = await createHarness()
    const store = createCodexCredentialStore(harness.deps)
    let releaseFirstUpdate: (() => void) | undefined
    const firstUpdateMayFinish = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve
    })

    const first = store.modify('openai-codex', async () => {
      await firstUpdateMayFinish
      return credential('access-1')
    })
    const second = store.modify('openai-codex', async (current) => {
      const access = current?.type === 'oauth' ? current.access : 'missing'
      return credential(`${access}-2`)
    })

    releaseFirstUpdate?.()
    await Promise.all([first, second])

    expect(await harness.rawFile()).not.toContain('access-1')
    expect(await store.read('openai-codex')).toEqual(credential('access-1-2'))

    await store.delete('openai-codex')
    expect(await store.read('openai-codex')).toBeUndefined()
  })

  it('fails before writing when operating-system encryption is unavailable', async () => {
    const harness = await createHarness(false)
    const store = createCodexCredentialStore(harness.deps)

    await expect(
      store.modify('openai-codex', async () => credential('secret')),
    ).rejects.toThrow('Operating-system encryption is unavailable.')
  })
})

function credential(access: string): OAuthCredential {
  return {
    type: 'oauth',
    access,
    refresh: 'refresh-token',
    expires: 4_102_444_800_000,
  }
}

async function createHarness(encryptionAvailable = true) {
  const directory = await mkdtemp(join(tmpdir(), 'neru-codex-credentials-'))
  cleanupDirectories.push(directory)
  const filePath = join(directory, 'credentials.bin')

  return {
    deps: {
      filePath,
      safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        encryptString: (plaintext: string) => Buffer.from(Buffer.from(plaintext).map(byte => byte ^ 0xA5)),
        decryptString: (encrypted: Buffer) => Buffer.from(encrypted).map(byte => byte ^ 0xA5).toString(),
      },
    },
    rawFile: async () => (await readFile(filePath)).toString('hex'),
  }
}
