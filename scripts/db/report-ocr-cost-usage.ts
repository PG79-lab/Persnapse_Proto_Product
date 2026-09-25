import "server-only";

import { closeDatabase, getDatabase } from "../../src/server/db/client";
import { clovaBusinessCardProviderScope } from "../../src/server/db/ocr-cost-guard-repository";

const sql = getDatabase();

try {
  const [usage] = await sql<
    Array<{
      today_reserved: number | string;
      today_started: number | string;
      month_reserved: number | string;
      month_started: number | string;
      month_succeeded: number | string;
      month_failed: number | string;
    }>
  >`
    select
      count(*) filter (
        where reserved_at >= (
          date_trunc('day', timezone('Asia/Seoul', clock_timestamp()))
          at time zone 'Asia/Seoul'
        )
      ) as today_reserved,
      count(*) filter (
        where reserved_at >= (
          date_trunc('day', timezone('Asia/Seoul', clock_timestamp()))
          at time zone 'Asia/Seoul'
        )
          and provider_request_started_at is not null
      ) as today_started,
      count(*) filter (
        where reserved_at >= (
          date_trunc('month', timezone('Asia/Seoul', clock_timestamp()))
          at time zone 'Asia/Seoul'
        )
      ) as month_reserved,
      count(*) filter (
        where reserved_at >= (
          date_trunc('month', timezone('Asia/Seoul', clock_timestamp()))
          at time zone 'Asia/Seoul'
        )
          and provider_request_started_at is not null
      ) as month_started,
      count(*) filter (
        where reserved_at >= (
          date_trunc('month', timezone('Asia/Seoul', clock_timestamp()))
          at time zone 'Asia/Seoul'
        )
          and status = 'succeeded'
      ) as month_succeeded,
      count(*) filter (
        where reserved_at >= (
          date_trunc('month', timezone('Asia/Seoul', clock_timestamp()))
          at time zone 'Asia/Seoul'
        )
          and status = 'failed'
      ) as month_failed
    from public.ocr_provider_calls
    where provider_scope = ${clovaBusinessCardProviderScope}
  `;

  process.stdout.write(
    `${JSON.stringify({
      timezone: "Asia/Seoul",
      today: {
        reserved: Number(usage.today_reserved),
        providerRequestsStarted: Number(usage.today_started),
        limit: null,
      },
      month: {
        reserved: Number(usage.month_reserved),
        providerRequestsStarted: Number(usage.month_started),
        succeeded: Number(usage.month_succeeded),
        failed: Number(usage.month_failed),
        limit: null,
      },
    })}\n`,
  );
} finally {
  await closeDatabase();
}
