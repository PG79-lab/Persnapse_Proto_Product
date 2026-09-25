import "server-only";

import { isPrototypeRequestAllowed } from "./prototype-access-policy";

export class PrototypeAccessError extends Error {
  constructor() {
    super("This prototype is not available from the current environment.");
    this.name = "PrototypeAccessError";
  }
}

export function assertPrototypeAccess(request: Request): void {
  if (!isPrototypeRequestAllowed(request)) {
    throw new PrototypeAccessError();
  }
}
