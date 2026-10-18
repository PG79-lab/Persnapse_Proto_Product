"use client";
import { InferenceHint } from "./inference-hint";
import dynamic from "next/dynamic";

const CardRecognitionTestLab = dynamic(
  () =>
    import("../../../card_recognition/test-lab").then(
      (module) => module.CardRecognitionTestLab,
    ),
  { ssr: false },
);

import { useEffect, useRef, useState } from "react";

import { CardViewer } from "../../../card_recognition/card-viewer";
import {
  ContactNumberFields,
  ContactNumberList,
} from "../../../card_recognition/contact-number-fields";
import { CardCornerEditor } from "../../../card_recognition/card-corner-editor";
import type { CardCorners } from "../../../card_recognition/geometry";
import { RestorationJobs } from "../../../card_recognition/restoration-jobs";
import { rectifyCard } from "../../../card_recognition/rectify-card";
import {
  rotateCardImage,
  type CardRotation,
} from "../../../card_recognition/rotate-card";
import {
  restoreBusinessCardImage,
  type CardRestoration,
} from "../../../card_recognition/restore-image";
import type { BusinessCardDraftV1 } from "../../domain/business-card/business-card-draft";
import type {
  BusinessCardCommitResponse,
  BusinessCardSessionView,
} from "../../domain/business-card/business-card-workflow";
import { BusinessCardCamera } from "./business-card-camera";
import { processBusinessCardImage } from "./card-image-processing";

type QueueStatus =
  | "preparing"
  | "boundary_review"
  | "card_review"
  | "card_result"
  | "memory_review"
  | "committed"
  | "error";

interface QueueItem {
  rotationBase?: Extract<CardRestoration, { kind: "restored" }>;
  rotation?: CardRotation;
  rotationBusy?: boolean;
  boundaryCorners?: CardCorners;
  pipelineTimings?: Record<string, number>;
  pipelineRecipe?: "docaligner-lc100-card-v1" | "manual-card-v1";
  contextElapsedMs?: number;
  imageAcceptedAt: number;
  id: string;
  uploadRequestKey: string;
  filename: string;
  sourceFile: File | null;
  sourcePreviewUrl: string | null;
  previewUrl: string;
  restoredUrl: string | null;
  pendingRestoration: Extract<CardRestoration, { kind: "restored" }> | null;
  restorationState:
    "idle" | "processing" | "preview" | "restored" | "fallback" | "error";
  restorationMessage: string | null;
  status: QueueStatus;
  card: BusinessCardSessionView | null;
  draft: BusinessCardDraftV1 | null;
  contextNote: string;
  identityChoice:
    { mode: "existing"; personId: string } | { mode: "new" } | null;
  newDisplayName: string;
  result: BusinessCardCommitResponse | null;
  error: string | null;
  slow: boolean;
  operation: "ocr" | "confirm" | "context" | "commit" | null;
}

interface ApiErrorPayload {
  error?: string;
  captureId?: string;
}

const contextSample =
  "오늘 AI 제품 밋업에서 만났다. 관계형 메모리와 B2B 파일럿에 관해 이야기했고, 다음 주에 소개 자료를 보내기로 했다.";

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.error ?? "요청을 완료하지 못했습니다."),
      { captureId: payload.captureId },
    );
  }
  return payload;
}

function queueStatusLabel(status: QueueStatus): string {
  switch (status) {
    case "preparing":
      return "처리 중";
    case "boundary_review":
      return "테두리 확인";
    case "card_review":
      return "명함 확인";
    case "card_result":
      return "명함 복원";
    case "memory_review":
      return "저장 전 검토";
    case "committed":
      return "저장 완료";
    case "error":
      return "재시도 필요";
  }
}

function ocrProviderLabel(
  provider: string | null | undefined,
  mode: "mock" | "live",
): string {
  if (provider === "naver_clova") return "NAVER CLOVA OCR";
  if (provider === "openai") return "OpenAI 이미지 인식";
  if (provider === "openai_cache") return "OpenAI 이미지 인식 · 재사용";
  if (provider === "naver_clova_cache") return "NAVER CLOVA OCR · 재사용";
  if (provider === "mock") return "Mock OCR";
  return mode === "live" ? "AI 이미지 인식" : "Mock OCR";
}

