import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Profile from './Profile';

const mockProfile = vi.fn();
const mockUpdateProfile = vi.fn();

vi.mock('../api/client', () => ({
  usersApi: {
    profile: (...args: any[]) => mockProfile(...args),
    updateProfile: (...args: any[]) => mockUpdateProfile(...args),
    devices: vi.fn().mockResolvedValue([]),
    revokeDevice: vi.fn(),
    auditLogs: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    stats: vi.fn().mockResolvedValue({ usedBytes: 512, quotaBytes: 10 * 1024 * 1024 * 1024 }),
    changePassword: vi.fn(),
    sendBindEmailCode: vi.fn(),
    bindEmail: vi.fn(),
    sendBindPhoneCode: vi.fn(),
    bindPhone: vi.fn(),
    sendBindEmailOldCode: vi.fn(),
    sendBindPhoneOldCode: vi.fn(),
  },
}));

vi.mock('../stores/auth.store', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 'u-1', username: 'testuser', nickname: 'Test User', avatar: null, quotaBytes: 10737418240, usedBytes: 512 },
    setUser: vi.fn(),
  })),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const renderProfile = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Profile page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.mockResolvedValue({ id: 'u-1', username: 'testuser', nickname: 'Test Nick', email: null, phone: null, avatar: null });
  });

  it('renders all tab labels', async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getAllByText('基本信息').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getAllByText('安全设置').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('存储统计').length).toBeGreaterThanOrEqual(1);
  });

  it('loads profile data on mount', async () => {
    renderProfile();
    await waitFor(() => {
      expect(mockProfile).toHaveBeenCalled();
    });
  });

  it('shows username field with value', async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByDisplayValue('testuser')).toBeInTheDocument();
    });
  });

  it('has save button', async () => {
    renderProfile();
    await waitFor(() => {
      expect(screen.getByText('保存修改')).toBeInTheDocument();
    });
  });

  it('switches to security tab on click', async () => {
    const user = userEvent.setup();
    renderProfile();
    await waitFor(() => {
      expect(screen.getAllByText('安全设置').length).toBeGreaterThanOrEqual(1);
    });
    await user.click(screen.getAllByText('安全设置')[0]);
    await waitFor(() => {
      expect(screen.getByText('修改密码')).toBeInTheDocument();
    });
  });

  it('switches to devices tab on click', async () => {
    const user = userEvent.setup();
    renderProfile();
    await waitFor(() => {
      expect(screen.getAllByText('安全设置').length).toBeGreaterThanOrEqual(1);
    });
    await user.click(screen.getAllByText('登录设备')[0]);
    await waitFor(() => {
      expect(screen.getByText('暂无登录设备')).toBeInTheDocument();
    });
  });

  it('switches to storage tab on click', async () => {
    const user = userEvent.setup();
    renderProfile();
    await waitFor(() => {
      expect(screen.getAllByText('安全设置').length).toBeGreaterThanOrEqual(1);
    });
    await user.click(screen.getAllByText('存储统计')[0]);
    await waitFor(() => {
      expect(screen.getByText('已使用存储')).toBeInTheDocument();
    });
  });
});
