import "server-only";

import { randomUUID } from "node:crypto";

import {
  clovaOcrCostPolicy,
  evaluateOcrCostPolicy,
  type OcrCostLimitCode,
} from "../ai/ocr-cost-policy";
import { getDatabase } from "./client";

export const clovaBusinessCardProviderScope =
  "naver_clova:business-card-extraction-v1";

export interface OcrProviderReservation {
  id: string;
}

export class OcrCostLimitError extends Error {
  constructor(
    public readonly code:
      OcrCostLimitCode | "OCR_DUPLICATE_IN_PROGRESS" | "OCR_DUPLICATE_REQUEST",
    public readonly retryAfterSeconds: number,
  ) {
    super("OCR provider request was blocked by the application cost guard.");
    this.name = "OcrCostLimitError";
  }
}

export class OcrCostGuardUnavailableError extends Error {
  constructor() {
    super("OCR cost guard storage is unavailable.");
    this.name = "OcrCostGuardUnavailableError";
  }
}

interface UsageRow {
  latest_reservation_at: Date | string | null;
  recent_reservations: number | string;
  oldest_recent_reservation_at: Date | string | null;
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

export async function reserveOcrProviderCall(input: {
  workspaceId: string;
  captureId: string;
  operationKey: string;
  imageSha256: string;
  now?: Date;
}): Promise<OcrProviderReservation> {
  const sql = getDatabase();
  const reservationId = randomUUID();

  try {
    return await sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended(${`persnapse:${clovaBusinessCardProviderScope}`}, 0)
        )
      `;

      const now = input.now ?? new Date();
      await transaction`
        update public.ocr_provider_calls
        set
          status = 'failed',
          completed_at = ${now},
          error_code = 'OCR_GUARD_LEASE_EXPIRED'
        where provider_scope = ${clovaBusinessCardProviderScope}
          and status in ('reserved', 'started')
          and lease_expires_at <= ${now}
      `;

      const duplicateOperations = await transaction<
        Array<{ status: string; lease_expires_at: Date | string }>
      >`
        select status, lease_expires_at
        from public.ocr_provider_calls
        where workspace_id = ${input.workspaceId}
          and provider_scope = ${clovaBusinessCardProviderScope}
          and operation_key = ${input.operationKey}::uuid
        limit 1
      `;
      if (duplicateOperations[0]) {
        throw new OcrCostLimitError("OCR_DUPLICATE_REQUEST", 2);
      }

      const activeDuplicates = await transaction<Array<{ id: string }>>`
        select id
        from public.ocr_provider_calls
        where workspace_id = ${input.workspaceId}
          and provider_scope = ${clovaBusinessCardProviderScope}
          and image_sha256 = ${input.imageSha256}
          and status in ('reserved', 'started')
          and lease_expires_at > ${now}
        limit 1
      `;
      if (activeDuplicates[0]) {
        throw new OcrCostLimitError("OCR_DUPLICATE_IN_PROGRESS", 2);
      }

      const [usage] = await transaction<UsageRow[]>`
        select max(reserved_at) as latest_reservation_at, min(reserved_at) as oldest_recent_reservation_at, count(*) as recent_reservations
        from public.ocr_provider_calls
        where provider_scope = ${clovaBusinessCardProviderScope}
          and reserved_at > ${new Date(now.getTime() - clovaOcrCostPolicy.windowMs)}
      `;
      const decision = evaluateOcrCostPolicy(
        {
          latestReservationAt: asDate(usage.latest_reservation_at),
          recentReservations: Number(usage.recent_reservations),
          oldestRecentReservationAt: asDate(usage.oldest_recent_reservation_at),
        },
        now,
      );
      if (!decision.allowed) {
        throw new OcrCostLimitError(decision.code, decision.retryAfterSeconds);
      }

      await transaction`
        insert into public.ocr_provider_calls (
          id,
          workspace_id,
          capture_session_id,
          provider_scope,
          operation_key,
          image_sha256,
          status,
          reserved_at,
          lease_expires_at
        ) values (
          ${reservationId},
          ${input.workspaceId},
          ${input.captureId},
          ${clovaBusinessCardProviderScope},
          ${input.operationKey}::uuid,
          ${input.imageSha256},
          'reserved',
          ${now},
          ${new Date(now.getTime() + clovaOcrCostPolicy.reservationLeaseMs)}
        )
      `;

      return { id: reservationId };
    });
  } catch (error) {
    if (error instanceof OcrCostLimitError) throw error;
    throw new OcrCostGuardUnavailableError();
  }
}

export async function markOcrProviderCallStarted(
  reservationId: string,
): Promise<void> {
  const sql = getDatabase();
  try {
    const updated = await sql<Array<{ id: string }>>`
      update public.ocr_provider_calls
      set status = 'started', provider_request_started_at = clock_timestamp()
      where id = ${reservationId}
        and provider_scope = ${clovaBusinessCardProviderScope}
        and status = 'reserved'
        and lease_expires_at > clock_timestamp()
      returning id
    `;
    if (!updated[0]) throw new Error("OCR reservation is unavailable.");
  } catch {
    throw new OcrCostGuardUnavailableError();
  }
}

export async function completeOcrProviderCall(input: {
  reservationId: string;
  status: "succeeded" | "failed";
  errorCode?: string;
}): Promise<void> {
  const sql = getDatabase();
  await sql`
    update public.ocr_provider_calls
    set
      status = ${input.status},
      completed_at = clock_timestamp(),
      error_code = ${input.errorCode ?? null}
    where id = ${input.reservationId}
      and provider_scope = ${clovaBusinessCardProviderScope}
      and status in ('reserved', 'started')
  `;
}
