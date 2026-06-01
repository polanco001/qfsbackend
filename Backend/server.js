const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Message = require('./models/Message');

dotenv.config();

const app = express();

app.use(helmet());

app.use(cors({
  origin: ['https://qfsledger-pyy7.onrender.com',]
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use(express.json({ limit: '10kb' }));
app.use(mongoSanitize());
app.use(xss());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests from this IP'
});
app.use('/api', limiter);

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
app.use('/uploads', express.static('uploads'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
});
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Server error' });
});

// ─── SOCKET.IO SETUP ───
const server = http.createServer(app);
// ✅ Also set the Socket.io CORS to the same frontend URL
const io = socketIo(server, {
  cors: {
    origin: ['https://qfsledger-pyy7.onrender.com', 'http://localhost:5173'],
    methods: ['GET', 'POST']
  }
});
app.set('io', io);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`🟢 User connected: ${socket.user.email} (${socket.user.role})`);

  socket.join(socket.user.id);
  if (socket.user.role === 'admin') {
    socket.join('admins');
    console.log(`🔑 Admin joined admins room: ${socket.user.email}`);
  }

  // Send a message
  socket.on('sendMessage', async (data, callback) => {
    try {
      const { text, receiverId } = data;
      const message = await Message.create({
        sender: socket.user.id,
        receiver: receiverId || null,
        text
      });
      const populated = await Message.findById(message._id)
        .populate('sender', 'fullName email role');

      if (receiverId) {
        io.to(receiverId).emit('newMessage', populated);
        socket.emit('newMessage', populated);
      } else {
        io.to('admins').emit('newMessage', populated);
        socket.emit('newMessage', populated);
      }
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  // Edit a message
  socket.on('editMessage', async (data, callback) => {
    try {
      const { messageId, newText } = data;
      const message = await Message.findById(messageId);
      if (!message) return callback({ success: false, error: 'Message not found' });
      if (message.sender.toString() !== socket.user.id) {
        return callback({ success: false, error: 'Not authorized' });
      }
      message.text = newText;
      message.edited = true;
      await message.save();
      const populated = await Message.findById(message._id)
        .populate('sender', 'fullName email role');

      if (message.receiver) {
        io.to(message.receiver.toString()).emit('messageEdited', populated);
        io.to(message.sender.toString()).emit('messageEdited', populated);
      } else {
        io.to('admins').emit('messageEdited', populated);
        io.to(message.sender.toString()).emit('messageEdited', populated);
      }
      callback({ success: true });
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.user.email}`);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
