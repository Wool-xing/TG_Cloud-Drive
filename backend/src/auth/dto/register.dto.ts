import { IsString, MinLength, MaxLength, Matches, IsOptional, IsEmail, IsMobilePhone } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(4) @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能包含字母、数字和下划线' })
  username: string;

  @IsString()
  @MinLength(8) @MaxLength(64)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d])/, {
    message: '密码必须包含大小写字母、数字和特殊字符',
  })
  password: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @IsOptional()
  @IsMobilePhone('zh-CN', {}, { message: '手机号格式不正确' })
  phone?: string;

  @IsString()
  @MinLength(6) @MaxLength(6)
  code: string;
}
