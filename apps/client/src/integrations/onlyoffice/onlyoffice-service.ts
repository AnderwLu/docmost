import api from "@/lib/api-client";

export interface OnlyOfficeSession {
  documentServerUrl: string;
  downloadUrl: string;
  config: Record<string, unknown>;
}

export async function createOnlyOfficeSession(
  attachmentId: string,
): Promise<OnlyOfficeSession> {
  const response = await api.post<OnlyOfficeSession>("/office/sessions", {
    attachmentId,
  });
  return response.data;
}

export function isOnlyOfficeFile(fileName?: string): boolean {
  return !!fileName && /\.(docx|xlsx|pptx)$/i.test(fileName);
}
