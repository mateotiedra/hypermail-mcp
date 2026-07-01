import type { AccountRecord } from "../store/account-store.js";
import type { EmailFull, EmailProvider } from "../providers/types.js";

const EDIT_DRAFT_VERIFY_DELAYS_MS = [250, 1000, 2000] as const;

export interface BodyEditExpectation {
  expectedBody: string;
  oldText: string;
  replacementBody: string;
}

function normalizeDraftBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

export function bodyEditPersisted(
  actualBody: string,
  expectation: BodyEditExpectation,
): boolean {
  const actual = normalizeDraftBody(actualBody);
  const expected = normalizeDraftBody(expectation.expectedBody);
  if (actual === expected) return true;

  const oldText = normalizeDraftBody(expectation.oldText);
  const replacementBody = normalizeDraftBody(expectation.replacementBody);
  if (oldText === replacementBody) {
    return actual.includes(replacementBody);
  }
  return actual.includes(replacementBody) && !actual.includes(oldText);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readDraftWithVerifiedBody(
  provider: EmailProvider,
  account: AccountRecord,
  id: string,
  expectation: BodyEditExpectation,
): Promise<EmailFull | undefined> {
  let draft = await provider.readEmail(account, id);
  for (const delayMs of EDIT_DRAFT_VERIFY_DELAYS_MS) {
    const body = draft.bodyHtml ?? draft.bodyText ?? "";
    if (bodyEditPersisted(body, expectation)) return draft;
    await delay(delayMs);
    draft = await provider.readEmail(account, id);
  }

  const body = draft.bodyHtml ?? draft.bodyText ?? "";
  return bodyEditPersisted(body, expectation) ? draft : undefined;
}