export function BusinessCardWorkspace({
  ocrMode,
  onSaved,
  onStageChange,
  onViewPerson,
  onFindMemory,
}: {
  ocrMode: "mock" | "live";
  onSaved?: (personId: string) => void;
  onStageChange?: (stage: number) => void;
  onViewPerson: (personId: string) => void;
  onFindMemory: (question: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrInFlightRef = useRef(new Set<string>());
  const rotationInFlightRef = useRef(new Set<string>());
  const restorationJobsRef = useRef(new RestorationJobs());
  const ownedUrlsRef = useRef(new Set<string>());
  const [items, setItems] = useState<QueueItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [testLabOpen, setTestLabOpen] = useState(false);
  useEffect(() => {
    setTestLabOpen(
      ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
        new URLSearchParams(window.location.search).get("cardTest") === "1",
    );
  }, []);

  const activeItem = items.find((item) => item.id === activeId) ?? null;
  const stage =
    !activeItem || activeItem.operation === "ocr"
      ? 1
      : activeItem.status === "card_review" ||
          activeItem.status === "card_result" ||
          activeItem.operation === "context"
        ? 2
        : 3;
  useEffect(() => onStageChange?.(stage), [onStageChange, stage]);
  useEffect(() => {
    const jobs = restorationJobsRef.current;
    const urls = ownedUrlsRef.current;
    return () => {
      jobs.cancelAll();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/business-cards", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => responseJson<BusinessCardSessionView[]>(response))
      .then((cards) => {
        if (controller.signal.aborted) return;
        const resumed: QueueItem[] = cards.slice(0, 5).map((card) => ({
          id: card.captureId,
          imageAcceptedAt: performance.now(),
          uploadRequestKey: crypto.randomUUID(),
          filename: "저장된 명함",
          sourceFile: null,
          sourcePreviewUrl: null,
          previewUrl: card.imageUrl,
          restoredUrl: null,
          pendingRestoration: null,
          restorationState: "idle",
          restorationMessage: null,
          status: card.state === "review" ? "memory_review" : "card_result",
          card,
          draft: card.draft,
          contextNote: card.contextNote,
          identityChoice: null,
          newDisplayName: card.draft?.identity.displayName ?? "",
          result: null,
          error: null,
          slow: false,
          operation: null,
        }));
        setItems((current) => {
          const existing = new Set(current.map((item) => item.card?.captureId));
          return [
            ...current,
            ...resumed.filter((item) => !existing.has(item.id)),
          ].slice(0, 5);
        });
        setActiveId((current) => current ?? resumed[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGlobalError(
          error instanceof Error
            ? `저장된 명함을 불러오지 못했습니다. ${error.message}`
            : "저장된 명함을 불러오지 못했습니다.",
        );
      });
    return () => controller.abort();
  }, []);

  function ownedUrl(blob: Blob) {
    const url = URL.createObjectURL(blob);
    ownedUrlsRef.current.add(url);
    return url;
  }

  function releaseUrl(url: string) {
    if (ownedUrlsRef.current.delete(url)) URL.revokeObjectURL(url);
  }

  function updateItem(itemId: string, updater: (item: QueueItem) => QueueItem) {
    setItems((current) =>
      current.map((item) => (item.id === itemId ? updater(item) : item)),
    );
  }

  async function rotateItem(item: QueueItem) {
    if (!item.pendingRestoration || rotationInFlightRef.current.has(item.id))
      return;
    rotationInFlightRef.current.add(item.id);
    const job = restorationJobsRef.current.begin(item.id);
    const active = () => restorationJobsRef.current.owns(item.id, job.revision);
    const base = item.rotationBase ?? item.pendingRestoration;
    const rotation = (((item.rotation ?? 0) + 90) % 360) as CardRotation;
    updateItem(item.id, (current) => ({
      ...current,
      rotationBusy: true,
      restorationMessage: "명함 방향을 바꾸고 있습니다.",
    }));
    try {
      const image = await rotateCardImage(base.file, rotation, job.signal);
      if (!active()) return;
      const url = ownedUrl(image.file);
      updateItem(item.id, (current) => {
        if (!active()) {
          releaseUrl(url);
          return current;
        }
        if (current.restoredUrl) releaseUrl(current.restoredUrl);
        return {
          ...current,
          rotationBase: base,
          rotation,
          rotationBusy: false,
          restoredUrl: url,
          pendingRestoration: { ...base, ...image },
          restorationMessage: `${rotation}도 회전했습니다. 글자가 바른 방향인지 확인한 뒤 OCR을 실행하세요.`,
        };
      });
    } catch (error) {
      if (active())
        updateItem(item.id, (current) => ({
          ...current,
          rotationBusy: false,
          restorationMessage:
            error instanceof Error
              ? error.message
              : "명함 회전에 실패했습니다.",
        }));
    } finally {
      rotationInFlightRef.current.delete(item.id);
    }
  }

  async function uploadItem(
    itemId: string,
    sourceFile: File,
    requestKey: string,
    options: {
      corners?: CardCorners;
      acceptedFile?: File;
      recipe?: QueueItem["pipelineRecipe"];
    } = {},
  ) {
    if (
      ocrInFlightRef.current.has(itemId) ||
      rotationInFlightRef.current.has(itemId)
    )
      return;
    ocrInFlightRef.current.add(itemId);
    const job = restorationJobsRef.current.begin(itemId);
    const active = () => restorationJobsRef.current.owns(itemId, job.revision);
    updateItem(itemId, (item) => ({
      ...item,
      status: "preparing",
      error: null,
      slow: false,
      operation: "ocr",
    }));
    const slowTimer = window.setTimeout(
      () =>
        updateItem(itemId, (item) => ({
          ...item,
          slow: item.status === "preparing",
        })),
      5_000,
    );

    try {
      const preprocessStartedAt = performance.now();
      const processed = await processBusinessCardImage(sourceFile);
      if (!active()) return;
      if (!options.acceptedFile) {
        try {
          const result = await rectifyCard(sourceFile, {
            signal: job.signal,
            corners: options.corners,
            progress: (message) =>
              updateItem(itemId, (item) => ({
                ...item,
                restorationMessage: message,
              })),
          });
          if (!active()) return;
          const url = ownedUrl(result.restored.file);
          updateItem(itemId, (item) => {
            if (!active()) {
              releaseUrl(url);
              return item;
            }
            if (item.restoredUrl) releaseUrl(item.restoredUrl);
            return {
              ...item,
              status: "boundary_review",
              operation: null,
              restoredUrl: url,
              pendingRestoration: result.restored,
              rotationBase: result.restored,
              rotation: 0,
              rotationBusy: false,
              boundaryCorners: result.corners,
              pipelineRecipe: result.recipe,
              pipelineTimings: result.timings,
              restorationState: "preview",
              restorationMessage:
                "테두리와 2D 명함 이미지를 확인한 뒤 OCR을 실행하세요.",
              slow: false,
            };
          });
        } catch (error) {
          if (!active()) return;
          updateItem(itemId, (item) => {
            if (item.restoredUrl) releaseUrl(item.restoredUrl);
            return {
              ...item,
              status: "boundary_review",
              operation: null,
              restoredUrl: null,
              pendingRestoration: null,
              rotationBase: undefined,
              rotation: 0,
              rotationBusy: false,
              restorationState: "fallback",
              slow: false,
              restorationMessage:
                error instanceof Error
                  ? error.message
                  : "테두리를 직접 지정하세요.",
            };
          });
        }
        return;
      }
      const rectified = await processBusinessCardImage(options.acceptedFile);
      if (!active()) return;
      processed.displayFile = rectified.displayFile;
      processed.displayWidth = rectified.displayWidth;
      processed.displayHeight = rectified.displayHeight;
      performance.measure("business-card:preprocess", {
        start: preprocessStartedAt,
        end: performance.now(),
      });
      const displayUrl = ownedUrl(processed.displayFile);
      updateItem(itemId, (item) => {
        if (item.previewUrl !== item.sourcePreviewUrl)
          releaseUrl(item.previewUrl);
        return { ...item, previewUrl: displayUrl };
      });

      const formData = new FormData();
      formData.append("idempotencyKey", requestKey);
      formData.append("referenceTime", new Date().toISOString());
      formData.append("originalWidth", String(processed.originalWidth));
      formData.append("originalHeight", String(processed.originalHeight));
      formData.append("displayWidth", String(processed.displayWidth));
      formData.append("displayHeight", String(processed.displayHeight));
      formData.append("processingRecipe", options.recipe ?? "manual-card-v1");
      formData.append("original", processed.originalFile);
      formData.append("display", processed.displayFile);

      const requestStartedAt = performance.now();
      updateItem(itemId, (item) => ({
        ...item,
        restorationMessage: "보정된 2D 명함 이미지에서 정보를 읽고 있습니다.",
      }));
      const response = await fetch("/api/business-cards", {
        method: "POST",
        body: formData,
        signal: job.signal,
      });
      const card = await responseJson<BusinessCardSessionView>(response);
      if (!active()) return;
      performance.measure("business-card:upload-and-ocr", {
        start: requestStartedAt,
        end: performance.now(),
      });
      updateItem(itemId, (item) => ({
        ...item,
        card,
        draft: card.draft,
        status: "card_review",
        newDisplayName: card.draft?.identity.displayName ?? "",
        error: null,
        slow: false,
        operation: null,
        pendingRestoration: null,
        restorationState: "restored",
        rotationBase: undefined,
        restorationMessage: "2D 명함 이미지로 OCR 처리를 완료했습니다.",
        pipelineTimings: {
          ...item.pipelineTimings,
          ocrRequestMs: performance.now() - requestStartedAt,
        },
      }));
    } catch (caught) {
      if (!active()) return;
      const message =
        caught instanceof Error
          ? caught.message
          : "명함을 처리하지 못했습니다.";
      const captureId =
        typeof caught === "object" &&
        caught !== null &&
        "captureId" in caught &&
        typeof caught.captureId === "string"
          ? caught.captureId
          : null;
      updateItem(itemId, (item) => ({
        ...item,
        status: "error",
        card: captureId
          ? {
              captureId,
              state: "failed",
              stage: "failed",
              originalAssetId: "",
              displayAssetId: "",
              imageUrl: item.previewUrl,
              draft: item.draft,
              modelDraft: null,
              contextNote: item.contextNote,
              identityCandidates: [],
              userCorrectionCount: 0,
              ocrProvider: null,
              ocrLatencyMs: null,
              lastErrorCode: null,
              commitResult: null,
              createdAt: new Date().toISOString(),
            }
          : item.card,
        error: message,
        slow: false,
        operation: null,
      }));
    } finally {
      window.clearTimeout(slowTimer);
      ocrInFlightRef.current.delete(itemId);
    }
  }

  async function enqueueFiles(
    fileList: FileList | File[],
    imageAcceptedAt = performance.now(),
  ) {
    const files = Array.from(fileList);
    const available = Math.max(0, 5 - items.length);
    if (available === 0) {
      setGlobalError("한 번에 최대 5장의 명함을 처리할 수 있습니다.");
      return;
    }
    const accepted = files.slice(0, available);
    if (files.length > available) {
      setGlobalError(
        `최대 5장까지만 추가되어 ${files.length - available}장은 제외했습니다.`,
      );
    } else {
      setGlobalError(null);
    }

    const nextItems: QueueItem[] = accepted.map((file) => {
      const sourcePreviewUrl = ownedUrl(file);
      return {
        id: crypto.randomUUID(),
        imageAcceptedAt,
        uploadRequestKey: crypto.randomUUID(),
        filename: file.name,
        sourceFile: file,
        sourcePreviewUrl,
        previewUrl: sourcePreviewUrl,
        restoredUrl: null,
        pendingRestoration: null,
        restorationState: "idle",
        restorationMessage: null,
        status: "preparing",
        card: null,
        draft: null,
        contextNote: "",
        identityChoice: null,
        newDisplayName: "",
        result: null,
        error: null,
        slow: false,
        operation: "ocr",
      };
    });
    setItems((current) => [...current, ...nextItems]);
    if (!activeId && nextItems[0]) setActiveId(nextItems[0].id);

    for (const item of nextItems) {
      if (item.sourceFile)
        await uploadItem(item.id, item.sourceFile, item.uploadRequestKey);
    }
  }

  function updateDraft(
    itemId: string,
    updater: (draft: BusinessCardDraftV1) => BusinessCardDraftV1,
  ) {
    updateItem(itemId, (item) =>
      item.draft
        ? {
            ...item,
            draft: (() => {
              const previous = item.draft;
              const next = updater(previous);
              const valueAt = (object: unknown, path: string) =>
                path
                  .split(".")
                  .reduce<unknown>(
                    (value, key) =>
                      value && typeof value === "object"
                        ? (value as Record<string, unknown>)[key]
                        : undefined,
                    object,
                  );
              return {
                ...next,
                inferredFields: next.inferredFields.filter(
                  (path) =>
                    JSON.stringify(valueAt(previous, path)) ===
                    JSON.stringify(valueAt(next, path)),
                ),
              };
            })(),
          }
        : item,
    );
  }

  async function restoreImage(
    itemId: string,
    sourceFile: File,
    corners?: CardCorners,
  ) {
    const job = restorationJobsRef.current.begin(itemId);
    updateItem(itemId, (current) => {
      if (current.restoredUrl) releaseUrl(current.restoredUrl);
      return {
        ...current,
        restoredUrl: null,
        pendingRestoration: null,
        restorationState: "processing",
        restorationMessage: null,
      };
    });
    try {
      const restoration = await restoreBusinessCardImage(sourceFile, corners);
      if (!restorationJobsRef.current.owns(itemId, job.revision)) return;
      if (restoration.kind === "fallback") {
        updateItem(itemId, (current) => ({
          ...current,
          restorationState: "fallback",
          restorationMessage:
            restoration.reason === "no-card-boundary"
              ? "명함 테두리를 안전하게 찾지 못해 기존 표시 이미지를 유지했습니다."
              : "이미지 복원 기능을 불러오지 못해 기존 표시 이미지를 유지했습니다.",
        }));
        return;
      }
      const restoredUrl = ownedUrl(restoration.file);
      updateItem(itemId, (current) => {
        if (!restorationJobsRef.current.owns(itemId, job.revision)) {
          releaseUrl(restoredUrl);
          return current;
        }
        if (current.restoredUrl) releaseUrl(current.restoredUrl);
        return {
          ...current,
          restoredUrl,
          pendingRestoration: restoration,
          restorationState: "preview",
          restorationMessage: null,
        };
      });
    } catch (caught) {
      if (!restorationJobsRef.current.owns(itemId, job.revision)) return;
      updateItem(itemId, (current) => ({
        ...current,
        restorationState: "error",
        restorationMessage:
          caught instanceof Error
            ? `복원 결과를 저장하지 못했습니다: ${caught.message}`
            : "복원 결과를 저장하지 못했습니다.",
      }));
    }
  }

  async function restoreWithManualCorners(
    item: QueueItem,
    corners: CardCorners,
  ) {
    if (item.sourceFile) {
      await restoreImage(item.id, item.sourceFile, corners);
      return;
    }
    if (!item.card?.originalAssetId) return;
    const sourceJob = restorationJobsRef.current.begin(item.id);
    try {
      const response = await fetch(
        `/api/source-assets/${item.card.originalAssetId}`,
      );
      if (!response.ok) throw new Error("촬영 원본을 불러오지 못했습니다.");
      const blob = await response.blob();
      if (!restorationJobsRef.current.owns(item.id, sourceJob.revision)) return;
      const file = new File([blob], "business-card-original", {
        type: blob.type,
      });
      await restoreImage(item.id, file, corners);
    } catch (caught) {
      if (!restorationJobsRef.current.owns(item.id, sourceJob.revision)) return;
      updateItem(item.id, (current) => ({
        ...current,
        restorationState: current.pendingRestoration ? "preview" : "error",
        restorationMessage:
          caught instanceof Error
            ? caught.message
            : "수동 보정을 완료하지 못했습니다.",
      }));
    }
  }

  async function acceptRestoration(item: QueueItem) {
    if (!item.card || !item.pendingRestoration) return;
    updateItem(item.id, (current) => ({
      ...current,
      restorationState: "processing",
      restorationMessage: "확인한 평면 보정 이미지를 저장하고 있습니다.",
    }));
    try {
      const formData = new FormData();
      formData.append("image", item.pendingRestoration.file);
      formData.append(
        "metadata",
        JSON.stringify({
          corners: item.pendingRestoration.corners,
          coverage: item.pendingRestoration.coverage,
        }),
      );
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}/restore-display`,
        { method: "POST", body: formData },
      );
      const card = await responseJson<BusinessCardSessionView>(response);
      updateItem(item.id, (current) => ({
        ...current,
        card,
        pendingRestoration: null,
        restorationState: "restored",
        restorationMessage: null,
      }));
    } catch (caught) {
      updateItem(item.id, (current) => ({
        ...current,
        restorationState: "preview",
        restorationMessage:
          caught instanceof Error
            ? `복원 이미지를 저장하지 못했습니다. ${caught.message}`
            : "복원 이미지를 저장하지 못했습니다.",
      }));
    }
  }

  function rejectRestoration(item: QueueItem) {
    restorationJobsRef.current.cancel(item.id);
    if (item.restoredUrl) releaseUrl(item.restoredUrl);
    updateItem(item.id, (current) => ({
      ...current,
      restoredUrl: null,
      pendingRestoration: null,
      restorationState: "fallback",
      restorationMessage:
        "새 보정 결과를 사용하지 않았습니다. 기존 표시 이미지를 유지합니다.",
    }));
  }

  async function confirmFields(item: QueueItem) {
    if (!item.card || !item.draft) return;
    updateItem(item.id, (current) => ({
      ...current,
      status: "preparing",
      operation: "confirm",
      error: null,
    }));
    try {
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}/confirm-fields`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: item.draft }),
        },
      );
      const card = await responseJson<BusinessCardSessionView>(response);
      updateItem(item.id, (current) => ({
        ...current,
        card,
        draft: card.draft,
        status: "card_result",
        operation: null,
      }));
      if (item.sourceFile && !item.pipelineRecipe)
        void restoreImage(item.id, item.sourceFile);
    } catch (caught) {
      updateItem(item.id, (current) => ({
        ...current,
        status: "card_review",
        operation: null,
        error:
          caught instanceof Error
            ? caught.message
            : "명함 정보를 확정하지 못했습니다.",
      }));
    }
  }

  async function prepareReview(item: QueueItem) {
    const startedAt = performance.now();
    if (item.pendingRestoration || item.restorationState === "processing") {
      updateItem(item.id, (current) => ({
        ...current,
        error:
          "평면 보정 결과를 저장하거나 기존 이미지를 유지한 뒤 진행해 주세요.",
      }));
      return;
    }
    if (
      !item.card ||
      !item.card.fieldsConfirmedAt ||
      !item.draft ||
      item.contextNote.trim().length < 5
    ) {
      updateItem(item.id, (current) => ({
        ...current,
        error: "만남의 맥락을 5자 이상 적어주세요.",
      }));
      return;
    }
    updateItem(item.id, (current) => ({
      ...current,
      status: "preparing",
      error: null,
      slow: false,
      operation: "context",
    }));
    try {
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}/prepare-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draft: item.draft,
            contextNote: item.contextNote,
            referenceTime: new Date().toISOString(),
          }),
        },
      );
      const card = await responseJson<BusinessCardSessionView>(response);
      updateItem(item.id, (current) => ({
        ...current,
        card,
        draft: card.draft,
        status: "memory_review",
        contextElapsedMs: Math.round(performance.now() - startedAt),
        identityChoice: null,
        newDisplayName: card.draft?.identity.displayName ?? "",
        operation: null,
      }));
    } catch (caught) {
      updateItem(item.id, (current) => ({
        ...current,
        status: "card_result",
        error:
          caught instanceof Error
            ? caught.message
            : "맥락을 구조화하지 못했습니다.",
        operation: null,
      }));
    }
  }

  async function refreshCandidates(item: QueueItem) {
    if (!item.card || !item.draft) return;
    updateItem(item.id, (current) => ({ ...current, error: null }));
    try {
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}/candidates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: item.draft }),
        },
      );
      const payload = await responseJson<{
        identityCandidates: BusinessCardSessionView["identityCandidates"];
      }>(response);
      updateItem(item.id, (current) => ({
        ...current,
        card: current.card
          ? { ...current.card, identityCandidates: payload.identityCandidates }
          : current.card,
        identityChoice: null,
      }));
    } catch (caught) {
      updateItem(item.id, (current) => ({
        ...current,
        error:
          caught instanceof Error
            ? caught.message
            : "Identity 후보를 찾지 못했습니다.",
      }));
    }
  }

  async function commit(item: QueueItem) {
    if (!item.card || !item.draft) return;
    if (!item.identityChoice) {
      updateItem(item.id, (current) => ({
        ...current,
        error: "기존 인맥에 연결할지 새 인맥으로 등록할지 선택해 주세요.",
      }));
      return;
    }
    if (
      item.identityChoice.mode === "new" &&
      item.newDisplayName.trim().length === 0
    ) {
      updateItem(item.id, (current) => ({
        ...current,
        error: "새 인맥의 이름을 입력해 주세요.",
      }));
      return;
    }

    updateItem(item.id, (current) => ({
      ...current,
      status: "preparing",
      error: null,
      slow: false,
      operation: "commit",
    }));
    const identity =
      item.identityChoice.mode === "existing"
        ? item.identityChoice
        : {
            mode: "new" as const,
            displayName: item.newDisplayName.trim(),
          };
    try {
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: item.draft, identity }),
        },
      );
      const result = await responseJson<BusinessCardCommitResponse>(response);
      if (result.card.commitResult)
        onSaved?.(result.card.commitResult.personId);
      updateItem(item.id, (current) => ({
        ...current,
        card: result.card,
        result,
        status: "committed",
        operation: null,
      }));
    } catch (caught) {
      updateItem(item.id, (current) => ({
        ...current,
        status: "memory_review",
        error:
          caught instanceof Error
            ? caught.message
            : "명함을 저장하지 못했습니다.",
        operation: null,
      }));
    }
  }

  async function retry(item: QueueItem) {
    const retryStartedAt = performance.now();
    updateItem(item.id, (current) => ({
      ...current,
      imageAcceptedAt: retryStartedAt,
    }));
    if (!item.card?.captureId) {
      if (item.sourceFile)
        await uploadItem(item.id, item.sourceFile, item.uploadRequestKey);
      return;
    }
    if (ocrInFlightRef.current.has(item.id)) return;
    ocrInFlightRef.current.add(item.id);
    updateItem(item.id, (current) => ({
      ...current,
      status: "preparing",
      error: null,
      slow: false,
      operation: "ocr",
    }));
    const slowTimer = window.setTimeout(
      () =>
        updateItem(item.id, (current) => ({
          ...current,
          slow: current.status === "preparing",
        })),
      5_000,
    );
    try {
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestKey: crypto.randomUUID() }),
        },
      );
      const card = await responseJson<BusinessCardSessionView>(response);
      updateItem(item.id, (current) => ({
        ...current,
        card,
        draft: card.draft,
        status: "card_review",
        newDisplayName: card.draft?.identity.displayName ?? "",
        slow: false,
        operation: null,
      }));
    } catch (caught) {
      updateItem(item.id, (current) => ({
        ...current,
        status: "error",
        error:
          caught instanceof Error ? caught.message : "재시도하지 못했습니다.",
        slow: false,
        operation: null,
      }));
    } finally {
      window.clearTimeout(slowTimer);
      ocrInFlightRef.current.delete(item.id);
    }
  }

  async function removeItem(item: QueueItem) {
    restorationJobsRef.current.cancel(item.id);
    if (item.card && item.status !== "committed") {
      const response = await fetch(
        `/api/business-cards/${item.card.captureId}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        setGlobalError("서버의 Draft 이미지를 삭제하지 못했습니다.");
        return;
      }
    }
    if (item.sourceFile) releaseUrl(item.previewUrl);
    if (item.sourcePreviewUrl) releaseUrl(item.sourcePreviewUrl);
    if (item.restoredUrl) releaseUrl(item.restoredUrl);
    setItems((current) =>
      current.filter((candidate) => candidate.id !== item.id),
    );
    if (activeId === item.id) {
      const remaining = items.filter((candidate) => candidate.id !== item.id);
      setActiveId(remaining[0]?.id ?? null);
    }
  }

  async function deleteOriginal(item: QueueItem) {
    const cardId = item.result?.card.commitResult?.businessCardId;
    if (!cardId) return;
    const response = await fetch(
      `/api/business-cards/card/${cardId}/original`,
      { method: "DELETE" },
    );
    updateItem(item.id, (current) => ({
      ...current,
      card:
        response.ok && current.card
          ? { ...current.card, originalAssetId: "" }
          : current.card,
      error: response.ok
        ? "원본 사진은 삭제했고, 디지털 명함은 유지됩니다."
        : "원본 이미지를 삭제하지 못했습니다.",
    }));
  }

  return (
    <section className="business-card-flow space-y-6">
      {testLabOpen ? <CardRecognitionTestLab /> : null}
      <div
        className={`grid gap-6 ${items.length ? "lg:grid-cols-[18rem_minmax(0,1fr)]" : ""}`}
      >
        {items.length > 0 && (
          <aside className="space-y-4">
            <section className="rounded-[1.75rem] border border-[var(--border)] bg-white/85 p-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-[var(--accent)] uppercase">
                진행 중인 명함
              </p>
              <h2 className="mt-2 text-xl font-semibold">
                명함 {items.length}/5
              </h2>
              <div className="mt-5 grid gap-2">
                <button
                  type="button"
                  disabled={items.length >= 5}
                  onClick={() => setCameraOpen(true)}
                  className="rounded-xl bg-[var(--foreground)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  다음 명함 촬영
                </button>
                <button
                  type="button"
                  disabled={items.length >= 5}
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-[var(--border-strong)] bg-white px-4 py-3 text-sm font-semibold disabled:opacity-40"
                >
                  다음 이미지 선택
                </button>
              </div>
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                한 사진에는 명함 한 장만 담아주세요. 여러 파일은 각각 독립적으로
                순차 처리됩니다.
              </p>
            </section>

            <ol className="space-y-2" aria-label="등록 중인 명함">
              {items.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(item.id)}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      item.id === activeId
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--border)] bg-white/75"
                    }`}
                  >
                    <span className="block text-xs text-[var(--muted)]">
                      {String(index + 1).padStart(2, "0")} ·{" "}
                      {queueStatusLabel(item.status)}
                    </span>
                    <span className="mt-1 block truncate text-sm font-semibold">
                      {item.draft?.identity.displayName ?? item.filename}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}

        <div>
          {!activeItem ? (
            <EmptyCardCapture
              ocrMode={ocrMode}
              onCamera={() => setCameraOpen(true)}
              onUpload={() => fileInputRef.current?.click()}
            />
          ) : activeItem.status === "boundary_review" &&
            activeItem.sourceFile ? (
            <BoundaryReview
              key={activeItem.id}
              item={activeItem}
              onRotate={() => void rotateItem(activeItem)}
              onManual={(corners) =>
                void uploadItem(
                  activeItem.id,
                  activeItem.sourceFile!,
                  activeItem.uploadRequestKey,
                  { corners },
                )
              }
              onAccept={() =>
                activeItem.pendingRestoration &&
                void uploadItem(
                  activeItem.id,
                  activeItem.sourceFile!,
                  activeItem.uploadRequestKey,
                  {
                    acceptedFile: activeItem.pendingRestoration.file,
                    recipe: activeItem.pipelineRecipe,
                  },
                )
              }
              onRemove={() => void removeItem(activeItem)}
            />
          ) : (
            <CardWorkItem
              key={activeItem.id}
              item={activeItem}
              ocrMode={ocrMode}
              updateItem={updateItem}
              updateDraft={updateDraft}
              confirmFields={confirmFields}
              acceptRestoration={acceptRestoration}
              rejectRestoration={rejectRestoration}
              restoreWithManualCorners={restoreWithManualCorners}
              prepareReview={prepareReview}
              refreshCandidates={refreshCandidates}
              commit={commit}
              retry={retry}
              removeItem={removeItem}
              deleteOriginal={deleteOriginal}
              onViewPerson={onViewPerson}
              onFindMemory={onFindMemory}
            />
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        aria-label="명함 이미지 선택"
        onChange={(event) => {
          if (event.target.files) void enqueueFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {globalError ? (
        <p
          role="alert"
          className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {globalError}
        </p>
      ) : null}

      {cameraOpen ? (
        <BusinessCardCamera
          onClose={() => setCameraOpen(false)}
          onCapture={(file, imageAcceptedAt) => {
            void enqueueFiles([file], imageAcceptedAt).catch(
              (error: unknown) => {
                setGlobalError(
                  error instanceof Error
                    ? error.message
                    : "명함 등록을 시작하지 못했습니다.",
                );
              },
            );
          }}
        />
      ) : null}
    </section>
  );
}

function BoundaryReview({
  item,
  onRotate,
  onManual,
  onAccept,
  onRemove,
}: {
  item: QueueItem;
  onRotate: () => void;
  onManual: (corners: CardCorners) => void;
  onAccept: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section
      aria-label="명함 테두리·2D 이미지 확인"
      className="rounded-2xl border border-[var(--border)] bg-white p-6"
    >
      <h2 className="text-xl font-semibold">명함 테두리·2D 이미지 확인</h2>
      <p role="status" className="my-3 text-sm">
        {item.restorationMessage}
      </p>
      <p className="mb-4 text-xs text-[var(--muted)]">
        촬영 → LC100 외곽 감지 → 원근 보정 → 이미지 확인 → OCR. 가로·세로 비율은
        추정값입니다.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3>촬영 원본·검출 테두리</h3>
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.sourcePreviewUrl!}
              alt="LC100 검출 촬영 원본"
              className="max-h-96 max-w-full"
            />
            {item.boundaryCorners && (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full"
                aria-label="검출한 명함 테두리"
              >
                <polygon
                  points={item.boundaryCorners
                    .map((p) => `${p.x * 100},${p.y * 100}`)
                    .join(" ")}
                  fill="#00e67622"
                  stroke="#00b050"
                  strokeWidth="0.6"
                />
              </svg>
            )}
          </div>
        </div>
        <div>
          <h3>정면 2D 명함 이미지</h3>
          {item.restoredUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.restoredUrl}
                alt="OCR에 사용할 2D 명함 이미지"
                className="max-h-96 max-w-full"
              />
              <a
                href={item.restoredUrl}
                download="rectified-business-card.jpg"
                className="text-sm underline"
              >
                2D 명함 JPEG 다운로드
              </a>
              <button
                type="button"
                disabled={item.rotationBusy}
                onClick={onRotate}
                className="ml-3 rounded-xl border px-3 py-2 text-sm disabled:opacity-40"
              >
                오른쪽으로 90도 회전
              </button>
              <p className="mt-2 text-xs text-[var(--muted)]">
                글자가 옆으로 있거나 뒤집혔다면 회전하세요. 회전한 이미지로
                OCR을 실행합니다.
              </p>
            </>
          ) : (
            <p className="my-4 text-sm">
              모서리를 직접 지정하면 보정 이미지를 만들 수 있습니다.
            </p>
          )}
        </div>
      </div>
      {item.pipelineTimings && (
        <pre
          aria-label="명함 단계별 처리 시간"
          className="my-4 whitespace-pre-wrap text-xs"
        >
          {Object.entries(item.pipelineTimings)
            .map(([key, value]) => `${key}: ${value.toFixed(1)}ms`)
            .join(" · ")}
        </pre>
      )}
      <div className="my-4 flex flex-wrap gap-3">
        <button
          disabled={!item.pendingRestoration || item.rotationBusy}
          onClick={onAccept}
          className="rounded-xl bg-[var(--foreground)] px-4 py-3 text-white disabled:opacity-40"
        >
          이 2D 이미지로 OCR 실행
        </button>
        <button
          disabled={item.rotationBusy}
          onClick={() => setEditing(true)}
          className="rounded-xl border px-4 py-3"
        >
          OCR 전 모서리 직접 지정
        </button>
        <button onClick={onRemove} className="rounded-xl border px-4 py-3">
          목록에서 제거
        </button>
      </div>
      {(editing || !item.pendingRestoration) && (
        <CardCornerEditor
          imageUrl={item.sourcePreviewUrl!}
          seedCorners={item.boundaryCorners}
          busy={Boolean(item.rotationBusy)}
          onApply={onManual}
          onCancel={() => setEditing(false)}
        />
      )}
    </section>
  );
}

