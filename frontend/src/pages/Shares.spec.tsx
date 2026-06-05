import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Shares from './Shares';

const mockListShares = vi.fn();

vi.mock('../api/client', () => ({
  sharesApi: {
    list: (...args: any[]) => mockListShares(...args),
    delete: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const renderShares = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Shares />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Shares page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading', async () => {
    mockListShares.mockResolvedValue([]);
    renderShares();
    await waitFor(() => {
      expect(screen.getByText('我的分享')).toBeInTheDocument();
    });
  });

  it('renders empty state when no shares', async () => {
    mockListShares.mockResolvedValue([]);
    renderShares();
    await waitFor(() => {
      expect(screen.getByText('暂无分享')).toBeInTheDocument();
    });
  });

  it('shows error on API failure', async () => {
    mockListShares.mockRejectedValue(new Error('Network error'));
    renderShares();
    await waitFor(() => {
      expect(screen.getByText('加载失败，请刷新重试')).toBeInTheDocument();
    });
  });
});
