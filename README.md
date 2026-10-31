# 꿈냥 RPG

별하와 말하는 고양이 모찌가 장난감 총으로 꿈속 괴물을 물리치는 귀여운 3D 슈팅 RPG입니다.
목표는 "귀여운 헬게이트 런던": 꿈섬 마을에서 의뢰를 받고, 별문을 지나 꿈 하수도 미궁으로 내려가 무리를 쓸어 내고 돌아옵니다.

플레이: <https://hyunjk11.github.io/dream-nyang-rpg/>
(예전 주소 `/dream-nyang-rpg/3d/` 는 이 주소로 넘어옵니다.)

## 실행

```bash
npm install
npm run dev        # http://localhost:5173/dream-nyang-rpg/
```

```bash
npm test           # vitest (시스템 규칙, 조작감, 카메라, 미궁 생성 등)
npm run lint       # eslint
npm run typecheck  # tsc
npm run build      # 타입체크 → vite 빌드 → 고해상도 GLB 제외
npm run preview
```

PC 브라우저를 권장하고, 휴대폰은 가로 화면에서 터치 조작으로 플레이됩니다.

## 조작 (어깨 너머 3인칭)

| 동작 | 키보드 / 마우스 | 터치 |
| --- | --- | --- |
| 시점 잡기 | 화면 클릭 (이 클릭은 쏘지 않음) · Esc로 풀기 | — |
| 시점 | 마우스 | 화면 오른쪽 끌기 |
| 이동 | WASD, 방향키 | 왼쪽 스틱 |
| 사격 | 클릭 (누르고 있으면 연사) | 공격 버튼 |
| 대시 | Space | 대시 |
| 대화 / 별문 | E, Enter | 대화 |

오른쪽 위 패널에서 음량, 음소거, 시점 감도(저장됨), FPS 표시를 바꿀 수 있습니다.

## 지금 들어 있는 것

- 타이틀, 세 장짜리 인트로, 모찌와의 첫 대화, 이어하기(localStorage)
- 꿈섬: 마을(루나·키키·포포·우물·게시판)과 초원·숲·골짜기·제단 구역, 별문으로 오가기, 보스 나이트메어 블룸
- 꿈 하수도 미궁: 시드 생성 미로, 인스턴싱으로 그리는 무리, 정예·보스, 미니맵, 귀환 별문
- 물총 손맛: 반동, 히트스톱, 피격 연출, 총소리

## 구조

```
index.html              게임 페이지 (사이트 루트)
3d/index.html           예전 /3d/ 주소 → 루트로 넘겨주는 페이지
src/
  main.ts               진입점: 부팅, 마을 ↔ 하수도 전환, 프레임 루프
  core/                 렌더 무대(arena), 입력, 어깨 카메라(tps), 카메라 충돌체, 게임 상태(loop),
                        재질·색·연출 공용 코드
  actors/               별하(hero, grip), 모찌(mochi)
  combat/               마을 전투(combat), 적 모델(foes), 사격(shooter), 난이도, 총 손맛·이펙트
  world/town/           꿈섬 지형, 장식, 랜드마크, 구역 배치
  world/dungeon/        하수도 미궁 (동적 import로 따로 받는 청크)
  ui/                   타이틀·인트로·토스트(screens), 대화창(talk), HUD 연출, style.css
  audio/                BGM·효과음, 총소리 합성
  data/                 아이템, 퀘스트, 대사, 구역, 스킬 데이터
  sim/                  DOM·three 없는 규칙: 전투 수식, 전리품, 퀘스트, 인벤토리, 모찌 따라가기
tests/                  vitest
tools/                  아트·사운드 가공, 배포용 모델 정리, models/ (적 모델 재채색·LOD 도구)
public/models/3d/       런타임은 *_mobile.glb 만 씀 (고해상도 원본은 저장소에만 두고 dist에서 뺌)
```

`src/sim`의 장비·상점 함수 일부는 지금 3D 화면에서 아직 쓰지 않지만, 다음 단계(성장·마을 기능)에서 쓰려고 남겨 두었습니다.

설계 메모는 [docs/GDD.md](docs/GDD.md), 앞으로의 단계는 [docs/ROADMAP.md](docs/ROADMAP.md), 에셋 출처는 [CREDITS.md](CREDITS.md).