function EmptyCardCapture({
  ocrMode,
  onCamera,
  onUpload,
}: {
  ocrMode: "mock" | "live";
  onCamera: () => void;
  onUpload: () => void;
}) {
  return (
    <section className="card-capture-empty grid min-h-[31rem] place-items-center rounded-[2rem] border border-dashed border-[var(--border-strong)] bg-white/65 p-8 text-center">
      <div>
        <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-[var(--accent-soft)] text-2xl">
          ◫
        </div>
        <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
          첫 명함을 디지털 카드로
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--muted)]">
          명함 한 장을 촬영하거나 업로드하세요. 이름과 연락처를 확인하고, 어디서
          만났는지 함께 남길 수 있어요.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onCamera}
            className="rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white"
          >
            명함 촬영
          </button>
          <button
            type="button"
            onClick={onUpload}
            className="rounded-full border border-[var(--border-strong)] bg-white px-6 py-3 text-sm font-semibold"
          >
            이미지 업로드
          </button>
        </div>
        <p className="mt-6 text-xs text-[var(--draft)]">
          {ocrMode === "live"
            ? "AI가 명함을 읽고 정보를 정리합니다. 직접 확인한 뒤에만 인맥으로 저장됩니다."
            : "현재 Mock OCR이며, 추출값은 실제 이미지와 다를 수 있습니다."}
        </p>
      </div>
    </section>
  );
}

