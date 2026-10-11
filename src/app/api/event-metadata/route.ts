import { z } from "zod";
import {
  fetchEventMetadata,
  validateEventUrl,
} from "../../../server/application/event-metadata";
import { readJsonBody } from "../../../server/http/request-body";
import {
  workspaceResponse,
  workspaceErrorResponse,
  WorkspaceError,
} from "../../../server/http/workspace-response";
import { assertPrototypeAccess } from "../../../server/security/prototype-access";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertPrototypeAccess(request);
    const input = z
      .object({ url: z.string().max(2048) })
      .strict()
      .parse(await readJsonBody(request));
    try {
      validateEventUrl(input.url);
    } catch {
      throw new WorkspaceError(
        "UNSUPPORTED_EVENT_URL",
        "이벤터스·온오프믹스·Eventbrite·Meetup의 공식 HTTPS 주소를 입력해 주세요.",
      );
    }
    return workspaceResponse({
      metadata: await fetchEventMetadata(input.url, { signal: request.signal }),
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
