import { BusinessCardWorkspace } from "../../../capture/business-card-workspace";
import { useState } from "react";
import { Modal } from "./ui.jsx";
export default function CardImport({
  session,
  embedded = false,
  onClose,
  onSaved,
  onViewPerson,
  onFindMemory,
}) {
  const [stage, setStage] = useState(1);
  const content = (
    <div className="connected-capture">
      <ol className="capture-journey" aria-label="명함 등록 순서">
        <li aria-current={stage === 1 ? "step" : undefined}>
          <span>1</span>
          <div>
            <strong>명함 올리기</strong>
            <small>촬영 또는 이미지 선택</small>
          </div>
        </li>
        <li aria-current={stage === 2 ? "step" : undefined}>
          <span>2</span>
          <div>
            <strong>정보 확인하기</strong>
            <small>연락처 수정 · 만남 맥락 추가</small>
          </div>
        </li>
        <li aria-current={stage === 3 ? "step" : undefined}>
          <span>3</span>
          <div>
            <strong>인맥으로 연결</strong>
            <small>기존 인맥 선택 또는 새로 등록</small>
          </div>
        </li>
      </ol>
      <BusinessCardWorkspace
        ocrMode={session.capabilities.ocrMode}
        onStageChange={setStage}
        onViewPerson={onViewPerson}
        onFindMemory={onFindMemory}
        onSaved={(id) => {
          session.store.reload();
          onSaved?.(id);
        }}
      />
    </div>
  );
  return embedded ? (
    content
  ) : (
    <Modal title="명함 등록" wide onClose={onClose}>
      {content}
    </Modal>
  );
}
