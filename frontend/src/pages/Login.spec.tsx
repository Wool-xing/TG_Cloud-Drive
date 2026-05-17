import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Login from './Login';

// Mock modules that Login imports
vi.mock('../api/client', () => ({
  authApi: {
    login: vi.fn(),
    resetPassword: vi.fn(),
  },
  verificationApi: {
    sendCode: vi.fn(),
  },
}));

vi.mock('../stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    setAuth: vi.fn(),
    deriveMEK: vi.fn(),
  })),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const renderLogin = () => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Login page', () => {
  it('renders app name', () => {
    renderLogin();
    expect(screen.getByText('TG 云盘')).toBeInTheDocument();
  });

  it('renders login form with identifier input', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('请输入用户名、手机号或邮箱')).toBeInTheDocument();
  });

  it('renders password input', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument();
  });

  it('renders submit button', () => {
    renderLogin();
    expect(screen.getByText('登 录')).toBeInTheDocument();
  });

  it('renders forgot password link', () => {
    renderLogin();
    expect(screen.getByText('忘记密码？')).toBeInTheDocument();
  });

  it('renders register link', () => {
    renderLogin();
    expect(screen.getByText('立即注册')).toBeInTheDocument();
  });

  it('renders OAuth buttons', () => {
    renderLogin();
    expect(screen.getByText('Google 登录')).toBeInTheDocument();
    expect(screen.getByText('GitHub 登录')).toBeInTheDocument();
  });

  it('renders terms text', () => {
    renderLogin();
    expect(screen.getByText('登录即代表您同意我们的服务条款与隐私政策')).toBeInTheDocument();
  });

  it('shows remember me checkbox', () => {
    renderLogin();
    expect(screen.getByText('记住我')).toBeInTheDocument();
  });
});
