import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface Message {
  room: string;
  user: string;
  text: string;
}

interface PrivateMessage {
  to: string;
  from: string;
  text: string;
}

@WebSocketGateway({ cors: true })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private rooms: { [key: string]: string[] } = {};
  private messageHistory: { [key: string]: Message[] } = {};
  private users: { [id: string]: string } = {};
  private userRooms: { [id: string]: string[] } = {};
  private privateMessages: { [key: string]: PrivateMessage[] } = {};

  afterInit(server: Server) {
    console.log('Init');
  }

  handleConnection(client: Socket, ...args: any[]) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const user = this.users[client.id];
    if (user) {
      delete this.users[client.id];

      if (this.userRooms[client.id]) {
        this.userRooms[client.id].forEach((room) => {
          this.rooms[room] = this.rooms[room].filter(
            (username) => username !== user,
          );
          this.server.to(room).emit('userLeft', user, room);
          this.server.to(room).emit('availableUsers', this.rooms[room]);
        });
        delete this.userRooms[client.id];
      }

      this.server.emit('availableUsers', Object.values(this.users));
    }
  }

  @SubscribeMessage('registerUser')
  handleRegisterUser(client: Socket, username: string) {
    if (Object.values(this.users).includes(username)) {
      client.emit('usernameTaken');
    } else {
      this.users[client.id] = username;
      this.server.emit('availableUsers', Object.values(this.users));
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(client: Socket, payload: { room: string; user: string }) {
    if (
      this.userRooms[client.id] &&
      this.userRooms[client.id].includes(payload.room)
    ) {
      client.emit('error', `You have already joined the room ${payload.room}.`);
      return;
    }

    client.join(payload.room);
    if (!this.rooms[payload.room]) {
      this.rooms[payload.room] = [];
      this.messageHistory[payload.room] = [];
    }
    this.rooms[payload.room].push(payload.user);

    if (!this.userRooms[client.id]) {
      this.userRooms[client.id] = [];
    }
    this.userRooms[client.id].push(payload.room);

    const joinMessage: Message = {
      room: payload.room,
      user: 'System',
      text: `${payload.user} has joined the room.`,
    };
    this.messageHistory[payload.room].push(joinMessage);

    this.server.to(payload.room).emit('userJoined', payload.user, payload.room);
    client.emit('messageHistory', this.messageHistory[payload.room]);
    this.server
      .to(payload.room)
      .emit('availableUsers', this.rooms[payload.room]);
    client.emit(
      'joinConfirmation',
      `You have joined the room ${payload.room}.`,
    );
    
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(client: Socket, payload: { room: string; user: string }) {
    client.leave(payload.room);
    if (this.rooms[payload.room]) {
      this.rooms[payload.room] = this.rooms[payload.room].filter(
        (user) => user !== payload.user,
      );

      const leaveMessage: Message = {
        room: payload.room,
        user: 'System',
        text: `${payload.user} has left the room.`,
      };
      this.messageHistory[payload.room].push(leaveMessage);

      this.server.to(payload.room).emit('userLeft', payload.user, payload.room);
      this.server
        .to(payload.room)
        .emit('availableUsers', this.rooms[payload.room]);
      if (this.userRooms[client.id]) {
        this.userRooms[client.id] = this.userRooms[client.id].filter(
          (room) => room !== payload.room,
        );
      }
    }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, payload: Message) {
    if (this.messageHistory[payload.room].length >= 10) {
      this.messageHistory[payload.room].shift();
    }
    this.messageHistory[payload.room].push(payload);
    this.server.to(payload.room).emit('message', payload);
  }

  @SubscribeMessage('privateMessage')
  handlePrivateMessage(client: Socket, payload: PrivateMessage) {
    const recipientSocketId = Object.keys(this.users).find(
      (key) => this.users[key] === payload.to,
    );

    const messageKey = [payload.from, payload.to].sort().join('_');
    if (!this.privateMessages[messageKey]) {
      this.privateMessages[messageKey] = [];
    }

    if (this.privateMessages[messageKey].length >= 10) {
      this.privateMessages[messageKey].shift();
    }
    this.privateMessages[messageKey].push(payload);

    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('privateMessage', payload);
    }

    client.emit('privateMessage', payload);
  }

  @SubscribeMessage('typing')
  handleTyping(client: Socket, payload: { room: string; user: string }) {
    client.to(payload.room).emit('typing', payload);
  }

  @SubscribeMessage('privateTyping')
  handlePrivateTyping(client: Socket, payload: { to: string; from: string }) {
    const recipientSocketId = Object.keys(this.users).find(
      (key) => this.users[key] === payload.to,
    );

    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('privateTyping', payload.from);
    }
  }

  @SubscribeMessage('getAvailableUsers')
  handleGetAvailableUsers(client: Socket) {
    const rooms = this.userRooms[client.id] || [];
    const usersInRooms = rooms.reduce((acc, room) => {
      acc.push(...(this.rooms[room] || []));
      return acc;
    }, []);
    const uniqueUsers = [...new Set(usersInRooms)];
    client.emit(
      'availableUsers',
      uniqueUsers.filter((user) => user !== this.users[client.id]),
    );
  }

  @SubscribeMessage('getRoomMessageHistory')
  handleGetRoomMessageHistory(client: Socket, room: string) {
    client.emit('messageHistory', this.messageHistory[room] || []);
  }

  @SubscribeMessage('getPrivateMessageHistory')
  handleGetPrivateMessageHistory(
    client: Socket,
    payload: { user: string; to: string },
  ) {
    const messageKey = [payload.user, payload.to].sort().join('_');
    client.emit(
      'privateMessageHistory',
      this.privateMessages[messageKey] || [],
    );
  }
}
