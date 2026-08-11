import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { McpPrincipal } from './mcp-api-key.service';
import { validate as isUuid } from 'uuid';

@Injectable()
export class McpReadService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly spaceMembers: SpaceMemberRepo,
    private readonly pagePermissions: PagePermissionRepo,
  ) {}

  private async accessiblePageIds(userId: string, rows: Array<{ id: string }>) {
    const ids = rows.map((row) => row.id);
    return new Set(
      await this.pagePermissions.filterAccessiblePageIds({
        pageIds: ids,
        userId,
      }),
    );
  }

  private async requireSpace(principal: McpPrincipal, spaceId: string) {
    const ids = await this.spaceMembers.getUserSpaceIds(principal.user.id);
    if (!ids.includes(spaceId)) throw new NotFoundException('Space not found');
  }

  async searchPages(principal: McpPrincipal, query: string, limit: number) {
    const spaceIds = await this.spaceMembers.getUserSpaceIds(principal.user.id);
    if (!spaceIds.length) return [];
    const rows = await this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.textContent',
        'pages.spaceId',
        'pages.parentPageId',
        'pages.updatedAt',
        'spaces.name as spaceName',
        'spaces.slug as spaceSlug',
      ])
      .where('pages.workspaceId', '=', principal.workspace.id)
      .where('pages.spaceId', 'in', spaceIds)
      .where('pages.deletedAt', 'is', null)
      .where((eb) =>
        eb.or([
          eb(
            sql`f_unaccent(pages.title)`,
            'ilike',
            sql`f_unaccent(${`%${query}%`})`,
          ),
          eb(
            sql`f_unaccent(COALESCE(pages.text_content, ''))`,
            'ilike',
            sql`f_unaccent(${`%${query}%`})`,
          ),
        ]),
      )
      .orderBy('pages.updatedAt', 'desc')
      .limit(Math.min(limit * 3, 150))
      .execute();
    const allowed = await this.accessiblePageIds(principal.user.id, rows);
    return rows.filter((row) => allowed.has(row.id)).slice(0, limit);
  }

  async getPage(principal: McpPrincipal, pageId: string) {
    const page = await this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.content',
        'pages.textContent',
        'pages.spaceId',
        'pages.parentPageId',
        'pages.createdAt',
        'pages.updatedAt',
        'spaces.name as spaceName',
        'spaces.slug as spaceSlug',
      ])
      .where(isUuid(pageId) ? 'pages.id' : 'pages.slugId', '=', pageId)
      .where('pages.workspaceId', '=', principal.workspace.id)
      .where('pages.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!page) throw new NotFoundException('Page not found');
    await this.requireSpace(principal, page.spaceId);
    if (
      !(await this.pagePermissions.canUserAccessPage(
        principal.user.id,
        page.id,
      ))
    ) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  async listPages(
    principal: McpPrincipal,
    input: { spaceId?: string; parentPageId?: string | null; limit: number },
  ) {
    const spaceIds = await this.spaceMembers.getUserSpaceIds(principal.user.id);
    if (input.spaceId && !spaceIds.includes(input.spaceId)) return [];
    if (!spaceIds.length) return [];
    let query = this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'spaceId',
        'parentPageId',
        'createdAt',
        'updatedAt',
      ])
      .where('workspaceId', '=', principal.workspace.id)
      .where('spaceId', 'in', input.spaceId ? [input.spaceId] : spaceIds)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .limit(Math.min(input.limit * 3, 300));
    if (input.parentPageId === null)
      query = query.where('parentPageId', 'is', null);
    else if (input.parentPageId)
      query = query.where('parentPageId', '=', input.parentPageId);
    const rows = await query.execute();
    const allowed = await this.accessiblePageIds(principal.user.id, rows);
    return rows.filter((row) => allowed.has(row.id)).slice(0, input.limit);
  }

  async getSpace(principal: McpPrincipal, spaceId: string) {
    const space = await this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug', 'description', 'createdAt', 'updatedAt'])
      .where(
        isUuid(spaceId) ? 'id' : sql`LOWER(slug)`,
        '=',
        isUuid(spaceId) ? spaceId : spaceId.toLowerCase(),
      )
      .where('workspaceId', '=', principal.workspace.id)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!space) throw new NotFoundException('Space not found');
    await this.requireSpace(principal, space.id);
    return space;
  }

  async listSpaces(principal: McpPrincipal, query?: string, limit = 50) {
    const ids = await this.spaceMembers.getUserSpaceIds(principal.user.id);
    if (!ids.length) return [];
    let qb = this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug', 'description', 'createdAt', 'updatedAt'])
      .where('workspaceId', '=', principal.workspace.id)
      .where('id', 'in', ids)
      .where('deletedAt', 'is', null)
      .orderBy('name', 'asc')
      .limit(limit);
    if (query)
      qb = qb.where((eb) =>
        eb.or([
          eb(sql`f_unaccent(name)`, 'ilike', sql`f_unaccent(${`%${query}%`})`),
          eb(
            sql`f_unaccent(COALESCE(description, ''))`,
            'ilike',
            sql`f_unaccent(${`%${query}%`})`,
          ),
        ]),
      );
    return qb.execute();
  }

  async searchAttachments(
    principal: McpPrincipal,
    query: string,
    limit: number,
  ) {
    const spaceIds = await this.spaceMembers.getUserSpaceIds(principal.user.id);
    if (!spaceIds.length) return [];
    const rows = await this.db
      .selectFrom('attachments')
      .leftJoin('pages', 'pages.id', 'attachments.pageId')
      .select([
        'attachments.id',
        'attachments.fileName',
        'attachments.fileExt',
        'attachments.mimeType',
        'attachments.fileSize',
        'attachments.pageId',
        'attachments.spaceId',
        'attachments.createdAt',
        'pages.title as pageTitle',
      ])
      .where('attachments.workspaceId', '=', principal.workspace.id)
      .where('attachments.spaceId', 'in', spaceIds)
      .where('attachments.deletedAt', 'is', null)
      .where(
        sql`f_unaccent(attachments.file_name)`,
        'ilike',
        sql`f_unaccent(${`%${query}%`})`,
      )
      .orderBy('attachments.createdAt', 'desc')
      .limit(Math.min(limit * 3, 150))
      .execute();
    const pageRows = rows
      .filter((row) => row.pageId)
      .map((row) => ({ id: row.pageId! }));
    const allowed = await this.accessiblePageIds(principal.user.id, pageRows);
    return rows
      .filter((row) => !row.pageId || allowed.has(row.pageId))
      .slice(0, limit);
  }

  getCurrentUser(principal: McpPrincipal) {
    return {
      id: principal.user.id,
      name: principal.user.name,
      email: principal.user.email,
      avatarUrl: principal.user.avatarUrl,
      role: principal.user.role,
      workspace: { id: principal.workspace.id, name: principal.workspace.name },
    };
  }
}
