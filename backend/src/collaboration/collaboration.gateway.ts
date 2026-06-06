import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Logger, Inject } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';

interface ClientSession {
  userId: string;
  docId: string;
  instanceId: string;
}

@WebSocketGateway({ path: '/api/collab', transports: ['websocket'] })
export class CollaborationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CollaborationGateway.name);

  private rooms = new Map<string, Set<WebSocket>>();
  private instanceId = Math.random().toString(36).slice(2, 10);

  constructor(
    private readonly collab: CollaborationService,
    @Inject(REDIS_CLIENT) private readonly redis: any,
  ) {}

  afterInit() {
    this.logger.log(`Collaboration gateway initialized, instance=${this.instanceId}`);
  }

  handleConnection(client: WebSocket) {
    this.logger.debug(`Client connected, awaiting auth`);
  }

  handleDisconnect(client: WebSocket) {
    const sess = this.getSession(client);
    if (sess) {
      this.leaveRoom(sess.docId, client);
    }
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  @SubscribeMessage('auth')
  async handleAuth(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() payload: { token: string; docId: string },
  ) {
    try {
      // Validate docId is a UUID before any Redis key construction (security gate)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.docId)) {
        client.close(4000, 'Invalid docId format');
        return;
      }
      const user = await this.collab.verifyToken(payload.token);
      if (!user) { client.close(4001, 'Unauthorized'); return; }

      const hasAccess = await this.collab.canAccessDoc(user.userId, payload.docId);
      if (!hasAccess) { client.close(4003, 'Forbidden'); return; }

      // If client is re-authenticating for a different document, leave the old room
      // first to prevent Redis counter drift and room-map leaks.
      const oldSess = this.getSession(client);
      if (oldSess && oldSess.docId !== payload.docId) {
        this.leaveRoom(oldSess.docId, client);
      }

      this.setSession(client, { userId: user.userId, docId: payload.docId, instanceId: this.instanceId });
      this.joinRoom(payload.docId, client);
      client.send(JSON.stringify({ type: 'auth-ok' }));
      this.logger.log(`User ${user.userId} joined doc ${payload.docId}`);
    } catch (err: any) {
      client.close(4000, err.message);
    }
  }

  // ── Sync ───────────────────────────────────────────────────────────────

  @SubscribeMessage('sync')
  handleSync(@ConnectedSocket() client: WebSocket, @MessageBody() data: any) {
    const sess = this.getSession(client);
    if (!sess) return;
    const msg = JSON.stringify(data);
    this.broadcastLocal(sess.docId, msg, client);
    this.publishRedis(sess.docId, msg);
  }

  @SubscribeMessage('awareness')
  handleAwareness(@ConnectedSocket() client: WebSocket, @MessageBody() data: any) {
    const sess = this.getSession(client);
    if (!sess) return;
    const msg = JSON.stringify({ type: 'awareness', payload: data });
    this.broadcastLocal(sess.docId, msg, client);
    this.publishRedis(sess.docId, msg);
  }

  // ── Room management ────────────────────────────────────────────────────

  private joinRoom(docId: string, client: WebSocket) {
    if (!this.rooms.has(docId)) {
      this.rooms.set(docId, new Set());
      // Subscribe to Redis channel for cross-instance sync
      this.subscribeRedis(docId);
    }
    this.rooms.get(docId)!.add(client);
    // Track peer count in Redis so getCollaborators() reads live count.
    // Set a 1-hour TTL on first incr to prevent stale keys after crashes.
    this.redis.incr(`collab:peers:${docId}`).then((c: number) => {
      if (c === 1) this.redis.expire(`collab:peers:${docId}`, 3600).catch(() => {});
    }).catch((e: any) => this.logger.warn(`Redis incr failed for ${docId}: ${e.message}`));
  }

  private leaveRoom(docId: string, client: WebSocket) {
    const room = this.rooms.get(docId);
    if (room) {
      room.delete(client);
      this.redis.decr(`collab:peers:${docId}`).catch((e: any) =>
        this.logger.warn(`Redis decr failed for ${docId}: ${e.message}`),
      );
      if (room.size === 0) {
        this.rooms.delete(docId);
        this.unsubscribeRedis(docId);
      }
    }
  }

  private broadcastLocal(docId: string, msg: string, exclude: WebSocket) {
    const room = this.rooms.get(docId);
    if (!room) return;
    for (const ws of room) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // ── Redis pub/sub for multi-instance scaling ───────────────────────────

  private subscribed = new Set<string>();

  private channel(docId: string) { return `collab:${docId}`; }

  private subscribeRedis(docId: string) {
    const ch = this.channel(docId);
    if (this.subscribed.has(ch)) return;
    this.subscribed.add(ch);

    if (typeof this.redis.subscribe === 'function') {
      this.redis.subscribe(ch, (envelope: string) => {
        // Unwrap envelope; skip if published from this same instance
        // (broadcastLocal already delivered to local peers).
        let msg: string;
        try {
          const parsed = JSON.parse(envelope);
          if (parsed.i === this.instanceId) return;
          msg = parsed.m;
        } catch {
          msg = envelope; // backwards-compat with old message format
        }
        const room = this.rooms.get(docId);
        if (!room) return;
        for (const ws of room) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      }).catch((e: any) =>
        this.logger.warn(`Redis subscribe failed for channel ${ch}: ${e.message}`),
      );
    } else {
      this.logger.debug(`Redis subscribe not available (mock/disabled), using local-only broadcast`);
    }
  }

  private unsubscribeRedis(docId: string) {
    const ch = this.channel(docId);
    this.subscribed.delete(ch);
    if (typeof this.redis.unsubscribe === 'function') {
      this.redis.unsubscribe(ch).catch((e: any) =>
        this.logger.warn(`Redis unsubscribe failed for channel ${ch}: ${e.message}`),
      );
    }
  }

  private publishRedis(docId: string, msg: string) {
    if (typeof this.redis.publish === 'function') {
      // Attach instanceId so the subscriber on the same instance filters out
      // self-published messages (broadcastLocal already delivered them).
      const envelope = JSON.stringify({ i: this.instanceId, m: msg });
      this.redis.publish(this.channel(docId), envelope).catch((e: any) =>
        this.logger.warn(`Redis publish failed for channel ${this.channel(docId)}: ${e.message}`),
      );
    }
  }

  private getSession(client: WebSocket): ClientSession | null {
    return (client as any).__tgpan ?? null;
  }

  private setSession(client: WebSocket, sess: ClientSession) {
    (client as any).__tgpan = sess;
  }
}
