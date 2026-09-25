import "server-only";

import { randomUUID } from "node:crypto";

import type { BusinessCardExtractionV1 } from "../../domain/business-card/business-card-draft";
import {
  ClovaNameCardResponseError,
  extractClovaNameCard,
} from "../../domain/business-card/clova-name-card";
import { AiTaskExecutionError, type AiTaskAdapter } from "./runtime-router";

export interface BusinessCardOcrInput {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  sha256: string;
}

function clovaFormat(mimeType: string): "jpg" | "png" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";

  throw new AiTaskExecutionError(
    "CLOVA Business Card OCR supports JPEG and PNG images.",
    "CLOVA_IMAGE_FORMAT_UNSUPPORTED",
    false,
  );
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function providerErrorCode(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).code !== "string"
  ) {
    return null;
  }

  const code = (payload as Record<string, unknown>).code as string;
  return /^[0-9]{4}$/.test(code) ? code : null;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function resolveClovaNameCardInvokeUrl(invokeUrl: string): string {
  const url = new URL(invokeUrl);
  if (url.protocol !== "https:") {
    throw new AiTaskExecutionError(
      "CLOVA OCR requires an HTTPS Invoke URL.",
      "CLOVA_INVOKE_URL_INVALID",
      false,
    );
  }

  if (url.pathname.endsWith("/document/name-card")) {
    return url.toString();
  }

  if (url.pathname.endsWith("/general")) {
    return url.toString();
  }

  throw new AiTaskExecutionError(
    "CLOVA OCR Invoke URL must target General OCR or Business Card OCR.",
    "CLOVA_INVOKE_URL_UNSUPPORTED",
    false,
  );
}

export function createClovaBusinessCardAdapter(input: {
  invokeUrl: string;
  secret: string;
  beforeRequest?: () => Promise<void>;
}): AiTaskAdapter<BusinessCardOcrInput> {
  return {
    async execute({ input: image, signal }): Promise<BusinessCardExtractionV1> {
      const format = clovaFormat(image.mimeType);
      const requestId = randomUUID();
      const form = new FormData();
      form.append(
        "message",
        JSON.stringify({
          version: "V2",
          requestId,
          timestamp: Date.now(),
          images: [
            { format, name: `business-card-${image.sha256.slice(0, 12)}` },
          ],
        }),
      );
      form.append(
        "file",
        new Blob([ownedArrayBuffer(image.bytes)], { type: image.mimeType }),
        `business-card.${format}`,
      );

      const requestUrl = resolveClovaNameCardInvokeUrl(input.invokeUrl);
      if (input.beforeRequest) {
        try {
          await input.beforeRequest();
        } catch {
          throw new AiTaskExecutionError(
            "OCR cost guard refused to start the provider request.",
            "OCR_GUARD_UNAVAILABLE",
            false,
          );
        }
      }

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: { "X-OCR-SECRET": input.secret },
          body: form,
          signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }

        throw new AiTaskExecutionError(
          "CLOVA OCR request could not reach the API.",
          "CLOVA_NETWORK_ERROR",
          true,
        );
      }

      const body = await response.text();
      let payload: unknown;

      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        throw new AiTaskExecutionError(
          "CLOVA OCR returned a non-JSON response.",
          `CLOVA_HTTP_${response.status}_INVALID_JSON`,
          retryableStatus(response.status),
        );
      }

      if (!response.ok) {
        const providerCode = providerErrorCode(payload);
        throw new AiTaskExecutionError(
          `CLOVA OCR request failed with HTTP ${response.status}.`,
          [
            `CLOVA_HTTP_${response.status}`,
            providerCode ? `CODE_${providerCode}` : null,
          ]
            .filter(Boolean)
            .join("_"),
          retryableStatus(response.status),
        );
      }

      try {
        return extractClovaNameCard(payload);
      } catch (error) {
        if (error instanceof ClovaNameCardResponseError) {
          throw new AiTaskExecutionError(
            error.message,
            error.code,
            error.retryable,
          );
        }
        throw error;
      }
    },
  };
}
