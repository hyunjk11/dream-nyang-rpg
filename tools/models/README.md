# 모델 손질 도구

게임 빌드와 따로 쓰는 스크립트예요. 처음 한 번 `cd tools/models && npm install` (Python 쪽은 Pillow 필요).

| 스크립트 | 하는 일 |
|---|---|
| `restyle-foes.mjs <원본 폴더> [출력 폴더]` | 리깅된 적(스켈레톤·리치)에서 걷기 동작만 남기고, 텍스처를 꿈빛 파스텔로 바꿔 `*_mobile.glb`로 저장 (기본 출력: `public/models/3d/`) |
| `dreamtex.py 입력 출력 png\|webp` | 텍스처 한 장 파스텔 재채색 (채도 낮추고, 그림자 들어 올리고, 붉은 기는 분홍·라일락 쪽으로) |
| `far-lod.mjs 입력.glb 출력.glb 비율` | 무리용 원거리 LOD: UV 이음새 용접 → 텍스처를 버텍스 컬러로 굽기 → 단순화 |
| `inspect.mjs a.glb …` | 삼각형·텍스처·애니메이션 개수 확인 |
