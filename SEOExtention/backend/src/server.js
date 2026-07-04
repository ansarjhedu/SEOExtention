import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

// import dns from 'dns';
// dns.setServers(['8.8.8.8', '8.8.4.4']);


import { handleSocketConnections } from './socket/socketHandler.js';

// Load environment config
dotenv.config();



const app = express();
const httpServer = createServer(app);

// Setup Socket.io with open CORS so our extension side-panel can connect directly
const io = new Server(httpServer, {
    cors: {
        origin: '*', 
        methods: ['GET', 'POST']
    }
});

// Middlewares
app.use(cors());
app.use(express.json());


 
// Basic API Check
app.get('/', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Initialize WebSocket Communication Route
handleSocketConnections(io);

// Start Server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`LinkScout backend listening on http://localhost:${PORT}`);
});