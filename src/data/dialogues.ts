import type { Action, SaveData } from '../sim/types'

export interface Line {
  speaker: string
  portrait: string
  text: string
}

export interface Choice {
  text: string
  actions?: Action[]
}

export interface DialogueDef {
  id: string
  lines: Line[]
  actions?: Action[]
  choices?: Choice[]
}

export const DIALOGUES: Record<string, DialogueDef> = {
  mochi_meet: {
    id: 'mochi_meet',
    lines: [
      { speaker: '모찌', portrait: 'mochi', text: '야옹! 드디어 왔구나, 별하.' },
      { speaker: '별하', portrait: 'byeolha', text: '…말하는 고양이야? 여긴 어디야. 나는 분명 책상 앞에서 졸았는데.' },
      { speaker: '모찌', portrait: 'mochi', text: '여긴 네가 매일 밤 스치기만 했던 꿈의 가장자리. 나는 모찌. 오늘은 그냥 지나치지 마.' },
      { speaker: '모찌', portrait: 'mochi', text: '그런데 꿈이 조금 이상해졌어. 저 솜사탕 슬라임, 보이지? 물총으로 시원하게 맞혀 봐.' },
      { speaker: '별하', portrait: 'byeolha', text: '가방에 있던 물총이 여기서는 진짜네. 알겠어. 같이 가자, 모찌.' },
      { speaker: '모찌', portrait: 'mochi', text: '발은 WASD, 총구는 마우스를 따라가. 클릭하면 나가고, 스페이스는 대시야. 가방은 I, 스킬은 K.' },
    ],
    actions: [
      { type: 'flag', id: 'metMochi' },
      { type: 'talk', npc: 'mochi' },
    ],
  },
  luna_waiting: {
    id: 'luna_waiting',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '별의 기록이 흔들리고 있어. 마을 밖에 아직 정리되지 않은 꿈이 있나 봐.' },
      { speaker: '루나', portrait: 'npc_luna', text: '모찌와 함께 초원의 슬라임을 잠재우고 다시 와 줄래? 나는 루나야.' },
    ],
  },
  luna_offer: {
    id: 'luna_offer',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '별하, 맞지? 기록에 네 이름이 오늘따라 반짝여. 나는 루나. 이 마을의 꿈 기록자야.' },
      { speaker: '루나', portrait: 'npc_luna', text: '몽환의 숲이 탁해지고 있어. 괴물이 꿈을 갉으면, 바닥에 꿈가루가 떨어져.' },
      { speaker: '루나', portrait: 'npc_luna', text: '숲의 괴물 여덟을 잠재우고, 꿈가루 다섯을 모아 줄래? 남쪽 별문이 입구야.' },
    ],
    choices: [
      { text: '도와줄게요', actions: [{ type: 'quest-start', id: 'q_dust' }] },
      { text: '조금 이따 올게요' },
    ],
  },
  luna_dust_progress: {
    id: 'luna_dust_progress',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '숲의 숨이 아직 거칠어. 왼쪽 위 기록을 보면 얼마나 남았는지 알 수 있어.' },
      { speaker: '루나', portrait: 'npc_luna', text: '다치지 말고. 포션은 포포에게 있어.' },
    ],
  },
  luna_dust_done: {
    id: 'luna_dust_done',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '이 가루… 아직 따뜻해. 덕분이야, 별하.' },
      { speaker: '루나', portrait: 'npc_luna', text: '그런데 더 깊은 곳, 버섯 골짜기 너머 별빛 제단에서 커다란 꽃이 악몽을 피우고 있어. 나이트메어 블룸.' },
      { speaker: '루나', portrait: 'npc_luna', text: '발밑에 생기는 원을 읽고 피하면 빈틈이 생겨. 그 꽃을 잠재워 줄래?' },
    ],
    choices: [
      {
        text: '내가 갈게',
        actions: [
          { type: 'quest-turnin', id: 'q_dust' },
          { type: 'quest-start', id: 'q_bloom' },
        ],
      },
      { text: '보상만 받을게', actions: [{ type: 'quest-turnin', id: 'q_dust' }] },
    ],
  },
  luna_offer_bloom: {
    id: 'luna_offer_bloom',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '제단의 꽃은 아직 악몽을 피우고 있어. 버섯 골짜기를 지나면 별문이 하나 더 있어.' },
      { speaker: '루나', portrait: 'npc_luna', text: '이제 갈 수 있겠어?' },
    ],
    choices: [
      { text: '지금 갈게', actions: [{ type: 'quest-start', id: 'q_bloom' }] },
      { text: '조금만 더 준비할게' },
    ],
  },
  luna_bloom_progress: {
    id: 'luna_bloom_progress',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '원이 그려지면 그 안에 서 있지 마. 꽃잎이 퍼지면 옆으로 빠지고.' },
      { speaker: '모찌', portrait: 'mochi', text: '내가 작은 녀석들은 붙잡아 볼게. 저 꽃은 고집이 세서 도발이 안 통해!' },
    ],
  },
  luna_bloom_done: {
    id: 'luna_bloom_done',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '제단의 별이 다시 고르게 뛰어. 오늘의 꿈은 네가 지킨 거야.' },
      { speaker: '루나', portrait: 'npc_luna', text: '…내일 밤에도, 같이 걸어 줄래?' },
      { speaker: '별하', portrait: 'byeolha', text: '응. 모찌랑 나, 또 올게.' },
    ],
    actions: [{ type: 'quest-turnin', id: 'q_bloom' }],
  },
  luna_after: {
    id: 'luna_after',
    lines: [
      { speaker: '루나', portrait: 'npc_luna', text: '오늘은 평온해. 그래도 숲은 가끔 다시 꿈틀거려. 언제든 괜찮아, 별하.' },
    ],
  },
  popo_shop: {
    id: 'popo_shop',
    lines: [
      { speaker: '포포', portrait: 'npc_popo', text: '어서 와~ 포포 상점이야. 물약, 총, 반짝이는 거. 꿈에서도 흥정은 정직하게!' },
    ],
    actions: [{ type: 'open-shop' }],
  },
  kiki_early: {
    id: 'kiki_early',
    lines: [
      { speaker: '키키', portrait: 'npc_kiki', text: '오, 손님? 마을에 막 도착한 얼굴인데. 초원 쪽 꿈부터 정리하고 와. 총은 그다음에 손보자.' },
    ],
  },
  kiki_offer: {
    id: 'kiki_offer',
    lines: [
      { speaker: '키키', portrait: 'npc_kiki', text: '오, 그 물총 손질 좀 하자. 나는 키키. 장난감인데, 꿈에선 세상을 구하거든.' },
      { speaker: '키키', portrait: 'npc_kiki', text: '정예 괴물이 떨어뜨리는 장난감 부품 세 개만 있으면 꿈다트 총을 맞춰 줄게. 이름 앞에 수식어가 붙은 큰 녀석들이야.' },
    ],
    choices: [
      { text: '부품을 모아 올게', actions: [{ type: 'quest-start', id: 'q_parts' }] },
      { text: '지금 총을 재조정해 줘', actions: [{ type: 'open-tinker' }] },
      { text: '나중에 올게' },
    ],
  },
  kiki_progress: {
    id: 'kiki_progress',
    lines: [
      { speaker: '키키', portrait: 'npc_kiki', text: '부품은 정예가 잘 쥐고 있어. 버섯 골짜기에 덩치 큰 애가 둘 있던데.' },
    ],
    choices: [
      { text: '총 재조정', actions: [{ type: 'open-tinker' }] },
      { text: '계속 찾을게' },
    ],
  },
  kiki_done: {
    id: 'kiki_done',
    lines: [
      { speaker: '키키', portrait: 'npc_kiki', text: '좋은 부품이네! 자, 한 방이 깊고 여러 마리를 뚫는 꿈다트 총이야.' },
    ],
    actions: [{ type: 'quest-turnin', id: 'q_parts' }],
    choices: [
      { text: '재조정도 부탁해', actions: [{ type: 'open-tinker' }] },
      { text: '고마워, 키키' },
    ],
  },
  kiki_after: {
    id: 'kiki_after',
    lines: [
      { speaker: '키키', portrait: 'npc_kiki', text: '총은 잘 쓰고 있어? 골드만 있으면 능력치를 다시 굴려 줄게. 일반 등급은 손댈 데가 없고.' },
    ],
    choices: [
      { text: '재조정해 줘', actions: [{ type: 'open-tinker' }] },
      { text: '괜찮아' },
    ],
  },
  well_rest: {
    id: 'well_rest',
    lines: [
      { speaker: '모찌', portrait: 'mochi', text: '우물물이 별빛이야. 마시면 숨이 돌아오고, 여기까지의 꿈이 기록돼.' },
    ],
    actions: [{ type: 'heal-full' }],
  },
  board_look: {
    id: 'board_look',
    lines: [{ speaker: '별하', portrait: 'byeolha', text: '게시판에 아직 끝나지 않은 꿈이 적혀 있어.' }],
    actions: [{ type: 'open-quests' }],
  },
  boss_intro: {
    id: 'boss_intro',
    lines: [
      { speaker: '모찌', portrait: 'mochi', text: '별하, 저 꽃… 예쁘기만 한 게 아니야. 발밑의 원을 봐.' },
      { speaker: '별하', portrait: 'byeolha', text: '패턴을 읽고, 피하고, 빈틈에 쏜다.' },
      { speaker: '모찌', portrait: 'mochi', text: '내가 옆에서 응원할 거야. 도발은 작은 녀석들에게 써. 저 꽃은 고집이 세서 안 넘어와.' },
    ],
    actions: [{ type: 'flag', id: 'bossIntro' }],
  },
}

