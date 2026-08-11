import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';
import { McpPrincipal } from './mcp-api-key.service';
import { McpReadService } from './mcp-read.service';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};
const limit = z.number().int().min(1).max(100).default(25);

@Injectable()
export class McpServerFactory {
  constructor(private readonly reads: McpReadService) {}

  create(principal: McpPrincipal) {
    const server = new McpServer({ name: 'docmost-oem', version: '1.0.0' });
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
      'get_current_user',
      {
        description:
          'Get the Docmost user and workspace represented by this API key.',
        annotations: readOnly,
      },
      async () => result(this.reads.getCurrentUser(principal)),
    );
    return server;
  }
}
