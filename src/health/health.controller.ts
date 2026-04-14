import { Controller, Get, Version } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

class HealthResponseDto {
  status!: string;
  service!: string;
  timestamp!: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @Version('1')
  @ApiOkResponse({
    type: HealthResponseDto,
  })
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'lesenpad-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
