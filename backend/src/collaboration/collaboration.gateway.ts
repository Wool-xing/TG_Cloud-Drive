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
      const user = await this.collab.verifyToken(payload.token);
      if (!user) { client.close(4001, 'Unauthorized'); return; }

      const hasAccess = await this.collab.canAccessDoc(user.userId, payload.docId);
      if (!hasAccess) { client.close(4003, 'Forbidden'); return; }

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
    // Track peer count in Redis so getCollaborators() reads live count
    this.redis.incr(`collab:peers:${docId}`).catch(() => {});
  }

  private leaveRoom(docId: string, client: WebSocket) {
    const room = this.rooms.get(docId);
    if (room) {
      room.delete(client);
      // Decrement peer count. Redis key will expire naturally.
      this.redis.decr(`collab:peers:${docId}`).catch(() => {});
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
      this.redis.subscribe(ch, (msg: string) => {
        const room = this.rooms.get(docId);
        if (!room) return;
        for (const ws of room) {
          if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
      });
    } else {
      this.logger.debug(`Redis subscribe not available (mock/disabled), using local-only broadcast`);
    }
  }

  private unsubscribeRedis(docId: string) {
    const ch = this.channel(docId);
    this.subscribed.delete(ch);
    if (typeof this.redis.unsubscribe === 'function') {
      this.redis.unsubscribe(ch).catch(() => {});
    }
  }

  private publishRedis(docId: string, msg: string) {
    if (typeof this.redis.publish === 'function') {
      this.redis.publish(this.channel(docId), msg).catch(() => {});
    }
  }

  private getSession(client: WebSocket): ClientSession | null {
    return (client as any).__tgpan ?? null;
  }

  private setSession(client: WebSocket, sess: ClientSession) {
    (client as any).__tgpan = sess;
  }
}