interface CardWorkItemProps {
  item: QueueItem;
  ocrMode: "mock" | "live";
  updateItem: (id: string, updater: (item: QueueItem) => QueueItem) => void;
  updateDraft: (
    id: string,
    updater: (draft: BusinessCardDraftV1) => BusinessCardDraftV1,
  ) => void;
  confirmFields: (item: QueueItem) => Promise<void>;
  acceptRestoration: (item: QueueItem) => Promise<void>;
  rejectRestoration: (item: QueueItem) => void;
  restoreWithManualCorners: (
    item: QueueItem,
    corners: CardCorners,
  ) => Promise<void>;
  prepareReview: (item: QueueItem) => Promise<void>;
  refreshCandidates: (item: QueueItem) => Promise<void>;
  commit: (item: QueueItem) => Promise<void>;
  retry: (item: QueueItem) => Promise<void>;
  removeItem: (item: QueueItem) => Promise<void>;
  deleteOriginal: (item: QueueItem) => Promise<void>;
  onViewPerson: (personId: string) => void;
  onFindMemory: (question: string) => void;
}

function CardWorkItem(props: CardWorkItemProps) {
  const {
    item,
    ocrMode,
    updateItem,
    updateDraft,
    confirmFields,
    acceptRestoration,
    rejectRestoration,
    restoreWithManualCorners,
    prepareReview,
    refreshCandidates,
    commit,
    retry,
    removeItem,
    deleteOriginal,
    onViewPerson,
    onFindMemory,
  } = props;
  const imageUrl = item.restoredUrl || item.card?.imageUrl || item.previewUrl;
  const originalUrl = item.card?.originalAssetId
    ? `/api/source-assets/${item.card.originalAssetId}`
    : undefined;
  const measuredAttempts = useRef(new Set<string>());
  const [cornerEditorOpen, setCornerEditorOpen] = useState(false);

  useEffect(() => {
    if (
      item.status !== "error" &&
      (item.status !== "card_review" || !item.draft)
    )
      return;
    const attempt = `${item.id}:${item.imageAcceptedAt}`;
    if (measuredAttempts.current.has(attempt)) return;
    const frame = requestAnimationFrame(() => {
      if (measuredAttempts.current.has(attempt)) return;
      measuredAttempts.current.add(attempt);
      performance.measure(
        item.status === "error"
          ? "business-card:confirm-to-failure"
          : "business-card:confirm-to-editable",
        {
          start: item.imageAcceptedAt,
          end: performance.now(),
        },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [item.id, item.imageAcceptedAt, item.status, item.draft]);

  if (item.status === "error" && !item.draft) {
    return (
      <section className="rounded-[2rem] border border-[var(--border)] bg-white/85 p-6 sm:p-8">
        <div className="aspect-[1.586/1] overflow-hidden rounded-2xl bg-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="처리할 명함"
            className="size-full object-contain"
          />
        </div>
        <p
          role="alert"
          className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {item.error}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => void retry(item)}
            className="rounded-xl bg-[var(--foreground)] px-5 py-3 text-sm font-semibold text-white"
          >
            같은 명함으로 다시 시도
          </button>
          <button
            type="button"
            onClick={() => void removeItem(item)}
            className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm"
          >
            목록에서 제거
          </button>
        </div>
      </section>
    );
  }

  if (!item.draft || item.status === "preparing") {
    return (
      <section className="grid min-h-[31rem] place-items-center rounded-[2rem] border border-[var(--border)] bg-white/75 p-8 text-center">
        <div>
          <div className="mx-auto size-10 animate-spin rounded-full border-4 border-[var(--accent-soft)] border-t-[var(--accent)]" />
          <h2 className="mt-5 text-xl font-semibold">
            {item.operation === "confirm"
              ? "확인한 명함 정보를 저장하고 있습니다"
              : item.operation === "context"
                ? "만남의 맥락을 구조화하고 있습니다"
                : item.operation === "commit"
                  ? "인맥과 만남 기록을 저장하고 있습니다"
                  : "명함을 디지털화하고 있습니다"}
          </h2>
          {item.operation === "ocr" && (
            <p role="status" className="mt-3 text-sm">
              {item.restorationMessage ?? "촬영 이미지를 준비하고 있습니다."}
            </p>
          )}
          <p className="mt-2 text-sm text-[var(--muted)]">
            {item.operation === "confirm"
              ? "인식한 필드만 저장하며 관계 기억은 아직 만들지 않습니다."
              : item.operation === "context"
                ? "만남 · 관심사 · 기억 · 약속 검토"
                : item.operation === "commit"
                  ? "인물 확인 · 기억 저장"
                  : "이미지 처리 · 안전하게 저장 · " +
                    ocrProviderLabel(item.card?.ocrProvider, ocrMode)}
          </p>
          {item.slow && item.operation === "ocr" ? (
            <p role="status" className="mt-3 text-xs text-amber-700">
              인식이 평소보다 오래 걸리고 있습니다. 최대 12초까지 기다린 뒤 같은
              이미지로 재시도할 수 있습니다.
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  if (item.status === "committed" && item.result?.card.commitResult) {
    const result = item.result;
    const commitResult = item.result.card.commitResult;
    return (
      <section className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
          <CardViewer
            imageUrl={imageUrl}
            originalUrl={originalUrl}
            label="저장한 디지털 명함"
          />
          <div className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--confirmed-soft)] text-xl text-[var(--confirmed)]">
              ✓
            </div>
            <p className="mt-5 text-sm font-semibold text-[var(--confirmed)]">
              인맥과 만남 기록 저장 완료
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
              명함과 관계 맥락이 연결됐습니다.
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              연락처와 관계 기억, 명함 이미지가 저장되었습니다.
              {result.memoryDocumentStatus === "failed"
                ? " 검색 준비는 완료되지 않았습니다. 기억은 보존되어 있으므로 다시 저장할 필요는 없습니다."
                : ""}
            </p>
            <div className="mt-6 grid gap-2">
              <button
                type="button"
                onClick={() => onViewPerson(commitResult.personId)}
                className="rounded-xl bg-[var(--accent)] px-5 py-3 text-center text-sm font-semibold text-white"
              >
                인맥 프로필 보기
              </button>
              <button
                type="button"
                onClick={() => onFindMemory(result.recallQuery)}
                className="rounded-xl border border-[var(--border-strong)] px-5 py-3 text-center text-sm font-semibold"
              >
                방금 저장한 기억 찾아보기
              </button>
              <button
                type="button"
                onClick={() => void deleteOriginal(item)}
                className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm text-[var(--muted)]"
              >
                원본 사진만 삭제
              </button>
            </div>
          </div>
        </div>
        {item.error ? (
          <p
            role="status"
            className="rounded-xl bg-[var(--accent-soft)] p-4 text-sm text-[var(--accent)]"
          >
            {item.error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(21rem,0.95fr)]">
        <div>
          <CardViewer
            imageUrl={imageUrl}
            originalUrl={
              item.status === "card_review" ? undefined : originalUrl
            }
            label={
              item.status === "card_review"
                ? item.pipelineRecipe
                  ? "2D 명함 이미지"
                  : "촬영한 명함"
                : "디지털 명함 이미지"
            }
          />
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--muted)]">
            <span>
              이미지 처리 완료 ·{" "}
              {ocrProviderLabel(item.card?.ocrProvider, ocrMode)}
            </span>
            <button
              type="button"
              onClick={() => void removeItem(item)}
              className="rounded-full border border-[var(--border)] px-3 py-1.5"
            >
              이 명함 삭제
            </button>
          </div>
        </div>
        {item.status === "card_review" ? (
          <CardIdentityEditor
            draft={item.draft}
            providerLabel={ocrProviderLabel(item.card?.ocrProvider, ocrMode)}
            onChange={(updater) => updateDraft(item.id, updater)}
            onNameChange={(value) =>
              updateItem(item.id, (current) => ({
                ...current,
                newDisplayName: value,
              }))
            }
          />
        ) : (
          <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6">
            <p className="text-sm font-semibold text-[var(--accent)]">
              확인한 명함 정보
            </p>
            <h2 className="mt-2 text-xl font-semibold">
              {item.draft.identity.displayName ?? "이름 없음"}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {[item.draft.identity.organizationName, item.draft.identity.title]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
              확인한 연락처 정보는 명함 이미지와 분리해 보존합니다.
            </p>
            <ContactNumberList identity={item.draft.identity} />
          </section>
        )}
      </div>

      {item.status === "card_review" ? (
        <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
          <h2 className="text-xl font-semibold">추출 정보를 확인해 주세요</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            이름과 연락처를 고친 뒤 OK를 누르세요. 인맥과 만남 기록은 다음
            단계에서 따로 저장합니다.
          </p>
          <button
            type="button"
            onClick={() => void confirmFields(item)}
            className="mt-5 rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white"
          >
            OK · 추출 정보 확정
          </button>
        </section>
      ) : null}

      {item.status === "card_result" ? (
        <p
          role="status"
          className="rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--accent)]"
        >
          {item.restorationState === "processing"
            ? "평면 보정 이미지를 준비하고 있습니다. 촬영 이미지는 먼저 볼 수 있습니다."
            : item.restorationState === "preview"
              ? "평면 보정 미리보기를 확인하세요. 명함 전체가 보일 때만 저장해 주세요."
              : item.restorationState === "restored"
                ? "명함 테두리를 보정한 이미지를 저장했습니다. 원본과 전환해 볼 수 있습니다."
                : (item.restorationMessage ?? "추출 정보를 확인했습니다.")}
        </p>
      ) : null}

      {item.status === "card_result" && item.restorationState === "preview" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void acceptRestoration(item)}
            className="rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            이 보정 이미지 저장
          </button>
          <button
            type="button"
            onClick={() => rejectRestoration(item)}
            className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm"
          >
            기존 이미지 유지
          </button>
        </div>
      ) : null}

      {item.status === "card_result" && item.card?.originalAssetId ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setCornerEditorOpen((open) => !open)}
            className="rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm"
          >
            {cornerEditorOpen ? "모서리 지정 닫기" : "명함 모서리 직접 지정"}
          </button>
          {cornerEditorOpen ? (
            <CardCornerEditor
              imageUrl={
                item.sourcePreviewUrl ??
                `/api/source-assets/${item.card.originalAssetId}`
              }
              busy={item.restorationState === "processing"}
              onApply={(corners) => {
                setCornerEditorOpen(false);
                void restoreWithManualCorners(item, corners);
              }}
              onCancel={() => setCornerEditorOpen(false)}
            />
          ) : null}
        </div>
      ) : null}

      {item.status === "card_result" ? (
        <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--accent)]">
                2. 만남 맥락
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                이 사람을 어디서, 왜 만났나요?
              </h2>
            </div>
            <button
              type="button"
              onClick={() =>
                updateItem(item.id, (current) => ({
                  ...current,
                  contextNote: contextSample,
                }))
              }
              className="rounded-full border border-[var(--border)] px-3 py-2 text-xs"
            >
              예시 맥락 채우기
            </button>
          </div>
          <textarea
            value={item.contextNote}
            onChange={(event) =>
              updateItem(item.id, (current) => ({
                ...current,
                contextNote: event.target.value,
                error: null,
              }))
            }
            rows={5}
            maxLength={5_000}
            placeholder="만난 행사, 장소, 이야기한 주제와 후속 약속을 편하게 적어주세요."
            className="mt-5 w-full resize-y rounded-2xl border border-[var(--border-strong)] bg-[var(--background)] p-4 leading-7 outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            disabled={
              item.contextNote.trim().length < 5 ||
              item.restorationState === "preview" ||
              item.restorationState === "processing"
            }
            onClick={() => void prepareReview(item)}
            className="mt-4 rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            맥락 분석하고 연결 후보 찾기
          </button>
        </section>
      ) : null}

      {item.status === "memory_review" ? (
        <>
          {item.contextElapsedMs !== undefined ? (
            <p className="text-sm text-[var(--muted)]">
              맥락 제출부터 검토 준비까지{" "}
              {(item.contextElapsedMs / 1000).toFixed(1)}초
            </p>
          ) : null}
          <MemoryReviewEditor
            draft={item.draft}
            onChange={(updater) => updateDraft(item.id, updater)}
          />
          <IdentityDecision
            item={item}
            updateItem={updateItem}
            refreshCandidates={refreshCandidates}
          />
          <section className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-strong)] bg-white/95 p-4 shadow-[0_20px_70px_rgba(24,45,32,0.14)] backdrop-blur">
            <p className="text-xs leading-5 text-[var(--muted)]">
              저장하면 인맥 프로필과 AI 검색에서 이 기록을 찾을 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => void commit(item)}
              className="rounded-xl bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white"
            >
              확인하고 인맥에 저장
            </button>
          </section>
        </>
      ) : null}

      {item.error ? (
        <p
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {item.error}
        </p>
      ) : null}
    </section>
  );
}

