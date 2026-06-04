import { IsString, MinLength, IsOptional, IsBoolean } from 'class-validator';

export class LoginDto {
  @IsString()
  identifier: string;

  @IsString()
  @MinLength(1)
  password: string;

  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
