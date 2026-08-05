import * as JSZip from 'jszip';
import {
  getOnlyOfficeDocumentType,
  getOnlyOfficeExtension,
  validateOoxmlBuffer,
} from './onlyoffice.utils';

describe('ONLYOFFICE file validation', () => {
  it.each([
    ['Report.DOCX', '.docx', 'word'],
    ['budget.xlsx', '.xlsx', 'cell'],
    ['slides.pptx', '.pptx', 'slide'],
  ])('maps supported file %s', (fileName, extension, documentType) => {
    const result = getOnlyOfficeExtension(fileName);
    expect(result).toBe(extension);
    expect(getOnlyOfficeDocumentType(result!)).toBe(documentType);
  });

  it.each(['old.doc', 'old.xls', 'old.ppt', 'notes.txt', 'document.docx.exe'])(
    'rejects unsupported file %s',
    (fileName) => expect(getOnlyOfficeExtension(fileName)).toBeNull(),
  );

  it.each([
    ['.docx', 'word/document.xml'],
    ['.xlsx', 'xl/workbook.xml'],
    ['.pptx', 'ppt/presentation.xml'],
  ] as const)(
    'accepts a structurally valid %s archive',
    async (extension, contentPath) => {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', '<Types/>');
      zip.file(contentPath, '<document/>');
      await expect(
        validateOoxmlBuffer(
          await zip.generateAsync({ type: 'nodebuffer' }),
          extension,
        ),
      ).resolves.toBeUndefined();
    },
  );

  it('rejects a ZIP whose internal structure does not match its extension', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('word/document.xml', '<document/>');
    await expect(
      validateOoxmlBuffer(
        await zip.generateAsync({ type: 'nodebuffer' }),
        '.xlsx',
      ),
    ).rejects.toThrow('valid .xlsx');
  });

  it('rejects non-ZIP content', async () => {
    await expect(
      validateOoxmlBuffer(Buffer.from('not a zip'), '.docx'),
    ).rejects.toBeDefined();
  });
});
