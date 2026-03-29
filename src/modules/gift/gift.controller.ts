import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GiftService } from './gift.service';

@Controller('gifts')
@UseGuards(AuthGuard('jwt'))
export class GiftController {
  constructor(private readonly giftService: GiftService) {}

  @Get()
  getCatalog() {
    return this.giftService.getCatalog();
  }
}
