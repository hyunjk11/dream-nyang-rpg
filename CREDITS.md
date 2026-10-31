# 크레딧

## 그림

캐릭터, 적, 소품, 배경 질감, 타이틀과 인트로 일러스트는 이 프로젝트를 위해 만든 오리지널 아트다.  
가공 스크립트는 `tools/process_art.py`. 초록 배경을 지우고 발밑 기준으로 맞춘 뒤 `public/assets`에 둔다.

## 음악과 효과음

`public/assets/audio`의 BGM 두 곡과 효과음은 `tools/make_audio.py`로 이 프로젝트를 위해 합성했다.  
마을 곡은 78 BPM의 꿈결 루프, 전투 곡은 96 BPM이다. 3D 시험판은 같은 두 곡을 mp3로 옮긴 `public/assets/audio3d/bgm_*.mp3`를 쓴다.

### 3D 시험판 효과음 (Kenney, CC0)

`public/assets/audio3d`의 타격·발소리·대화·UI 효과음과 짧은 징글은 Kenney의 CC0 팩에서 골라 mp3로 바꿨다.
CC0(퍼블릭 도메인)라 출처 표기 의무는 없지만 감사의 뜻으로 적어 둔다.

- [Impact Sounds](https://kenney.nl/assets/impact-sounds) — `hit_*`, `pop_*`, `hurt_*`, `step_*`, `boss_hit`
- [Interface Sounds](https://kenney.nl/assets/interface-sounds) — `ui`, `talk_open`, `talk_next`, `splash`, `windup`, `heal_ui`
- [Music Jingles](https://kenney.nl/assets/music-jingles) — `victory`, `down` (Pizzicato jingles 04, 09)

라이선스 원문은 `docs/licenses/Kenney-*-CC0.txt`.

## 3D 모델

`public/models/3d`의 적·랜드마크·NPC 키키·루나 모델은 이 프로젝트의 오리지널 2D 원화(`public/assets`)를 Meshy(image-to-3D, 리깅, 애니메이션)로 입체화한 것이다.

### 꿈 하수도 던전 — 재활용 몬스터

같은 저작자(hyunjk11)의 다른 두 게임에서 몬스터를 가져와 꿈 팔레트(파스텔 틴트, 툰 3단 램프, 은은한 자체 발광)로 다시 칠했다.
하수도 무리는 인스턴싱으로 그리기 때문에, 리깅된 모델은 불러올 때 걷기 동작 4프레임을 정적 메시로 구워(`src/world/dungeon/bake.ts`) 쓴다.

- **KayKit Skeletons Character Pack** — Kay Lousberg (https://www.kaylousberg.com), **CC0 1.0**.
  [hero-defense-3d](https://github.com/hyunjk11/hero-defense-3d)에 포함된 해골 미니언·도적·전사·마법사와 미니언의 걷기 클립.
  `public/models/3d/kk_skel_*_mobile.glb` (쓰지 않는 애니메이션을 지워 용량을 줄임). CC0라 표기 의무는 없지만 감사의 뜻으로 적는다. 원문 요약은 `docs/licenses/KayKit-Skeletons-CC0.txt`.
- **리치** — hero-defense-3d용으로 Meshy(image-to-3D, 자동 리깅, 애니메이션)로 만든 AI 생성 에셋, 저작자 소유.
  `public/models/3d/hd_lich_mobile.glb` (걷기 클립만 남김). 외부 라이선스 없음.
- **절차 몬스터 13종** — [lucky-defense-3d](https://github.com/hyunjk11/lucky-defense-3d)의 `src/render/monsters3d.js`·`src/data/waves.js`(저작자 본인 코드)를 TypeScript로 옮김(`src/world/dungeon/lucky.ts`).
  슬라임·늑대·고블린·기사·망령·골렘·드레이크 7종 + 보스 몸체 하나(boss10~50·현상금 보스 6변형은 인스턴스 색으로 구분). 외부 에셋 없음.
- **우리 Meshy 몬스터** — 슬라임·박쥐·벌레·토끼·악몽 꽃 보스는 위 「3D 모델」 항목과 같다.
- 이번 단계에서 Meshy 크레딧은 쓰지 않았다(0).

## 글꼴

- [Jua](https://fonts.google.com/specimen/Jua) — 우아한형제들, SIL Open Font License 1.1
- [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) — Google, SIL Open Font License 1.1

번들에 포함된 라이선스 원문은 `docs/licenses/OFL-1.1.txt`.

## 엔진

- [Phaser 3](https://phaser.io/) — MIT
- Vite, TypeScript, Vitest, ESLint — 각 패키지 라이선스
