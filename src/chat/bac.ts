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
  
  @WebSocketGateway({ cors: true })
  export class ChatGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
  {
    @WebSocketServer() server: Server;
    private rooms: { [key: string]: string[] } = {};
    private messageHistory: { [key: string]: Message[] } = {};
    private users: { [id: string]: string } = {}; // Store user id and username mapping
    private userRooms: { [id: string]: string[] } = {}; // Store user id and the rooms they are in
  
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
  
        // Remove the user from all rooms they were part of
        if (this.userRooms[client.id]) {
          this.userRooms[client.id].forEach((room) => {
            this.rooms[room] = this.rooms[room].filter(
              (username) => username !== user,
            );
            this.server.to(room).emit('availableUsers', this.rooms[room]);
          });
          delete this.userRooms[client.id];
        }
  
        // Notify all clients about the updated user list
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
  
      this.server.to(payload.room).emit('userJoined', payload.user);
      client.emit('messageHistory', this.messageHistory[payload.room]);
      this.server.to(payload.room).emit('availableUsers', this.rooms[payload.room]);
      client.emit('joinConfirmation', `You have joined the room ${payload.room}.`);
    }
  
    @SubscribeMessage('leaveRoom')
    handleLeaveRoom(client: Socket, payload: { room: string; user: string }) {
      client.leave(payload.room);
      if (this.rooms[payload.room]) {
        this.rooms[payload.room] = this.rooms[payload.room].filter(
          (user) => user !== payload.user,
        );
        this.server.to(payload.room).emit('userLeft', payload.user);
        this.server.to(payload.room).emit('availableUsers', this.rooms[payload.room]);
  
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
    handlePrivateMessage(
      client: Socket,
      payload: { to: string; from: string; text: string; room: string },
    ) {
      const recipientSocketId = Object.keys(this.users).find(
        (key) => this.users[key] === payload.to,
      );
  
      if (recipientSocketId) {
        this.server.to(recipientSocketId).emit('privateMessage', payload);
      }
    }
  
    @SubscribeMessage('typing')
    handleTyping(client: Socket, payload: { room: string; user: string }) {
      client.to(payload.room).emit('typing', payload.user);
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
  }
  