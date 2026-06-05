import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Recent from './Recent';

const mockRecent = vi.fn();

vi.mock('../api/client', () => ({
  filesApi: {
    recent: (...args: any[]) => mockRecent(...args),
  },
}));

vi.mock('../stores/file.store', () => ({
  useFileStore: vi.fn(() => ({
    goTo: vi.fn(),
    setPreview: vi.fn(),
    setContextMenu: vi.fn(),
    contextMenuNode: null,
    contextMenuPos: null,
    previewNode: null,
    filterType: 'all',
  })),
}));

vi.mock('../components/files/FileContextMenu', () => ({
  default: () => null,
}));

vi.mock('../components/preview/PreviewModal', () => ({
  default: () => null,
}));

const makeNode = (overrides: Record<string, any> = {}) => ({
  id: 'r-1',
  name: 'recent-file.txt',
  type: 'file',
  size: 2048,
  mimeType: 'text/plain',
  deletedAt: null,
  isLocked: false,
  isPrivate: false,
  isStarred: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const renderRecent = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Recent />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Recent page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page heading', async () => {
    mockRecent.mockResolvedValue([]);
    renderRecent();
    await waitFor(() => {
      expect(screen.getByText('最近访问')).toBeInTheDocument();
    });
  });

  it('renders recent files', async () => {
    mockRecent.mockResolvedValue([
      makeNode({ id: 'r-1', name: 'report.pdf' }),
      makeNode({ id: 'r-2', name: 'photo.jpg', mimeType: 'image/jpeg' }),
      makeNode({ id: 'r-3', name: 'Docs', type: 'folder' }),
    ]);
    renderRecent();
    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('Docs')).toBeInTheDocument();
    });
  });

  it('renders empty state when no recent files', async () => {
    mockRecent.mockResolvedValue([]);
    renderRecent();
    await waitFor(() => {
      expect(screen.getByText('暂无最近文件')).toBeInTheDocument();
    });
  });

  it('shows error message on API failure', async () => {
    mockRecent.mockRejectedValue(new Error('Network error'));
    renderRecent();
    await waitFor(() => {
      expect(screen.getByText('加载失败，请刷新重试')).toBeInTheDocument();
    });
  });
});
