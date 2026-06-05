import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Starred from './Starred';

const mockStarred = vi.fn();

vi.mock('../api/client', () => ({
  filesApi: {
    starred: (...args: any[]) => mockStarred(...args),
    rename: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
    star: vi.fn(),
    setLock: vi.fn(),
    removeLock: vi.fn(),
    verifyLock: vi.fn(),
  },
}));

vi.mock('../stores/file.store', () => ({
  useFileStore: vi.fn(() => ({
    navigate: vi.fn(),
    previewNode: null,
    setPreviewNode: vi.fn(),
    contextMenuNode: null,
    setContextMenuNode: vi.fn(),
    contextMenuPos: null,
    setContextMenuPos: vi.fn(),
  })),
}));

vi.mock('../components/files/FileContextMenu', () => ({ default: () => null }));
vi.mock('../components/preview/PreviewModal', () => ({ default: () => null }));
vi.mock('../components/dialogs/RenameDialog', () => ({ default: () => null }));
vi.mock('../components/dialogs/MoveDialog', () => ({ default: () => null }));
vi.mock('../components/dialogs/ShareDialog', () => ({ default: () => null }));
vi.mock('../components/dialogs/LockDialog', () => ({ default: () => null }));

const renderStarred = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Starred />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Starred page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading', async () => {
    mockStarred.mockResolvedValue([]);
    renderStarred();
    await waitFor(() => {
      expect(screen.getByText('我的收藏')).toBeInTheDocument();
    });
  });

  it('renders empty state when nothing starred', async () => {
    mockStarred.mockResolvedValue([]);
    renderStarred();
    await waitFor(() => {
      expect(screen.getByText('暂无收藏')).toBeInTheDocument();
    });
  });

  it('shows error on API failure', async () => {
    mockStarred.mockRejectedValue(new Error('Network error'));
    renderStarred();
    await waitFor(() => {
      expect(screen.getByText('加载失败，请刷新重试')).toBeInTheDocument();
    });
  });
});
