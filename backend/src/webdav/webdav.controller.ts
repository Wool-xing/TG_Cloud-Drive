import { Controller, Get, Req, Res, Param, Query, All } from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebdavService } from './webdav.service';

@ApiTags('WebDAV')
@Controller('dav')
@Public()
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class WebdavController {
  constructor(private webdav: WebdavService) {}

  @All()
  @ApiExcludeEndpoint()
  async handleRoot(@Req() req: Request, @Res() res: Response) {
    await this.webdav.handle(req, res);
  }

  @All('*path')
  @ApiExcludeEndpoint()
  async handlePath(@Req() req: Request, @Res() res: Response, @Param('path') path: string) {
    await this.webdav.handle(req, res);
  }
}
