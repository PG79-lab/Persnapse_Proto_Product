import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "../env";

export const businessCardBucket = "business-card-assets";

declare global {
  var persnapseStorageClient: SupabaseClient | undefined;
}

function getStorageClient(): SupabaseClient {
  if (!globalThis.persnapseStorageClient) {
    const environment = getServerEnv();

    if (!environment.SUPABASE_SECRET_KEY) {
      throw new Error(
        "SUPABASE_SECRET_KEY is required for private card assets.",
      );
    }

    globalThis.persnapseStorageClient = createClient(
      environment.NEXT_PUBLIC_SUPABASE_URL,
      environment.SUPABASE_SECRET_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  }

  return globalThis.persnapseStorageClient;
}

export async function uploadBusinessCardAsset(input: {
  path: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<void> {
  const { error } = await getStorageClient()
    .storage.from(businessCardBucket)
    .upload(input.path, input.bytes, {
      contentType: input.contentType,
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    throw new Error(`Business card asset upload failed: ${error.message}`);
  }
}

export async function downloadBusinessCardAsset(path: string): Promise<Blob> {
  const { data, error } = await getStorageClient()
    .storage.from(businessCardBucket)
    .download(path);

  if (error || !data) {
    throw new Error("Business card asset download failed.");
  }

  return data;
}

export async function removeBusinessCardAssets(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const { error } = await getStorageClient()
    .storage.from(businessCardBucket)
    .remove(paths);

  if (error) {
    throw new Error(`Business card asset removal failed: ${error.message}`);
  }
}
