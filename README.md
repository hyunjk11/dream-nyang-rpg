# 꿈냥 RPG

별하와 말하는 고양이 모찌가, 장난감 총으로 몽환 괴물을 물리치는 웹 액션 RPG입니다.  
귀여운 디아블로처럼 **마을에서 의뢰를 받고, 구역을 돌며 싸우고, 장비를 갈아 끼우며 자라는** 루프를 첫 슬라이스로 넣었습니다.

플레이 주소(main에 병합된 뒤): <https://hyunjk11.github.io/dream-nyang-rpg/>

3D 시험판(쿼터뷰): <https://hyunjk11.github.io/dream-nyang-rpg/3d/>  
로컬에서는 <http://localhost:5173/dream-nyang-rpg/3d/> . 2D 타이틀의 `3D 시험판` 버튼으로도 갑니다.

런타임 모델은 `public/models/3d/byeolha_animated_mobile.glb`, `public/models/3d/mochi_mobile.glb` 입니다. 같은 폴더의 고해상도 GLB는 저장소에 두되, 배포 빌드(`dist`)에서는 빼서 페이지가 가벼워지게 합니다. 파일을 못 열면 임시 모습으로 같은 조작을 유지합니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 <http://localhost:5173/dream-nyang-rpg/> 를 엽니다.  
가로 화면을 권장하고, 세로에서도 플레이는 됩니다.

```bash
npm test       # 피해 계산, 전리품, 퀘스트, 세이브
npm run lint
npm run build  # 타입체크 후 dist 생성
npm run preview
```

## 조작

| 동작 | 키보드 / 마우스 | 터치 |
| --- | --- | --- |
| 이동 | WASD, 방향키 | 왼쪽 스틱 |
| 조준 / 공격 | 마우스 조준, 클릭 홀드 | 공격 버튼 (가까운 적 자동 조준) |
| 대시 | Space (짧은 무적) | 대시 |
| 스킬 | 1 2 3 별하, 4 도발, Z 치유, X 냥냥 펀치 | 같은 버튼 |
| 포션 | R | 포션 |
| 대화 | E 또는 말풍선 | 말하기 |
| 가방 / 스킬 / 퀘스트 / 메뉴 | I / K / Q / Esc | 오른쪽 위 버튼 |

## 이번 슬라이스

- 타이틀, 인트로, 모찌와의 첫 대화
- 꿈의 마을: 루나(의뢰), 포포(상점), 키키(총 재조정), 우물(회복·기록), 퀘스트 게시판
- 꿈의 초원 → 마을 → 몽환의 숲 → 버섯 골짜기 → 별빛 제단
- 적 4종 + 정예 수식어 + 보스 나이트메어 블룸
- 물총 / 비누방울 총 / 꿈다트 총, 희귀도, 랜덤 능력치
- 가방·장착(무기, 모자, 옷, 장신구, 모찌 목걸이), 별하/모찌 스킬 트리
- 레벨, 골드, 구매·판매, localStorage 세이브
- 음량, 화면 흔들림, 진동, 터치 버튼

설계와 다음 단계는 [docs/GDD.md](docs/GDD.md), [docs/ROADMAP.md](docs/ROADMAP.md).  
에셋 출처는 [CREDITS.md](CREDITS.md).

## 구조

- `src/sim` 전투·성장·퀘스트·세이브 규칙 (Phaser 없음, 테스트 대상)
- `src/data` 아이템, 적, 스킬, 퀘스트, 대사, 구역
- `src/game` Phaser 씬, 입력, 연출, 사운드
- `src/ui` DOM 인터페이스

콘텐츠를 더할 때는 `src/data`의 해당 파일에 항목을 추가하면 됩니다. 자세한 순서는 GDD에 있습니다.
