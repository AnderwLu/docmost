import { Inject, Injectable, Logger } from '@nestjs/common';
import { STORAGE_DRIVER_TOKEN } from './constants/storage.constants';
import { StorageDriver } from './interfaces';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  constructor(
    @Inject(STORAGE_DRIVER_TOKEN) private storageDriver: StorageDriver,
  ) { }

  async upload(filePath: string, fileContent: Buffer | Readable) {
    await this.storageDriver.upload(filePath, fileContent);
    this.logger.debug(`File uploaded successfully. Path: ${filePath}`);
  }

  async uploadStream(filePath: string, fileContent: Readable, options?: { recreateClient?: boolean }) {
    await this.storageDriver.uploadStream(filePath, fileContent, options);
    this.logger.debug(`File uploaded successfully. Path: ${filePath}`);
  }

  async copy(fromFilePath: string, toFilePath: string) {
    await this.storageDriver.copy(fromFilePath, toFilePath);
    this.logger.debug(`File copied successfully. Path: ${toFilePath}`);
  }

  // OEM 存储扩展点：ONLYOFFICE 保存统一通过驱动实现替换，禁止直接操作磁盘路径。
  async replace(fromFilePath: string, toFilePath: string) {
    await this.storageDriver.replace(fromFilePath, toFilePath);
    this.logger.debug(`File replaced successfully. Path: ${toFilePath}`);
  }

  async read(filePath: string): Promise<Buffer> {
    return this.storageDriver.read(filePath);
  }

  async readStream(filePath: string): Promise<Readable> {
    return this.storageDriver.readStream(filePath);
  }

  async readRangeStream(
    filePath: string,
    range: { start: number; end: number },
  ): Promise<Readable> {
    return this.storageDriver.readRangeStream(filePath, range);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.storageDriver.exists(filePath);
  }

  async getSignedUrl(path: string, expireIn: number): Promise<string> {
    return this.storageDriver.getSignedUrl(path, expireIn);
  }

  getUrl(filePath: string): string {
    return this.storageDriver.getUrl(filePath);
  }

  async delete(filePath: string): Promise<void> {
    await this.storageDriver.delete(filePath);
  }

  getDriverName(): string {
    return this.storageDriver.getDriverName();
  }
}
