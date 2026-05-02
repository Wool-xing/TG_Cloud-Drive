import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, IsIn } from 'class-validator';
import { VerificationService } from './verification.service';
import { VerificationPurpose } from './verification.entity';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

class SendCodeDto {
  @IsString() target: string;
  @IsIn(Object.values(VerificationPurpose)) purpose: VerificationPurpose;
}

@ApiTags('验证码')
@Controller('verification')
export class VerificationController {
  constructor(private service: VerificationService) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('send')
  sendCode(@Body() dto: SendCodeDto) {
    return this.service.sendCode(dto.target, dto.purpose);
  }
}