function nullable(value: string): string | null {
  return value.trim() ? value : null;
}

function splitValues(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function CardIdentityEditor({
  draft,
  providerLabel,
  onChange,
  onNameChange,
}: {
  draft: BusinessCardDraftV1;
  providerLabel: string;
  onChange: (
    updater: (draft: BusinessCardDraftV1) => BusinessCardDraftV1,
  ) => void;
  onNameChange: (value: string) => void;
}) {
  const fields = [
    ["displayName", "이름"],
    ["organizationName", "회사·조직"],
    ["department", "부서"],
    ["title", "직책"],
    ["address", "주소"],
  ] as const;

  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">인식한 명함 정보</h2>
        <span className="rounded-full bg-[var(--draft-soft)] px-3 py-1 text-[10px] font-semibold text-[var(--draft)]">
          {providerLabel} · 수정 가능
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {fields
          .filter(([field]) => field !== "address" && field !== "department")
          .map(([field, label]) => (
            <label
              key={field}
              className={field === "address" ? "sm:col-span-2" : ""}
            >
              <span className="text-sm font-semibold text-[var(--foreground)]">
                {label}
              </span>
              <input
                value={draft.identity[field] ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange((current) => ({
                    ...current,
                    identity: { ...current.identity, [field]: nullable(value) },
                  }));
                  if (field === "displayName") onNameChange(value);
                }}
                className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
          ))}
      </div>
      <div className="mt-4 grid gap-3">
        {(
          [
            ["emails", "이메일"],
            ["websites", "웹사이트"],
          ] as const
        )
          .filter(([field]) => field !== "websites")
          .map(([field, label]) => (
            <label key={field}>
              <span className="text-sm font-semibold text-[var(--foreground)]">
                {label} · 여러 값은 줄바꿈
              </span>
              <textarea
                rows={draft.identity[field].length > 1 ? 2 : 1}
                value={draft.identity[field].join("\n")}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    identity: {
                      ...current.identity,
                      [field]: splitValues(event.target.value),
                    },
                  }))
                }
                className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
          ))}
      </div>
      <ContactNumberFields
        identity={draft.identity}
        onChange={(contactNumbers, phones) =>
          onChange((current) => ({
            ...current,
            identity: { ...current.identity, contactNumbers, phones },
          }))
        }
      />
      <details className="mt-5 rounded-xl border border-[var(--border)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">
          추가 정보 · 부서, 웹사이트, 주소
        </summary>
        <div className="mt-4 grid gap-3">
          {(["department", "address"] as const).map((field) => (
            <label key={field}>
              <span className="text-sm font-medium text-[var(--muted)]">
                {field === "department" ? "부서" : "주소"}
              </span>
              <input
                value={draft.identity[field] ?? ""}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    identity: {
                      ...current.identity,
                      [field]: nullable(event.target.value),
                    },
                  }))
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
          ))}
          <label>
            <span className="text-sm font-medium text-[var(--muted)]">
              웹사이트 · 여러 개는 줄바꿈
            </span>
            <textarea
              rows={Math.max(1, draft.identity.websites.length)}
              value={draft.identity.websites.join("\n")}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  identity: {
                    ...current.identity,
                    websites: splitValues(event.target.value),
                  },
                }))
              }
              className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>
      </details>
    </section>
  );
}

function toDateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() + 9 * 60 * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string): string | null {
  return value ? new Date(`${value}+09:00`).toISOString() : null;
}

function MemoryReviewEditor({
  draft,
  onChange,
}: {
  draft: BusinessCardDraftV1;
  onChange: (
    updater: (draft: BusinessCardDraftV1) => BusinessCardDraftV1,
  ) => void;
}) {
  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            3. Memory Review
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            구조화된 관계 맥락을 확인하세요
          </h2>
        </div>
        <span className="rounded-full bg-[var(--draft-soft)] px-3 py-1 text-xs font-medium text-[var(--draft)]">
          검토 중 · 아직 저장되지 않음
        </span>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-sm font-semibold">
            만남 요약
            <InferenceHint
              fields={draft.inferredFields}
              path="interaction.summary"
            />
          </span>
          <textarea
            value={draft.interaction.summary}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                interaction: {
                  ...current.interaction,
                  summary: event.target.value,
                },
              }))
            }
            rows={3}
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-3 text-sm leading-6 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label>
          <span className="text-sm font-semibold">
            만난 시점 (모르면 비워두세요)
            <InferenceHint
              fields={draft.inferredFields}
              path="interaction.occurredAt"
            />
          </span>
          <input
            type="datetime-local"
            value={toDateTimeInput(draft.interaction.occurredAt)}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                interaction: {
                  ...current.interaction,
                  occurredAt: fromDateTimeInput(event.target.value),
                },
              }))
            }
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2.5 text-sm"
          />
        </label>
        <label>
          <span className="text-sm font-semibold">만남 유형</span>
          <select
            value={draft.interaction.interactionType}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                interaction: {
                  ...current.interaction,
                  interactionType: event.target
                    .value as BusinessCardDraftV1["interaction"]["interactionType"],
                },
              }))
            }
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2.5 text-sm"
          >
            <option value="meeting">미팅</option>
            <option value="event">행사</option>
            <option value="call">통화</option>
            <option value="message">메시지</option>
            <option value="email">이메일</option>
            <option value="note">메모</option>
          </select>
        </label>
        <label>
          <span className="text-sm font-semibold">
            장소
            <InferenceHint
              fields={draft.inferredFields}
              path="interaction.location"
            />
          </span>
          <input
            value={draft.interaction.location ?? ""}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                interaction: {
                  ...current.interaction,
                  location: nullable(event.target.value),
                },
              }))
            }
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2.5 text-sm"
          />
        </label>
        <label>
          <span className="text-sm font-semibold">
            행사
            <InferenceHint
              fields={draft.inferredFields}
              path="interaction.eventName"
            />
          </span>
          <input
            value={draft.interaction.eventName ?? ""}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                interaction: {
                  ...current.interaction,
                  eventName: nullable(event.target.value),
                },
              }))
            }
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2.5 text-sm"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm font-semibold">
            주제 · 쉼표로 구분
            <InferenceHint fields={draft.inferredFields} path="topics" />
          </span>
          <input
            value={draft.topics.join(", ")}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                topics: splitValues(event.target.value).slice(0, 12),
              }))
            }
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2.5 text-sm"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm font-semibold">
            기억 · 한 줄에 하나
            <InferenceHint fields={draft.inferredFields} path="memories" />
          </span>
          <textarea
            rows={Math.max(2, draft.memories.length)}
            value={draft.memories.map((memory) => memory.body).join("\n")}
            onChange={(event) => {
              const bodies = event.target.value
                .split(/\r?\n/)
                .map((body) => body.trim())
                .filter(Boolean)
                .slice(0, 12);
              onChange((current) => ({
                ...current,
                memories: bodies.map((body, index) => ({
                  statementType:
                    current.memories[index]?.statementType ?? "context",
                  body,
                  occurredAt:
                    current.memories[index]?.occurredAt ??
                    current.interaction.occurredAt,
                })),
              }));
            }}
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-3 text-sm leading-6"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm font-semibold">
            후속 행동·약속 · 한 줄에 하나
            <InferenceHint fields={draft.inferredFields} path="actions" />
          </span>
          <textarea
            rows={Math.max(2, draft.actions.length)}
            value={draft.actions.map((action) => action.title).join("\n")}
            onChange={(event) => {
              const titles = event.target.value
                .split(/\r?\n/)
                .map((title) => title.trim())
                .filter(Boolean)
                .slice(0, 8);
              onChange((current) => ({
                ...current,
                actions: titles.map((title, index) => ({
                  kind: current.actions[index]?.kind ?? "follow_up",
                  title,
                  details: current.actions[index]?.details ?? null,
                  dueAt: current.actions[index]?.dueAt ?? null,
                })),
              }));
            }}
            className="mt-2 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] p-3 text-sm leading-6"
          />
        </label>
        {draft.actions.map((action, index) => (
          <label key={index} className="sm:col-span-2">
            <span className="text-sm font-semibold">
              {action.title} — 기한 (모르면 비워두세요)
            </span>
            <input
              type="datetime-local"
              value={toDateTimeInput(action.dueAt)}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  actions: current.actions.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          dueAt: fromDateTimeInput(event.target.value),
                        }
                      : item,
                  ),
                }))
              }
              className="mt-2 block w-full rounded-xl border border-[var(--border-strong)] bg-[var(--background)] px-3 py-2.5 text-sm"
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function IdentityDecision({
  item,
  updateItem,
  refreshCandidates,
}: Pick<CardWorkItemProps, "item" | "updateItem" | "refreshCandidates">) {
  const candidates = item.card?.identityCandidates ?? [];

  return (
    <section className="rounded-[2rem] border border-[var(--border)] bg-white/90 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--accent)]">
            4. Identity
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            누구의 명함인지 직접 결정하세요
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refreshCandidates(item)}
          className="rounded-full border border-[var(--border-strong)] px-4 py-2 text-xs font-semibold"
        >
          수정값으로 후보 다시 찾기
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        이메일·전화 정확 일치도 후보 신호일 뿐 자동 병합하지 않습니다.
      </p>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {candidates.map((candidate) => (
          <label
            key={candidate.personId}
            className="flex cursor-pointer gap-3 rounded-2xl border border-[var(--border)] p-4"
          >
            <input
              type="radio"
              name={`identity-${item.id}`}
              checked={
                item.identityChoice?.mode === "existing" &&
                item.identityChoice.personId === candidate.personId
              }
              onChange={() =>
                updateItem(item.id, (current) => ({
                  ...current,
                  identityChoice: {
                    mode: "existing",
                    personId: candidate.personId,
                  },
                  error: null,
                }))
              }
            />
            <span>
              <span className="block font-semibold">
                {candidate.displayName}
              </span>
              <span className="mt-1 block text-xs text-[var(--muted)]">
                {[candidate.organizationName, candidate.organizationTitle]
                  .filter(Boolean)
                  .join(" · ") || "소속 정보 없음"}
              </span>
              <span className="mt-2 flex flex-wrap gap-1">
                {candidate.signals.map((signal) => (
                  <span
                    key={signal}
                    className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[10px] text-[var(--accent)]"
                  >
                    {signal}
                  </span>
                ))}
              </span>
            </span>
          </label>
        ))}

        <label className="flex cursor-pointer gap-3 rounded-2xl border border-[var(--border)] p-4">
          <input
            type="radio"
            name={`identity-${item.id}`}
            checked={item.identityChoice?.mode === "new"}
            onChange={() =>
              updateItem(item.id, (current) => ({
                ...current,
                identityChoice: { mode: "new" },
                error: null,
              }))
            }
          />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">신규 Person 생성</span>
            <span className="mt-1 block text-xs text-[var(--muted)]">
              OCR 결과와 별개의 새 Identity로 저장
            </span>
            <input
              value={item.newDisplayName}
              onChange={(event) =>
                updateItem(item.id, (current) => ({
                  ...current,
                  newDisplayName: event.target.value,
                }))
              }
              onClick={(event) => event.stopPropagation()}
              className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              aria-label="신규 Person 이름"
            />
          </span>
        </label>
      </div>
    </section>
  );
}
