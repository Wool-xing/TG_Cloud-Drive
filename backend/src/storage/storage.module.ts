import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import { R2StorageProvider } from './r2-storage.provider';
import { TelegramStorageProvider } from './telegram-storage.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [R2StorageProvider, TelegramStorageProvider, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
