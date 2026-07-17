// neru 장기기억(MEMORY.md) 텍스트를 반응형으로 보관하는 스토어.
// 파일 IO는 하지 않는다 — tamagotchi 렌더러(IPC 소유)가 로드/저장 후 setMemoryText로 채운다.
// 회상 context provider(동기)가 이 memoryText를 읽는다.
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useMemoryStore = defineStore('memory', () => {
  const memoryText = ref('')
  const hasMemory = computed(() => memoryText.value.trim().length > 0)

  function setMemoryText(text: string) {
    memoryText.value = text
  }

  return { memoryText, hasMemory, setMemoryText }
})
