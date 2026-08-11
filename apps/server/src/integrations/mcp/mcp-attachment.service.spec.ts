import * as JSZip from 'jszip';
import { McpAttachmentService } from './mcp-attachment.service';

describe('McpAttachmentService', () => {
  it('extracts shared, inline and numeric XLSX cells by sheet and row', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/sharedStrings.xml',
      '<?xml version="1.0"?><sst><si><t>Case</t></si><si><t>Passed</t></si></sst>',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Status</t></is></c></row>' +
        '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="s"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const service = new McpAttachmentService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const text = await (service as any).extractXlsx(buffer);
    expect(text).toBe('## Sheet 1\nCase\tStatus\n42\tPassed');
  });
});
