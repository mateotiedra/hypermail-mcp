import type { Client } from "@microsoft/microsoft-graph-client";
import type { EmailWebLinkFields } from "../types.js";

export const OUTLOOK_IMMUTABLE_ID_PREFER = 'IdType="ImmutableId"';

interface TranslateExchangeIdsResponse {
  value?: Array<{ sourceId?: string; targetId?: string }>;
}

const WEB_LINK_UNAVAILABLE = "Microsoft Graph did not return an Outlook web link for this message.";

/** Returns Graph's native link, or a best-effort OWA link for immutable IDs. */
export async function resolveOutlookWebLink(
  client: Client,
  id: string,
  graphWebLink?: string,
): Promise<EmailWebLinkFields> {
  const webUrl = graphWebLink?.trim();
  if (webUrl) return { webUrl };

  try {
    const result = (await client.api("/me/translateExchangeIds").post({
      inputIds: [id],
      sourceIdType: "restImmutableEntryId",
      targetIdType: "restId",
    })) as TranslateExchangeIdsResponse;
    const restId = result.value?.find((item) => item.targetId)?.targetId;
    if (restId) {
      return {
        webUrl: `https://outlook.office365.com/owa/?ItemID=${encodeURIComponent(restId)}&exvsurl=1&viewmodel=ReadMessageItem`,
      };
    }
  } catch {
    // Link generation is best-effort and must not affect mail operations.
  }

  return { webUrlUnavailableReason: WEB_LINK_UNAVAILABLE };
}

export function graphWebLinkFields(graphWebLink?: string): EmailWebLinkFields {
  const webUrl = graphWebLink?.trim();
  return webUrl ? { webUrl } : { webUrlUnavailableReason: WEB_LINK_UNAVAILABLE };
}