export function resolveDialogue(npcId: string, save: SaveData): string {
  if (npcId === 'luna') {
    const awaken = save.quests.q_awaken?.status
    const dust = save.quests.q_dust?.status
    const bloom = save.quests.q_bloom?.status
    if (awaken !== 'turnedIn') return 'luna_waiting'
    if (dust === 'completed') return 'luna_dust_done'
    if (dust === 'active') return 'luna_dust_progress'
    if (dust !== 'turnedIn') return 'luna_offer'
    if (bloom === 'completed') return 'luna_bloom_done'
    if (bloom === 'active') return 'luna_bloom_progress'
    if (bloom !== 'turnedIn') return 'luna_offer_bloom'
    return 'luna_after'
  }
  if (npcId === 'kiki') {
    if (save.quests.q_awaken?.status !== 'turnedIn') return 'kiki_early'
    const parts = save.quests.q_parts?.status
    if (parts === 'completed') return 'kiki_done'
    if (parts === 'active') return 'kiki_progress'
    if (parts === 'turnedIn') return 'kiki_after'
    return 'kiki_offer'
  }
  if (npcId === 'popo') return 'popo_shop'
  if (npcId === 'well') return 'well_rest'
  if (npcId === 'board') return 'board_look'
  return 'mochi_meet'
}

export function npcMarker(save: SaveData, npcId: string): '' | '!' | '?' {
  const dialogue = DIALOGUES[resolveDialogue(npcId, save)]
  if (!dialogue) return ''
  const actions = [...(dialogue.actions ?? []), ...(dialogue.choices ?? []).flatMap((choice) => choice.actions ?? [])]
  if (actions.some((action) => action.type === 'quest-turnin')) return '?'
  if (actions.some((action) => action.type === 'quest-start')) return '!'
  return ''
}
