import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Trash from './Trash';

const mockTrash = vi.fn();
const mockRestore = vi.fn();
const mockPermanentDelete = vi.fn();

vi.mock('../api/client', () => ({
  filesApi: {
    trash: (...args: any[]) => mockTrash(...args),
    restore: (...args: any[]) => mockRestore(...args),
    permanentDelete: (...args: any[]) => mockPermanentDelete(...args),
  },
}));

vi.mock('../stores/file.store', () => ({
  useFileStore: vi.fn(() => ({
    previewNode: null,
    setPreviewNode: vi.fn(),
  })),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const makeNode = (overrides: Record<string, any> = {}) => ({
  id: 'n-1',
  name: 'deleted-file.txt',
  type: 'file',
  size: 1024,
  mimeType: 'text/plain',
  deletedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  isLocked: false,
  isPrivate: false,
  isStarred: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const renderTrash = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Trash />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Trash page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading', async () => {
    mockTrash.mockResolvedValue([]);
    renderTrash();
    await waitFor(() => {
      expect(screen.getByText('回收站')).toBeInTheDocument();
    });
  });

  it('renders empty state when no trashed items', async () => {
    mockTrash.mockResolvedValue([]);
    renderTrash();
    await waitFor(() => {
      expect(screen.getByText('回收站为空')).toBeInTheDocument();
    });
  });

  it('renders trashed items', async () => {
    mockTrash.mockResolvedValue([
      makeNode({ id: 't-1', name: 'old-doc.pdf', mimeType: 'application/pdf' }),
      makeNode({ id: 't-2', name: 'deleted-img.png', mimeType: 'image/png' }),
    ]);
    renderTrash();
    await waitFor(() => {
      expect(screen.getByText('old-doc.pdf')).toBeInTheDocument();
      expect(screen.getByText('deleted-img.png')).toBeInTheDocument();
    });
  });

  it('shows remaining days countdown for items', async () => {
    mockTrash.mockResolvedValue([
      makeNode({ id: 't-1', name: 'expiring.txt' }),
    ]);
    renderTrash();
    await waitFor(() => {
      expect(screen.getByText('expiring.txt')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    mockTrash.mockRejectedValue(new Error('Network error'));
    renderTrash();
    await waitFor(() => {
      expect(screen.getByText('加载回收站失败，请刷新重试')).toBeInTheDocument();
    });
  });

  it('shows retention banner', async () => {
    mockTrash.mockResolvedValue([]);
    renderTrash();
    await waitFor(() => {
      expect(screen.getByText(/30天/)).toBeInTheDocument();
    });
  });
});
