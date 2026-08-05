export const ONLYOFFICE_EXTENSIONS = ['.docx', '.xlsx', '.pptx'] as const;

export type OnlyOfficeExtension = (typeof ONLYOFFICE_EXTENSIONS)[number];
export type OnlyOfficeTokenPurpose = 'read' | 'callback';

export interface OnlyOfficeAccessToken {
  attachmentId: string;
  userId: string;
  workspaceId: string;
  purpose: OnlyOfficeTokenPurpose;
  documentKey: string;
  iat?: number;
  exp?: number;
}

export interface OnlyOfficeCallbackBody {
  status: number;
  url?: string;
  key?: string;
  token?: string;
}
