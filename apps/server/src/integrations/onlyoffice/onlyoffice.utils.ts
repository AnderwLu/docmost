import * as path from 'node:path';
import * as yauzl from 'yauzl';
import { ONLYOFFICE_EXTENSIONS, OnlyOfficeExtension } from './onlyoffice.types';

export function getOnlyOfficeExtension(
  fileName: string,
): OnlyOfficeExtension | null {
  const extension = path.extname(fileName).toLowerCase();
  return ONLYOFFICE_EXTENSIONS.includes(extension as OnlyOfficeExtension)
    ? (extension as OnlyOfficeExtension)
    : null;
}

export function getOnlyOfficeDocumentType(
  extension: OnlyOfficeExtension,
): 'word' | 'cell' | 'slide' {
  if (extension === '.docx') return 'word';
  if (extension === '.xlsx') return 'cell';
  return 'slide';
}

export async function validateOoxmlBuffer(
  buffer: Buffer,
  extension: OnlyOfficeExtension,
): Promise<void> {
  const requiredPrefix = {
    '.docx': 'word/',
    '.xlsx': 'xl/',
    '.pptx': 'ppt/',
  }[extension];

  const entries = await listZipEntries(buffer);
  if (
    !entries.has('[Content_Types].xml') ||
    ![...entries].some((entry) => entry.startsWith(requiredPrefix))
  ) {
    throw new Error(`Downloaded file is not a valid ${extension} document`);
  }
}

function listZipEntries(buffer: Buffer): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile)
        return reject(error ?? new Error('Invalid ZIP file'));
      const entries = new Set<string>();
      zipFile.on('entry', (entry) => {
        entries.add(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.once('end', () => resolve(entries));
      zipFile.once('error', reject);
      zipFile.readEntry();
    });
  });
}
