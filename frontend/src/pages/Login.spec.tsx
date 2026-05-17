import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Login from './Login';

const mockLogin = vi.fn();
const mockResetPassword = vi.fn();
const mockSendCode = vi.fn();
const mockSetAuth = vi.fn();
const mockDeriveMEK = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../api/client', () => ({
  authApi: { login: (...args: any[]) => mockLogin(...args), resetPassword: (...args: any[]) => mockResetPassword(...args) },
  verificationApi: { sendCode: (...args: any[]) => mockSendCode(...args) },
}));

vi.mock('../stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({ setAuth: mockSetAuth, deriveMEK: mockDeriveMEK })),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: (...args: any[]) => mockToastSuccess(...args), error: (...args: any[]) => mockToastError(...args) },
}));

const renderLogin = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Login page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Smoke ───────────────────────────────────────────────────────────────
  it('renders app name', () => {
    renderLogin();
    expect(screen.getByText('TG 云盘')).toBeInTheDocument();
  });

  it('renders login form inputs', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('请输入用户名、手机号或邮箱')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument();
    expect(screen.getByText('登 录')).toBeInTheDocument();
  });

  it('renders forgot password link and register link', () => {
    renderLogin();
    expect(screen.getByText('忘记密码？')).toBeInTheDocument();
    expect(screen.getByText('立即注册')).toBeInTheDocument();
  });

  it('renders OAuth buttons', () => {
    renderLogin();
    expect(screen.getByText('Google 登录')).toBeInTheDocument();
    expect(screen.getByText('GitHub 登录')).toBeInTheDocument();
  });

  // ── Interaction ──────────────────────────────────────────────────────────
  it('allows typing in identifier and password fields', async () => {
    const user = userEvent.setup();
    renderLogin();
    const idInput = screen.getByPlaceholderText('请输入用户名、手机号或邮箱');
    const pwInput = screen.getByPlaceholderText('请输入密码');
    await user.type(idInput, 'admin');
    await user.type(pwInput, 'secret123');
    expect(idInput).toHaveValue('admin');
    expect(pwInput).toHaveValue('secret123');
  });

  it('calls authApi.login on form submit with correct payload', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      accessToken: 'at', refreshToken: 'rt', user: { id: '1', username: 'admin' }, mekSalt: 'salt',
    });
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入用户名、手机号或邮箱'), 'admin');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'myPassword');
    await user.click(screen.getByText('登 录'));
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({ identifier: 'admin', password: 'myPassword' });
    });
  });

  it('calls setAuth + deriveMEK after successful login', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({
      accessToken: 'at', refreshToken: 'rt', user: { id: 'u1', username: 'admin' }, mekSalt: 'salt',
    });
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入用户名、手机号或邮箱'), 'admin');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'pw');
    await user.click(screen.getByText('登 录'));
    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalledWith({ id: 'u1', username: 'admin' }, 'at', 'rt', 'salt', false);
      expect(mockDeriveMEK).toHaveBeenCalledWith('pw');
    });
  });

  it('shows validation toast when identifier is empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入密码'), 'pw');
    await user.click(screen.getByText('登 录'));
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it('shows validation toast when password is empty', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入用户名、手机号或邮箱'), 'admin');
    await user.click(screen.getByText('登 录'));
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  // ── Forgot password modal ────────────────────────────────────────────────
  it('opens forgot modal on link click', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByText('忘记密码？'));
    expect(screen.getByText('找回密码')).toBeInTheDocument();
  });

  it('forgot modal step 1: sends verification code', async () => {
    const user = userEvent.setup();
    mockSendCode.mockResolvedValue({});
    renderLogin();
    await user.click(screen.getByText('忘记密码？'));
    await user.type(screen.getByPlaceholderText('请输入邮箱或手机号'), 'test@example.com');
    await user.click(screen.getByText('发送验证码'));
    await waitFor(() => {
      expect(mockSendCode).toHaveBeenCalledWith('test@example.com', 'reset_password');
    });
  });

  it('closes forgot modal on X button', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByText('忘记密码？'));
    expect(screen.getByText('找回密码')).toBeInTheDocument();
    // The X button is the first button in the modal (onClick={onClose})
    const buttons = screen.getAllByRole('button');
    const xBtn = buttons.find(b => b.querySelector('svg'));
    if (xBtn) {
      await user.click(xBtn);
      await waitFor(() => {
        expect(screen.queryByText('找回密码')).not.toBeInTheDocument();
      });
    }
  });

  // ── Remember-me ──────────────────────────────────────────────────────────
  it('renders remember me checkbox', () => {
    renderLogin();
    expect(screen.getByText('记住我')).toBeInTheDocument();
  });
});
