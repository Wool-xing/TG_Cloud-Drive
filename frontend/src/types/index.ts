export interface User {
  id: string;
  username: string;
  nickname?: string;
  avatar?: string;
  role: 'user' | 'admin';
  quotaBytes: number;
  usedBytes: number;
  hasPrivateSpace?: boolean;
  createdAt: string;
}

export interface Node {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  type: 'file' | 'folder';
  size: number;
  mimeType?: string;
  md5Plain?: string;
  isLocked: boolean;
  isPrivate: boolean;
  isStarred: boolean;
  thumbnailFileId?: string;
  tags?: Tag[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface FileChunk {
  chunkIndex: number;
  tgFileId: string;
  size: number;
}

export interface NodeKey {
  encryptedDek: string;
  iv: string;
  salt: string;
}

export interface Share {
  id: string;
  nodeId: string;
  token: string;
  expireAt?: string;
  maxDownloads?: number;
  downloadCount: number;
  isActive: boolean;
  hasPassword: boolean;
  node?: Node;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  nodeName?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface UploadTask {
  id: string;
  file: File;
  parentId: string | null;
  isPrivate: boolean;
  status: 'pending' | 'encrypting' | 'uploading' | 'done' | 'error' | 'paused';
  progress: number;
  speed: number;
  uploadedBytes: number;
  error?: string;
  nodeId?: string;
}

export interface DownloadChunk {
  url: string;
  iv: string; // hex, per-chunk AES-GCM IV (NOT to be confused with NodeKey.iv)
}

export interface DownloadInfo {
  node: Node;
  chunks: DownloadChunk[];
  key?: NodeKey;
}

export type SortField = 'name' | 'size' | 'createdAt' | 'updatedAt';
export type SortOrder = 'ASC' | 'DESC';
export type FileFilter = 'all' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';
export type ViewMode = 'list' | 'grid';
