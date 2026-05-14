import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MaxLength(200)
  target: string; // email OR phone (raw, as user typed during sendCode)

  @IsString()
  @MinLength(6) @MaxLength(6)
  code: string;

  @IsString()
  @MinLength(8) @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d])/, {
    message: '密码必须包含大小写字母、数字和特殊字符',
  })
  newPassword: string;
}
