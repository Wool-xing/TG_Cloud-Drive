import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationService } from './collaboration.service';

const mockWs = () => {
  const ws: any = { readyState: 1, send: jest.fn(), close: jest.fn() };
  ws.readyState = 1; // WebSocket.OPEN
  return ws;
};

const mockRedis = {
  subscribe: jest.fn().mockResolvedValue(undefined),
  unsubscribe: jest.fn().mockResolvedValue(undefined),
  publish: jest.fn().mockResolvedValue(undefined),
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  decr: jest.fn().mockResolvedValue(0),
};

const mockCollab = {
  verifyToken: jest.fn().mockResolvedValue({ userId: 'u1' }),
  canAccessDoc: jest.fn().mockResolvedValue(true),
};

describe('CollaborationGateway', () => {
  let gateway: CollaborationGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new CollaborationGateway(mockCollab as any, mockRedis as any);
  });

  it('handleConnection logs', () => {
    const ws = mockWs();
    gateway.handleConnection(ws);
    expect(ws.close).not.toHaveBeenCalled(); // No immediate close
  });

  it('handleDisconnect leaves room', () => {
    const ws = mockWs();
    (gateway as any).setSession(ws, { userId: 'u1', docId: 'd1', instanceId: 'i1' });
    // Add to room first
    gateway['rooms'].set('d1', new Set([ws]));
    gateway.handleDisconnect(ws);
    expect(gateway['rooms'].get('d1')?.has(ws)).toBeFalsy();
  });

  it('handleAuth validates UUID', async () => {
    const ws = mockWs();
    await gateway.handleAuth(ws, { token: 'tok', docId: 'not-a-uuid' });
    expect(ws.close).toHaveBeenCalledWith(4000, expect.any(String));
  });

  it('handleAuth succeeds with valid UUID', async () => {
    const ws = mockWs();
    await gateway.handleAuth(ws, { token: 'valid', docId: '00000000-0000-0000-0000-000000000001' });
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('auth-ok'));
  });

  it('handleAuth closes on unauthorized', async () => {
    mockCollab.verifyToken.mockResolvedValueOnce(null);
    const ws = mockWs();
    await gateway.handleAuth(ws, { token: 'bad', docId: '00000000-0000-0000-0000-000000000001' });
    expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
  });

  it('handleAuth closes on forbidden', async () => {
    mockCollab.canAccessDoc.mockResolvedValueOnce(false);
    const ws = mockWs();
    await gateway.handleAuth(ws, { token: 'tok', docId: '00000000-0000-0000-0000-000000000001' });
    expect(ws.close).toHaveBeenCalledWith(4003, expect.any(String));
  });

  it('handleSync broadcasts to room', async () => {
    const ws = mockWs();
    (gateway as any).setSession(ws, { userId: 'u1', docId: 'd1', instanceId: 'i1' });
    const ws2 = mockWs();
    gateway['rooms'].set('d1', new Set([ws, ws2]));
    await gateway.handleSync(ws, { type: 'update', data: 'hello' });
    expect(ws2.send).toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled(); // sender excluded
  });

  it('handleAwareness broadcasts', async () => {
    const ws = mockWs();
    (gateway as any).setSession(ws, { userId: 'u1', docId: 'd1', instanceId: 'i1' });
    await gateway.handleAwareness(ws, { cursor: { line: 1 } });
    // Should publish to redis
    expect(mockRedis.publish).toHaveBeenCalled();
  });

  it('joinRoom increments Redis peer count', async () => {
    const ws = mockWs();
    gateway['joinRoom']('d1', ws);
    expect(mockRedis.incr).toHaveBeenCalledWith('collab:peers:d1');
  });

  it('leaveRoom decrements Redis peer count', async () => {
    const ws = mockWs();
    gateway['rooms'].set('d1', new Set([ws]));
    gateway['leaveRoom']('d1', ws);
    expect(mockRedis.decr).toHaveBeenCalledWith('collab:peers:d1');
  });

  it('broadcastLocal excludes sender', () => {
    const ws1 = mockWs(), ws2 = mockWs();
    gateway['rooms'].set('d1', new Set([ws1, ws2]));
    gateway['broadcastLocal']('d1', 'hello', ws1);
    expect(ws2.send).toHaveBeenCalledWith('hello');
    expect(ws1.send).not.toHaveBeenCalled();
  });

  it('publishRedis sends instanceId envelope', async () => {
    gateway['publishRedis']('d1', 'test-msg');
    expect(mockRedis.publish).toHaveBeenCalledWith(
      'collab:d1',
      expect.stringContaining(gateway['instanceId']),
    );
  });

  it('subscribeRedis filters self-published messages', () => {
    const ch = 'collab:d2';
    mockRedis.subscribe.mockImplementation((_ch: string, cb: Function) => {
      const selfEnvelope = JSON.stringify({ i: gateway['instanceId'], m: 'self-msg' });
      const otherEnvelope = JSON.stringify({ i: 'other-instance', m: 'other-msg' });
      cb(selfEnvelope);
      cb(otherEnvelope);
      return Promise.resolve();
    });
    const ws1 = mockWs(), ws2 = mockWs();
    gateway['rooms'].set('d2', new Set([ws1, ws2]));
    gateway['subscribeRedis']('d2');
    // self-published should be filtered - only other-instance message delivered
    expect(ws1.send).toHaveBeenCalledWith('other-msg');
    expect(ws1.send).not.toHaveBeenCalledWith('self-msg');
  });

  it('handleSync rejects oversized messages', () => {
    const ws = mockWs();
    (gateway as any).setSession(ws, { userId: 'u1', docId: 'd1', instanceId: 'i1' });
    const largeData = { data: 'x'.repeat(1_000_001) };
    gateway.handleSync(ws, largeData);
    // Should NOT broadcast (message too large)
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('handleAwareness rejects oversized messages', () => {
    const ws = mockWs();
    (gateway as any).setSession(ws, { userId: 'u1', docId: 'd1', instanceId: 'i1' });
    gateway.handleAwareness(ws, 'x'.repeat(1_000_001));
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });

  it('handleConnection sets auth deadline', () => {
    jest.useFakeTimers();
    const ws = mockWs();
    gateway.handleConnection(ws);
    expect((ws as any).__authTimer).toBeDefined();
    jest.advanceTimersByTime(16000);
    expect(ws.close).toHaveBeenCalledWith(4001, expect.any(String));
    jest.useRealTimers();
  });

  it('handleAuth clears auth deadline on success', async () => {
    jest.useFakeTimers();
    const ws = mockWs();
    gateway.handleConnection(ws);
    await gateway.handleAuth(ws, { token: 'tok', docId: '00000000-0000-0000-0000-000000000001' });
    jest.advanceTimersByTime(16000);
    // Auth succeeded, deadline should be cleared — no close
    expect(ws.close).not.toHaveBeenCalledWith(4001, expect.any(String));
    jest.useRealTimers();
  });
});
