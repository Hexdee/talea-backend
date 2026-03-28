import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { SessionUserDto } from './dto/session-user.dto';
import { SignupDto } from './dto/signup.dto';
import { OptionalSessionAuthGuard } from './guards/optional-session-auth.guard';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Version('1')
  @ApiOkResponse({ type: SessionUserDto })
  signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.signup(dto, response);
  }

  @Post('login')
  @Version('1')
  @ApiOkResponse({ type: SessionUserDto })
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    return this.authService.login(dto, response);
  }

  @Post('logout')
  @Version('1')
  @UseGuards(OptionalSessionAuthGuard)
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.authService.logout(request, response);
  }

  @Get('session')
  @Version('1')
  @UseGuards(OptionalSessionAuthGuard)
  @ApiOkResponse({
    type: SessionUserDto,
  })
  getSession(@CurrentUser() user: SessionUserDto | null) {
    return user;
  }

  @Get('google')
  @Version('1')
  @UseGuards(AuthGuard('google'))
  startGoogleLogin() {
    return undefined;
  }

  @Get('google/callback')
  @Version('1')
  @UseGuards(AuthGuard('google'))
  async completeGoogleLogin(
    @Req()
    request: Request & {
      user?: {
        providerAccountId: string;
        email: string;
        displayName: string;
      };
    },
    @Res() response: Response,
  ) {
    if (!request.user?.email) {
      throw new UnauthorizedException('Google authentication failed.');
    }

    await this.authService.upsertGoogleUser(request.user, response);
    return response.redirect(
      `${this.authService.googleRedirectUrl()}?status=success`,
    );
  }
}
