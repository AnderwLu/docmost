import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageService } from '../../core/page/services/page.service';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { ContentFormat } from '../../core/page/dto/create-page.dto';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import { CommentService } from '../../core/comment/comment.service';
import { McpPrincipal } from './mcp-principal';

@Injectable()
export class McpWriteService {
  constructor(
    private readonly pages: PageRepo,
    private readonly pageService: PageService,
    private readonly pageAccess: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly comments: CommentService,
  ) {}

  async createPage(
    principal: McpPrincipal,
    input: {
      spaceId: string;
      title?: string;
      parentPageId?: string;
      content?: string;
    },
  ) {
    if (input.parentPageId) {
      const parent = await this.pages.findById(input.parentPageId);
      if (
        !parent ||
        parent.deletedAt ||
        parent.spaceId !== input.spaceId ||
        parent.workspaceId !== principal.workspace.id
      ) {
        throw new NotFoundException('Parent page not found');
      }
      await this.pageAccess.validateCanEdit(parent, principal.user);
    } else {
      const ability = await this.spaceAbility.createForUser(
        principal.user,
        input.spaceId,
      );
      if (ability.cannot(SpaceCaslAction.Create, SpaceCaslSubject.Page))
        throw new ForbiddenException();
    }
    return this.pageService.create(principal.user.id, principal.workspace.id, {
      spaceId: input.spaceId,
      parentPageId: input.parentPageId,
      title: input.title,
      content: input.content,
      format: input.content === undefined ? undefined : 'markdown',
    });
  }

  async updatePage(
    principal: McpPrincipal,
    input: {
      pageId: string;
      title?: string;
      content?: string | object;
      operation?: 'append' | 'prepend' | 'replace';
      format?: ContentFormat;
    },
  ) {
    if (input.title === undefined && input.content === undefined) {
      throw new BadRequestException('Provide title and/or content');
    }

    const page = await this.pages.findById(input.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== principal.workspace.id
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccess.validateCanEdit(page, principal.user);
    return this.pageService.update(
      page,
      {
        pageId: page.id,
        title: input.title,
        content: input.content,
        operation:
          input.content === undefined
            ? undefined
            : input.operation || 'replace',
        format:
          input.content === undefined ? undefined : input.format || 'markdown',
      },
      principal.user,
    );
  }

  async movePage(
    principal: McpPrincipal,
    input: {
      pageId: string;
      parentPageId?: string | null;
      targetSpaceId?: string;
    },
  ) {
    if (input.parentPageId === undefined && input.targetSpaceId === undefined) {
      throw new BadRequestException(
        'Provide parentPageId and/or targetSpaceId',
      );
    }

    let page = await this.pages.findById(input.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== principal.workspace.id
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccess.validateCanEdit(page, principal.user);

    if (input.targetSpaceId && input.targetSpaceId !== page.spaceId) {
      const abilities = await Promise.all([
        this.spaceAbility.createForUser(principal.user, page.spaceId),
        this.spaceAbility.createForUser(principal.user, input.targetSpaceId),
      ]);
      if (
        abilities.some((ability) =>
          ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page),
        )
      ) {
        throw new ForbiddenException();
      }
      await this.pageService.movePageToSpace(
        page,
        input.targetSpaceId,
        principal.user.id,
      );
      page = await this.pages.findById(page.id);
    }

    if (input.parentPageId) {
      const parent = await this.pages.findById(input.parentPageId);
      if (
        !parent ||
        parent.deletedAt ||
        parent.spaceId !== page.spaceId ||
        parent.workspaceId !== principal.workspace.id
      ) {
        throw new NotFoundException('Target parent page not found');
      }
      await this.pageAccess.validateCanEdit(parent, principal.user);
    }
    const parentPageId =
      input.parentPageId === undefined ? page.parentPageId : input.parentPageId;
    const position = await this.pageService.nextPagePosition(
      page.spaceId,
      parentPageId || undefined,
    );
    await this.pageService.movePage(
      { pageId: page.id, position, parentPageId },
      page,
    );
    return this.pages.findById(page.id, {
      includeHasChildren: true,
      includeSpace: true,
    });
  }

  async createComment(
    principal: McpPrincipal,
    input: { pageId: string; text: string; parentCommentId?: string },
  ) {
    const page = await this.pages.findById(input.pageId);
    if (
      !page ||
      page.deletedAt ||
      page.workspaceId !== principal.workspace.id
    ) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccess.validateCanComment(
      page,
      principal.user,
      principal.workspace.id,
    );
    const paragraphs = input.text.split(/\r?\n/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : undefined,
    }));
    return this.comments.create(
      { page, workspaceId: principal.workspace.id, user: principal.user },
      {
        pageId: page.id,
        content: JSON.stringify({ type: 'doc', content: paragraphs }),
        type: 'page',
        parentCommentId: input.parentCommentId,
        selection: undefined,
      },
    );
  }
}
