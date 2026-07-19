// Neru 랜딩 페이지의 네 언어 문구와 안전한 언어 선택 규칙을 제공하는 모듈
export const LOCALES = ["en", "zh-CN", "ja", "ko"];
export const DEFAULT_LOCALE = "en";
export const STORAGE_KEY = "neru-locale";

export const COPY = {
  en: {
    language: "Language", nav: ["Character", "System", "Contribute"],
    a11y: { homeLabel: "Neru home", primaryNavigation: "Primary navigation", characterImageAlt: "Neru's witch Live2D character model" },
    chrome: { characterStudy: "CHARACTER STUDY / 001", folio: "NERU — ISSUE 01", footer: "NERU / OPEN CHARACTER EXPERIMENT" },
    hero: { eyebrow: "An open character experiment", title: "Intelligence, with a stage presence.", body: "Meet Neru, a playful AI witch learning to listen, speak, remember, and grow.", primary: "View on GitHub", secondary: "See how she works" },
    sections: [
      { label: "01 — Meet Neru", title: "A personality, not a prompt.", body: "Warm, witty, and a little cheeky, Neru understands Korean and performs in an English voice with Korean subtitles." },
      { label: "02 — How she comes alive", title: "One conversation. Four living layers.", body: "Korean input flows through a local AI system into English speech, Korean subtitles, and a responsive Live2D presence." },
      { label: "03 — Built in public", title: "A working character, still becoming.", body: "Every capability is built as a real vertical slice, with finished work and open work shown separately." },
      { label: "04 — Under the spell", title: "Local-first by design.", body: "Project AIRI provides the stage while Neru's GPU audio service and local model connection provide her voice and mind." },
      { label: "05 — Join the experiment", title: "Help shape what she becomes.", body: "Follow the code, read the roadmap, or contribute to the next part of Neru's world." },
    ],
    flow: ["Korean input", "Local AI", "English voice + Korean subtitles", "Live2D expression"],
    capabilities: [
      { state: "Verified", title: "English voice", body: "Local Chatterbox speech through the Neru audio gateway." },
      { state: "Verified", title: "Long-term memory", body: "Durable facts can carry across conversations and restarts." },
      { state: "Built", title: "Barge-in", body: "Interrupt handling is merged; final hands-on microphone verification remains." },
      { state: "In progress", title: "Witch expression", body: "The character model and emotion-driven expression system continue to evolve." },
    ],
    stack: ["AIRI desktop stage", "Neru local GPU audio", "Local OpenAI-compatible model"], actions: ["GitHub repository", "Read the roadmap", "Open contribution issues"],
  },
  "zh-CN": {
    language: "语言", nav: ["角色", "系统", "参与贡献"],
    a11y: { homeLabel: "Neru 主页", primaryNavigation: "主导航", characterImageAlt: "Neru 的魔女 Live2D 角色模型" },
    chrome: { characterStudy: "角色研究 / 001", folio: "NERU — 第 01 期", footer: "NERU / 开放角色实验" },
    hero: { eyebrow: "一场开放的角色实验", title: "拥有舞台感的智能。", body: "认识 Neru——一位正在学习倾听、说话、记忆与成长的俏皮 AI 魔女。", primary: "在 GitHub 查看", secondary: "了解她如何运作" },
    sections: [
      { label: "01 — 认识 Neru", title: "不是提示词，而是个性。", body: "温暖、机敏又有一点调皮。Neru 能理解韩语，以英语声音表演，并显示韩语字幕。" },
      { label: "02 — 她如何鲜活起来", title: "一次对话，四个鲜活层次。", body: "韩语输入经过本地 AI 系统，转化为英语语音、韩语字幕与会响应的 Live2D 形象。" },
      { label: "03 — 公开构建", title: "已经能运行，也仍在成长。", body: "每项能力都作为真实的垂直切片构建，已完成与进行中的工作会清楚区分。" },
      { label: "04 — 魔法之下", title: "从设计之初就坚持本地优先。", body: "Project AIRI 提供舞台，Neru 的 GPU 音频服务与本地模型连接则赋予她声音与思维。" },
      { label: "05 — 加入实验", title: "一起塑造她将成为的样子。", body: "关注代码、阅读路线图，或参与构建 Neru 世界的下一部分。" },
    ],
    flow: ["韩语输入", "本地 AI", "英语语音 + 韩语字幕", "Live2D 表情"],
    capabilities: [
      { state: "已验证", title: "英语语音", body: "通过 Neru 音频网关运行的本地 Chatterbox 语音。" },
      { state: "已验证", title: "长期记忆", body: "持久化事实可以跨对话与重启保留。" },
      { state: "已构建", title: "打断响应", body: "打断处理已合并，仍需完成最终的真人麦克风验证。" },
      { state: "开发中", title: "魔女表情", body: "角色模型与情绪驱动的表情系统仍在持续完善。" },
    ],
    stack: ["AIRI 桌面舞台", "Neru 本地 GPU 音频", "本地 OpenAI 兼容模型"], actions: ["GitHub 仓库", "阅读路线图", "查看贡献议题"],
  },
  ja: {
    language: "言語", nav: ["キャラクター", "システム", "コントリビュート"],
    a11y: { homeLabel: "Neru ホーム", primaryNavigation: "メインナビゲーション", characterImageAlt: "Neruの魔女Live2Dキャラクターモデル" },
    chrome: { characterStudy: "キャラクター研究 / 001", folio: "NERU — 第01号", footer: "NERU / オープン・キャラクター実験" },
    hero: { eyebrow: "オープンなキャラクター実験", title: "舞台に立つ、知性。", body: "聞き、話し、記憶し、成長することを学ぶ、遊び心のあるAI魔女Neru。", primary: "GitHubで見る", secondary: "仕組みを見る" },
    sections: [
      { label: "01 — Neruとは", title: "プロンプトではなく、人格。", body: "温かく、機知に富み、少し生意気。Neruは韓国語を理解し、英語の声と韓国語字幕で演じます。" },
      { label: "02 — 命が宿る仕組み", title: "ひとつの会話、四つの生きた層。", body: "韓国語入力がローカルAIを通り、英語音声、韓国語字幕、反応するLive2D表現へつながります。" },
      { label: "03 — オープンに開発", title: "動いていて、まだ成長中。", body: "すべての能力を実際に動く垂直スライスとして作り、完成済みと進行中を明確に示します。" },
      { label: "04 — 魔法の内側", title: "設計からローカルファースト。", body: "Project AIRIが舞台を、NeruのGPU音声サービスとローカルモデル接続が声と知性を担います。" },
      { label: "05 — 実験に参加", title: "彼女の未来を一緒につくる。", body: "コードを追い、ロードマップを読み、Neruの世界の次の一歩に貢献できます。" },
    ],
    flow: ["韓国語入力", "ローカルAI", "英語音声 + 韓国語字幕", "Live2D表現"],
    capabilities: [
      { state: "検証済み", title: "英語音声", body: "Neru音声ゲートウェイを通じたローカルChatterbox音声。" },
      { state: "検証済み", title: "長期記憶", body: "会話や再起動をまたいで事実を保持できます。" },
      { state: "実装済み", title: "割り込み", body: "割り込み処理はマージ済みで、最終的な実機マイク検証が残っています。" },
      { state: "開発中", title: "魔女の表情", body: "キャラクターモデルと感情連動の表情システムは進化を続けています。" },
    ],
    stack: ["AIRIデスクトップステージ", "NeruローカルGPU音声", "ローカルOpenAI互換モデル"], actions: ["GitHubリポジトリ", "ロードマップを読む", "コントリビュートIssueを見る"],
  },
  ko: {
    language: "언어", nav: ["캐릭터", "시스템", "기여하기"],
    a11y: { homeLabel: "Neru 홈", primaryNavigation: "주요 탐색", characterImageAlt: "Neru의 마녀 Live2D 캐릭터 모델" },
    chrome: { characterStudy: "캐릭터 스터디 / 001", folio: "NERU — 제01호", footer: "NERU / 열린 캐릭터 실험" },
    hero: { eyebrow: "열린 캐릭터 실험", title: "무대 위에 선 지능.", body: "듣고, 말하고, 기억하고, 성장하는 법을 배우는 장난기 많은 AI 마녀 Neru를 만나보세요.", primary: "GitHub에서 보기", secondary: "작동 방식 보기" },
    sections: [
      { label: "01 — Neru를 만나다", title: "프롬프트가 아닌, 하나의 성격.", body: "따뜻하고 재치 있으며 조금은 짓궂습니다. Neru는 한국어를 이해하고 영어 음성과 한국어 자막으로 연기합니다." },
      { label: "02 — 살아나는 방식", title: "하나의 대화, 네 개의 살아 있는 층.", body: "한국어 입력이 로컬 AI를 거쳐 영어 음성, 한국어 자막, 반응하는 Live2D 표현으로 이어집니다." },
      { label: "03 — 공개적으로 만들기", title: "이미 작동하지만, 계속 성장하는 캐릭터.", body: "각 기능을 실제로 동작하는 수직 슬라이스로 만들고 완료된 작업과 진행 중인 작업을 명확히 나눕니다." },
      { label: "04 — 마법의 안쪽", title: "처음부터 로컬 우선.", body: "Project AIRI가 무대를 맡고 Neru의 GPU 음성 서비스와 로컬 모델 연결이 목소리와 사고를 담당합니다." },
      { label: "05 — 실험에 참여하기", title: "Neru가 될 모습을 함께 만들어 주세요.", body: "코드를 살펴보고, 로드맵을 읽거나, Neru 세계의 다음 단계를 만드는 데 기여할 수 있습니다." },
    ],
    flow: ["한국어 입력", "로컬 AI", "영어 음성 + 한국어 자막", "Live2D 표현"],
    capabilities: [
      { state: "검증됨", title: "영어 음성", body: "Neru 음성 게이트웨이를 통한 로컬 Chatterbox 음성입니다." },
      { state: "검증됨", title: "장기 기억", body: "대화와 앱 재시작을 넘어 사실을 기억할 수 있습니다." },
      { state: "구현됨", title: "끼어들기", body: "중단 처리는 병합됐으며 최종 실사용 마이크 검증이 남아 있습니다." },
      { state: "진행 중", title: "마녀 표정", body: "캐릭터 모델과 감정 기반 표정 시스템은 계속 발전하고 있습니다." },
    ],
    stack: ["AIRI 데스크톱 스테이지", "Neru 로컬 GPU 음성", "로컬 OpenAI 호환 모델"], actions: ["GitHub 저장소", "로드맵 읽기", "기여 이슈 보기"],
  },
};

export function normalizeLocale(value) {
  return LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

export function readStoredLocale(storage) {
  try {
    return normalizeLocale(storage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function readBrowserLocale(storageProvider) {
  try {
    return readStoredLocale(storageProvider());
  } catch {
    return DEFAULT_LOCALE;
  }
}
