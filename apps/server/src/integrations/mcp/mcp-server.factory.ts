import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { McpPrincipal } from './mcp-api-key.service';
import { McpReadService } from './mcp-read.service';
import { McpAttachmentService } from './mcp-attachment.service';
import { McpWriteService } from './mcp-write.service';
import { McpMutationService } from './mcp-mutation.service';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};
const writeOperation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};
const destructiveOperation = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
};
const limit = z.number().int().min(1).max(100).default(25);

@Injectable()
export class McpServerFactory {
  constructor(
    private readonly reads: McpReadService,
    private readonly attachments: McpAttachmentService,
    private readonly writes: McpWriteService,
    private readonly mutations: McpMutationService,
  ) {}

  create(principal: McpPrincipal) {
    const server = new McpServer({ name: 'docmost-oem', version: '1.3.1' });
    const result = (value: unknown) => ({
      content: [
        { type: 'text' as const, text: JSON.stringify(value, null, 2) },
      ],
      structuredContent: { result: value },
    });

    server.registerTool(
      'search_pages',
      {
        description: 'Search readable Docmost pages by title or text content.',
        inputSchema: { query: z.string().trim().min(1).max(500), limit },
        annotations: readOnly,
      },
      async ({ query, limit }) =>
        result(await this.reads.searchPages(principal, query, limit)),
    );
    server.registerTool(
      'get_page',
      {
        description: 'Get one readable Docmost page, including its content.',
        inputSchema: { pageId: z.string().min(1).max(100) },
        annotations: readOnly,
      },
      async ({ pageId }) => result(await this.reads.getPage(principal, pageId)),
    );
    server.registerTool(
      'list_pages',
      {
        description:
          'List readable pages, optionally within a space or below a parent page.',
        inputSchema: {
          spaceId: z.string().uuid().optional(),
          parentPageId: z.string().uuid().nullable().optional(),
          limit,
        },
        annotations: readOnly,
      },
      async (input) => result(await this.reads.listPages(principal, input)),
    );
    server.registerTool(
      'list_child_pages',
      {
        description: 'List readable direct children of a page.',
        inputSchema: { parentPageId: z.string().uuid(), limit },
        annotations: readOnly,
      },
      async ({ parentPageId, limit }) =>
        result(await this.reads.listPages(principal, { parentPageId, limit })),
    );
    server.registerTool(
      'get_space',
      {
        description: 'Get a Docmost space visible to the current user.',
        inputSchema: { spaceId: z.string().min(1).max(100) },
        annotations: readOnly,
      },
      async ({ spaceId }) =>
        result(await this.reads.getSpace(principal, spaceId)),
    );
    server.registerTool(
      'list_spaces',
      {
        description: 'List Docmost spaces visible to the current user.',
        inputSchema: { query: z.string().trim().max(500).optional(), limit },
        annotations: readOnly,
      },
      async ({ query, limit }) =>
        result(await this.reads.listSpaces(principal, query, limit)),
    );
    server.registerTool(
      'search_attachments',
      {
        description:
          'Search attachment metadata in readable Docmost pages by filename.',
        inputSchema: { query: z.string().trim().min(1).max(500), limit },
        annotations: readOnly,
      },
      async ({ query, limit }) =>
        result(await this.reads.searchAttachments(principal, query, limit)),
    );
    server.registerTool(
      'get_attachment',
      {
        description:
          'Read attachment metadata and extracted text. XLSX output preserves sheets, rows and cells as tab-separated text.',
        inputSchema: { attachmentId: z.string().uuid() },
        annotations: readOnly,
      },
      async ({ attachmentId }) =>
        result(await this.attachments.getAttachment(principal, attachmentId)),
    );
    server.registerTool(
      'download_attachment',
      {
        description:
          'Create a one-hour signed download URL for an attachment the current user can read.',
        inputSchema: { attachmentId: z.string().uuid() },
        annotations: readOnly,
      },
      async ({ attachmentId }) => {
        const download = await this.attachments.downloadAttachment(
          principal,
          attachmentId,
        );
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(download, null, 2) },
            {
              type: 'resource_link' as const,
              uri: download.url,
              name: download.fileName,
              mimeType: download.mimeType,
              description:
                'Signed Docmost attachment download; expires in one hour.',
            },
          ],
          structuredContent: { result: download },
        };
      },
    );
    server.registerTool(
      'get_current_user',
      {
        description:
          'Get the Docmost user and workspace represented by this API key.',
        annotations: readOnly,
      },
      async () => result(this.reads.getCurrentUser(principal)),
    );
    server.registerTool(
      'create_page',
      {
        description: 'Create a Docmost page using Markdown content.',
        inputSchema: {
          spaceId: z.string().uuid(),
          title: z.string().max(500).optional(),
          parentPageId: z.string().uuid().optional(),
          content: z.string().max(1_000_000).optional(),
        },
        annotations: writeOperation,
      },
      async (input) => result(await this.writes.createPage(principal, input)),
    );
    server.registerTool(
      'update_page',
      {
        description:
          'Update a page title and/or Markdown content. Content can replace, append or prepend.',
        inputSchema: {
          pageId: z.string().uuid(),
          title: z.string().max(500).optional(),
          content: z.string().max(1_000_000).optional(),
          operation: z
            .enum(['append', 'prepend', 'replace'])
            .default('replace'),
        },
        annotations: writeOperation,
      },
      async (input) => result(await this.writes.updatePage(principal, input)),
    );
    server.registerTool(
      'move_page',
      {
        description:
          'Move a page below a parent, to the root, or to another writable space.',
        inputSchema: {
          pageId: z.string().uuid(),
          parentPageId: z.string().uuid().nullable().optional(),
          targetSpaceId: z.string().uuid().optional(),
        },
        annotations: writeOperation,
      },
      async (input) => result(await this.writes.movePage(principal, input)),
    );
    server.registerTool(
      'create_comment',
      {
        description: 'Create a page comment or reply using plain text.',
        inputSchema: {
          pageId: z.string().uuid(),
          text: z.string().trim().min(1).max(100_000),
          parentCommentId: z.string().uuid().optional(),
        },
        annotations: writeOperation,
      },
      async (input) =>
        result(await this.writes.createComment(principal, input)),
    );
    server.registerTool(
      'update_space',
      {
        description:
          'Update the name and/or description of a manageable space.',
        inputSchema: {
          spaceId: z.string().uuid(),
          name: z.string().trim().min(1).max(500).optional(),
          description: z.string().max(10_000).optional(),
        },
        annotations: writeOperation,
      },
      async (input) =>
        result(await this.mutations.updateSpace(principal, input)),
    );
    server.registerTool(
      'create_space',
      {
        description:
          'Create a Docmost space and add the API-key owner as administrator.',
        inputSchema: {
          name: z.string().trim().min(2).max(100),
          slug: z
            .string()
            .min(2)
            .max(100)
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
          description: z.string().max(10_000).optional(),
        },
        annotations: writeOperation,
      },
      async (input) =>
        result(await this.mutations.createSpace(principal, input)),
    );
    server.registerTool(
      'delete_space',
      {
        description: 'Permanently delete a manageable Docmost space.',
        inputSchema: { spaceId: z.string().uuid() },
        annotations: destructiveOperation,
      },
      async ({ spaceId }) =>
        result(await this.mutations.deleteSpace(principal, spaceId)),
    );
    server.registerTool(
      'list_page_attachments',
      {
        description: 'List all attachments on a readable page.',
        inputSchema: { pageId: z.string().uuid() },
        annotations: readOnly,
      },
      async ({ pageId }) =>
        result(await this.mutations.listPageAttachments(principal, pageId)),
    );
    server.registerTool(
      'delete_attachment',
      {
        description: 'Permanently delete an attachment from an editable page.',
        inputSchema: { attachmentId: z.string().uuid() },
        annotations: destructiveOperation,
      },
      async ({ attachmentId }) =>
        result(await this.mutations.deleteAttachment(principal, attachmentId)),
    );
    const encodedFile = {
      fileName: z.string().trim().min(1).max(255),
      contentBase64: z.string().min(1).max(140_000_000),
    };
    server.registerTool(
      'replace_attachment',
      {
        description:
          'Replace attachment bytes while preserving its ID, page relationship and download URL.',
        inputSchema: {
          attachmentId: z.string().uuid(),
          ...encodedFile,
        },
        annotations: writeOperation,
      },
      async ({ attachmentId, fileName, contentBase64 }) =>
        result(
          await this.mutations.replaceAttachment(principal, attachmentId, {
            fileName,
            contentBase64,
          }),
        ),
    );
    server.registerTool(
      'upload_attachment',
      {
        description: 'Upload a base64-encoded file to an editable page.',
        inputSchema: {
          pageId: z.string().uuid(),
          ...encodedFile,
        },
        annotations: writeOperation,
      },
      async ({ pageId, fileName, contentBase64 }) =>
        result(
          await this.mutations.uploadAttachment(principal, pageId, {
            fileName,
            contentBase64,
          }),
        ),
    );
    server.registerTool(
      'create_page_with_attachments',
      {
        description:
          'Create a Markdown page and upload zero or more base64-encoded attachments.',
        inputSchema: {
          spaceId: z.string().uuid(),
          title: z.string().max(500).optional(),
          parentPageId: z.string().uuid().optional(),
          content: z.string().max(1_000_000).optional(),
          attachments: z.array(z.object(encodedFile)).max(20).optional(),
        },
        annotations: writeOperation,
      },
      async (input) =>
        result(
          await this.mutations.createPageWithAttachments(principal, input),
        ),
    );
    return server;
  }
}
