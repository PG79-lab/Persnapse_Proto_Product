# LC100 통합 파이프라인 커밋 시점

2026-10-13: 최적화/고도화 전 기능 체크포인트다.

- 촬영/파일 → LC100 Worker → 원근 보정 → 2D 이미지 확인 → 기존 OCR → 정보 확인을 통합 `/#cards`에 연결했다.
- 불완전하거나 잘못된 외곽은 OCR 전 수동 네 점 보정으로 처리한다. 새 recipe는 보정 display를 최초 OCR/재시도 입력으로 사용한다.
- 실제 사진 27장 중 23장 자동 감지·보정·Mock OCR 전달 PASS, 4장 수동 검토 필요. 정답 검수 전 정확도는 NOT_RUN이다.
- 단위 259개, 통합 E2E 6개, lint/typecheck/format/build를 검증했다. 카메라 E2E는 시뮬레이션 입력이다.
- 성공 사진의 초기 로드 포함 PC 파일럿 p50 8.37초/p95 18.34초. 통제된 warm/cold 및 모바일 성능 gate는 미검증이다.
- 실제 사진·모델 바이너리·HTML/측정 결과는 Git 제외 output/public 경로에 둔다. 원본 사진 27개의 SHA-256 보존을 확인했다.

후속 범위: 후처리/Worker 재사용 최적화, 원본 경계 정밀화, 비율 입력·회전, ROI 복원 소스와 v2 저장/재개, 실제 OCR 정확도 및 모바일·최종 품질 시험.

[초기 설계](../plans/card-boundary-rectification-design-2026-10-12.md),
[벤치마크 기준](../plans/card-boundary-rectification-benchmark-2026-10-12.md),
[실행 안내](card-pipeline-test-2026-10-13.md)를 함께 참고한다.
