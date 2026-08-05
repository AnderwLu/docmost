import { Readable } from 'stream';

export interface StorageDriver {
  upload(filePath: string, file: Buffer | Readable): Promise<void>;

  uploadStream(filePath: string, file: Readable, options?: { recreateClient?: boolean }): Promise<void>;

  copy(fromFilePath: string, toFilePath: string): Promise<void>;

  // OEM 存储扩展点：用已验证的暂存文件替换原附件，并兼容本地与 S3 驱动。
  replace(fromFilePath: string, toFilePath: string): Promise<void>;

  read(filePath: string): Promise<Buffer>;

  readStream(filePath: string): Promise<Readable>;

  readRangeStream(
    filePath: string,
    range: { start: number; end: number },
  ): Promise<Readable>;

  exists(filePath: string): Promise<boolean>;

  getUrl(filePath: string): string;

  getSignedUrl(filePath: string, expireIn: number): Promise<string>;

  delete(filePath: string): Promise<void>;

  getDriver(): any;

  getDriverName(): string;

  getConfig(): Record<string, any>;
}
