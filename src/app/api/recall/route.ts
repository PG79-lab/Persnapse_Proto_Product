import { z } from "zod";

import { executeRecall } from "../../../server/application/recall-service";
import { getServerEnv } from "../../../server/env";

export const runtime = "nodejs";

const requestSchema = z.object({
  query: z.string().trim().min(2).max(500),
  referenceTime: z.iso.datetime({ offset: true }).optional(),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const environment = getServerEnv();
    const response = await executeRecall({
      workspaceId: environment.APP_DEFAULT_WORKSPACE_ID,
      queryText: input.query,
      referenceTime: input.referenceTime
        ? new Date(input.referenceTime)
        : undefined,
    });

    return Response.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "질문은 2자 이상 500자 이하로 입력해 주세요." },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "관계 기억 검색을 완료하지 못했습니다." },
      { status: 500 },
    );
  }
}
