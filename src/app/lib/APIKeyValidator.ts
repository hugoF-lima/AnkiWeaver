export type APIKeyType = "AZURE" | "DEEPL" | "ELEVEN";

export type APIKeyValidation = "idle" | "pending" | "valid" | "invalid";

export async function validateApiKey(
  type: APIKeyType,
  value: string,
): Promise<APIKeyValidation> {
  if (!value || value.trim().length === 0) return "idle";
  try {
    const resp = await fetch(`/api/settings/validate-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: type, key: value.trim() }),
    });
    if (!resp.ok) return "invalid";
    const data = (await resp.json()) as { ok: boolean; message?: string };
    return data.ok ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}