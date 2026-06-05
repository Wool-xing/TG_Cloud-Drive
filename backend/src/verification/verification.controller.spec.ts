import { Test, TestingModule } from '@nestjs/testing';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { VerificationPurpose } from './verification.entity';

describe('VerificationController', () => {
  let controller: VerificationController;
  let verificationService: { sendCode: jest.Mock };

  beforeEach(async () => {
    verificationService = { sendCode: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [{ provide: VerificationService, useValue: verificationService }],
    }).compile();

    controller = module.get<VerificationController>(VerificationController);
    jest.clearAllMocks();
  });

  describe('POST /verification/send', () => {
    it('delegates to verificationService.sendCode with target and purpose', async () => {
      verificationService.sendCode.mockResolvedValue({ sent: true, code: '123456' });
      const result = await controller.sendCode({ target: 'a@b.com', purpose: VerificationPurpose.REGISTER });
      expect(verificationService.sendCode).toHaveBeenCalledWith('a@b.com', VerificationPurpose.REGISTER);
      expect(result).toEqual({ sent: true, code: '123456' });
    });

    it('works with LOGIN purpose', async () => {
      verificationService.sendCode.mockResolvedValue({ sent: true });
      const result = await controller.sendCode({ target: 'a@b.com', purpose: VerificationPurpose.LOGIN });
      expect(verificationService.sendCode).toHaveBeenCalledWith('a@b.com', VerificationPurpose.LOGIN);
      expect(result).toEqual({ sent: true });
    });
  });
});
