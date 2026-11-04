import {
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { StorageService } from '../storage/storage.service';
import { TokenService } from '../../core/auth/services/token.service';
import { EnvironmentService } from '../environment/environment.service';
import { McpPrincipal } from './mcp-principal';
import * as JSZip from 'jszip';
import * as cheerio from 'cheerio';

const MAX_PARSE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 1_000_000;

@Injectable()
export class McpAttachmentService {
  constructor(
    private readonly attachments: AttachmentRepo,
    private readonly pages: PageRepo,
    private readonly pageAccess: PageAccessService,
    private readonly storage: StorageService,
    private readonly tokens: TokenService,
    private readonly environment: EnvironmentService,
  ) {}

  private async requireReadable(principal: McpPrincipal, attachmentId: string) {
    const attachment = await this.attachments.findByIdWithContent(attachmentId);
    if (
      !attachment ||
      attachment.workspaceId !== principal.workspace.id ||
      attachment.deletedAt
    ) {
      throw new NotFoundException('Attachment not found');
    }
    if (attachment.aiChatId) {
      if (attachment.creatorId !== principal.user.id)
        throw new NotFoundException('Attachment not found');
      return attachment;
    }
    if (!attachment.pageId || !attachment.spaceId)
      throw new NotFoundException('Attachment not found');
    const page = await this.pages.findById(attachment.pageId);
    if (!page || page.deletedAt)
      throw new NotFoundException('Attachment not found');
    await this.pageAccess.validateCanView(page, principal.user);
    return attachment;
  }

  async getAttachment(principal: McpPrincipal, attachmentId: string) {
    const attachment = await this.requireReadable(principal, attachmentId);
    let text = attachment.textContent?.trim() || '';
    let source: 'indexed' | 'extracted' | 'unavailable' = text
      ? 'indexed'
      : 'unavailable';

    if (!text) {
      if (Number(attachment.fileSize) > MAX_PARSE_BYTES) {
        throw new PayloadTooLargeException(
          'Attachment is too large for MCP text extraction; use download_attachment',
        );
      }
      const buffer = await this.storage.read(attachment.filePath);
      text = await this.extractText(buffer, attachment.fileExt.toLowerCase());
      source = text ? 'extracted' : 'unavailable';
    }

    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      fileExt: attachment.fileExt,
      mimeType: attachment.mimeType,
      fileSize: Number(attachment.fileSize),
      pageId: attachment.pageId,
      spaceId: attachment.spaceId,
      text,
      textSource: source,
      truncated,
      downloadTool: 'download_attachment',
    };
  }

  async downloadAttachment(principal: McpPrincipal, attachmentId: string) {
    const attachment = await this.requireReadable(principal, attachmentId);
    if (!attachment.pageId)
      throw new NotFoundException(
        'Download is unavailable for this attachment',
      );
    const jwt = await this.tokens.generateAttachmentToken({
      attachmentId: attachment.id,
      pageId: attachment.pageId,
      workspaceId: principal.workspace.id,
    });
    const base = this.environment.getAppUrl().replace(/\/$/, '');
    const name = encodeURIComponent(attachment.fileName);
    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: Number(attachment.fileSize),
      url: `${base}/api/files/public/${attachment.id}/${name}?jwt=${encodeURIComponent(jwt)}`,
      expiresInSeconds: 3600,
    };
  }

  private async extractText(
    buffer: Buffer,
    extension: string,
  ): Promise<string> {
    if (
      [
        '.txt',
        '.md',
        '.csv',
        '.tsv',
        '.json',
        '.xml',
        '.yaml',
        '.yml',
        '.log',
      ].includes(extension)
    ) {
      return buffer.toString('utf8').replace(/\0/g, '');
    }
    if (extension === '.xlsx') return this.extractXlsx(buffer);
    if (extension === '.docx') return this.extractDocx(buffer);
    if (extension === '.pptx') return this.extractPptx(buffer);
    return '';
  }

  private async extractXlsx(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const sharedXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const shared = sharedXml
      ? cheerio
          .load(sharedXml, { xmlMode: true })('si')
          .map((_, node) =>
            cheerio
              .load(node, { xmlMode: true })('t')
              .map((__, text) => cheerio.load(text, { xmlMode: true }).text())
              .get()
              .join(''),
          )
          .get()
      : [];
    const sheetPaths = Object.keys(zip.files)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const output: string[] = [];
    for (let sheetIndex = 0; sheetIndex < sheetPaths.length; sheetIndex++) {
      const xml = await zip.file(sheetPaths[sheetIndex])!.async('string');
      const $ = cheerio.load(xml, { xmlMode: true });
      output.push(`## Sheet ${sheetIndex + 1}`);
      $('row').each((_, row) => {
        const cells: string[] = [];
        $(row)
          .find('c')
          .each((__, cell) => {
            const ref = $(cell).attr('r') || '';
            const letters = ref.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
            let column = 0;
            for (const letter of letters)
              column = column * 26 + letter.charCodeAt(0) - 64;
            while (cells.length < column - 1) cells.push('');
            const type = $(cell).attr('t');
            const raw = $(cell).find('v').first().text();
            let value = raw;
            if (type === 's') value = shared[Number(raw)] ?? '';
            else if (type === 'inlineStr')
              value = $(cell)
                .find('t')
                .map((___, t) => $(t).text())
                .get()
                .join('');
            cells[column - 1] = value.replace(/[\t\r\n]+/g, ' ');
          });
        output.push(cells.join('\t').replace(/\t+$/, ''));
      });
      output.push('');
    }
    return output.join('\n').trim();
  }

  private async extractDocx(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) return '';
    const $ = cheerio.load(xml, { xmlMode: true });
    return $('w\\:p')
      .map((_, paragraph) =>
        $(paragraph)
          .find('w\\:t')
          .map((__, text) => $(text).text())
          .get()
          .join(''),
      )
      .get()
      .join('\n');
  }

  private async extractPptx(buffer: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const output: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const xml = await zip.file(slides[i])!.async('string');
      const $ = cheerio.load(xml, { xmlMode: true });
      output.push(`## Slide ${i + 1}`);
      output.push(
        $('a\\:t')
          .map((_, text) => $(text).text())
          .get()
          .join('\n'),
      );
      output.push('');
    }
    return output.join('\n').trim();
  }
}
