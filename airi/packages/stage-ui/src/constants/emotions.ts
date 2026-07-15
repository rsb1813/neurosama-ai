export enum Emotion {
  Happy = 'happy',
  Sad = 'sad',
  Angry = 'angry',
  Think = 'think',
  Surprise = 'surprised',
  Awkward = 'awkward',
  Question = 'question',
  Curious = 'curious',
  Neutral = 'neutral',
}

export const EMOTION_VALUES = Object.values(Emotion)

export const EmotionHappyMotionName = 'Happy'
export const EmotionSadMotionName = 'Sad'
export const EmotionAngryMotionName = 'Angry'
export const EmotionAwkwardMotionName = 'Awkward'
export const EmotionThinkMotionName = 'Think'
export const EmotionSurpriseMotionName = 'Surprise'
export const EmotionQuestionMotionName = 'Question'
export const EmotionNeutralMotionName = 'Idle'
export const EmotionCuriousMotionName = 'Curious'

export const EMOTION_EmotionMotionName_value = {
  [Emotion.Happy]: EmotionHappyMotionName,
  [Emotion.Sad]: EmotionSadMotionName,
  [Emotion.Angry]: EmotionAngryMotionName,
  [Emotion.Think]: EmotionThinkMotionName,
  [Emotion.Surprise]: EmotionSurpriseMotionName,
  [Emotion.Awkward]: EmotionAwkwardMotionName,
  [Emotion.Question]: EmotionQuestionMotionName,
  [Emotion.Neutral]: EmotionNeutralMotionName,
  [Emotion.Curious]: EmotionCuriousMotionName,
}

// 시스템 프롬프트에 넣는 "사용 가능한 감정" 목록 렌더링 — 감정 세트와 문자열 형식을 한 곳에서
// 관리해 기본 카드(SystemPromptV2)와 neru 카드가 같은 문자열을 공유하도록 한다(DRY).
export const EMOTION_PROMPT_LIST = EMOTION_VALUES
  .map(emotion => `- ${emotion} (Emotion for feeling ${EMOTION_EmotionMotionName_value[emotion]})`)
  .join('\n')

export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprised',
  [Emotion.Awkward]: 'neutral',
  [Emotion.Question]: 'think',
  [Emotion.Neutral]: 'neutral',
  [Emotion.Curious]: 'think',
} satisfies Record<Emotion, string | undefined>

export const EMOTION_SpineAnimationName_value = {
  [Emotion.Happy]: 'celebrate',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprise',
  [Emotion.Awkward]: 'awkward',
  [Emotion.Question]: 'question',
  [Emotion.Neutral]: 'idle',
  [Emotion.Curious]: 'curious',
} satisfies Record<Emotion, string>

export interface EmotionPayload {
  name: Emotion
  intensity: number
}

// neru 마녀 모델 전용 — 9개 감정을 witch exp3 표정 이름으로 매핑한다(undefined = 표정 없음/중립).
// 값은 M-E Phase 2 Part A 시각 카탈로그(neru-witch-expression-catalog.md)로 확정했다.
// 마녀는 감정 모션이 없어 exp3 표정이 유일한 감정 표면이다. 표정 미등록 모델에선 applyEmotion이 no-op.
// 소품 표정(gamepad/mic/ghost/staff/hat-off)과 hdj(사악한 표정)는 대응 감정이 없어 맵에서 제외한다.
export const EMOTION_Live2DWitchExpressionName_value = {
  [Emotion.Happy]: 'x',
  [Emotion.Sad]: 'ku',
  [Emotion.Angry]: 'sq',
  [Emotion.Think]: 'yj',
  [Emotion.Surprise]: 'xx',
  [Emotion.Awkward]: 'h',
  [Emotion.Question]: 'yj',
  [Emotion.Curious]: 'xx',
  [Emotion.Neutral]: undefined,
} satisfies Record<Emotion, string | undefined>
