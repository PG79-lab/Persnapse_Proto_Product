import type { VerificationStatus } from "../server/db/types";

const sourceLabels: Record<string, string> = {
  ai_inference: "AI 추론",
  business_card: "명함",
  import: "가져오기",
  manual: "직접 입력",
  note: "메모",
  system: "시스템",
  voice: "음성",
};

export function EvidenceBadge({
  sourceKind,
  verificationStatus,
}: Readonly<{
  sourceKind: string;
  verificationStatus: VerificationStatus;
}>) {
  const confirmed = verificationStatus === "confirmed";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        confirmed
          ? "bg-[var(--confirmed-soft)] text-[var(--confirmed)]"
          : "bg-[var(--draft-soft)] text-[var(--draft)]"
      }`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {confirmed ? "확인됨" : "확인 필요"} ·{" "}
      {sourceLabels[sourceKind] ?? sourceKind}
    </span>
  );
}
