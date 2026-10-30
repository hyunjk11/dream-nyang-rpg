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

## 글꼴

- [Jua](https://fonts.google.com/specimen/Jua) — 우아한형제들, SIL Open Font License 1.1
- [Noto Sans KR](https://fonts.google.com/noto/specimen/Noto+Sans+KR) — Google, SIL Open Font License 1.1

번들에 포함된 라이선스 원문은 `docs/licenses/OFL-1.1.txt`.

## 엔진

- [Phaser 3](https://phaser.io/) — MIT
- Vite, TypeScript, Vitest, ESLint — 각 패키지 라이선스
