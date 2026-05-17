import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Logger } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';

@WebSocketGateway({ path: '/api/collab', transports: ['websocket'] })
export class CollaborationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(CollaborationGateway.name);

  // docId → Set<WebSocket>
  private rooms = new Map<string, Set<WebSocket>>();

  constructor(private readonly collab: CollaborationService) {}

  handleConnection(client: WebSocket) {
    this.logger.debug(`Client connected, awaiting auth`);
  }

  handleDisconnect(client: WebSocket) {
    const sess = (client as any).__tgpan;
    if (sess) {
      this.leaveRoom(sess.docId, client);
    }
  }

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

      (client as any).__tgpan = { userId: user.userId, docId: payload.docId };
      this.joinRoom(payload.docId, client);
      client.send(JSON.stringify({ type: 'auth-ok' }));
      this.logger.log(`User ${user.userId} joined doc ${payload.docId}`);
    } catch (err: any) {
      client.close(4000, err.message);
    }
  }

  @SubscribeMessage('sync')
  handleSync(@ConnectedSocket() client: WebSocket, @MessageBody() data: any) {
    const sess = (client as any).__tgpan;
    if (!sess) return;
    this.broadcast(sess.docId, data, client);
  }

  @SubscribeMessage('awareness')
  handleAwareness(@ConnectedSocket() client: WebSocket, @MessageBody() data: any) {
    const sess = (client as any).__tgpan;
    if (!sess) return;
    this.broadcast(sess.docId, { type: 'awareness', payload: data }, client);
  }

  private joinRoom(docId: string, client: WebSocket) {
    if (!this.rooms.has(docId)) this.rooms.set(docId, new Set());
    this.rooms.get(docId)!.add(client);
  }

  private leaveRoom(docId: string, client: WebSocket) {
    const room = this.rooms.get(docId);
    if (room) {
      room.delete(client);
      if (room.size === 0) this.rooms.delete(docId);
    }
  }

  private broadcast(docId: string, data: any, exclude: WebSocket) {
    const room = this.rooms.get(docId);
    if (!room) return;
    const msg = JSON.stringify(data);
    for (const ws of room) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }
}
