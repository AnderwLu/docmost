import { Module } from '@nestjs/common';
import { PageAccessModule } from '../../core/page/page-access/page-access.module';
import { OnlyOfficeController } from './onlyoffice.controller';
import { OnlyOfficeService } from './onlyoffice.service';

@Module({
  imports: [PageAccessModule],
  controllers: [OnlyOfficeController],
  providers: [OnlyOfficeService],
})
export class OnlyOfficeModule {}
