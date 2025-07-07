const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// دیتابیس ساده
const DB_FILE = 'db.json';

// ساختار اولیه دیتابیس
const defaultDB = {
  users: {
    'admin': {
      password: bcrypt.hashSync('admin123', 10),
      role: 'admin',
      channels: ['general'],
      muted: false
    }
  },
  channels: {
    'general': {
      creator: 'admin',
      users: ['admin'],
      settings: {
        speakPermission: true
      },
      messages: []
    }
  }
};

// بارگذاری یا ایجاد دیتابیس
let db;
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE));
} else {
  db = defaultDB;
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// میدلورها
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Routes
app.post('/register', (req, res) => {
  const { username, password, confirmPassword } = req.body;
  
  // اعتبارسنجی
  if (!username || !password || !confirmPassword) {
    return res.status(400).json({ success: false, message: 'لطفاً تمام فیلدها را پر کنید' });
  }
  
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'رمز عبور و تأیید آن مطابقت ندارند' });
  }
  
  if (db.users[username]) {
    return res.status(400).json({ success: false, message: 'نام کاربری قبلاً استفاده شده است' });
  }
  
  // ایجاد کاربر جدید
  db.users[username] = {
    password: bcrypt.hashSync(password, 10),
    role: 'user',
    channels: [],
    muted: false
  };
  
  saveDB();
  res.json({ success: true, message: 'حساب کاربری با موفقیت ایجاد شد' });
});

app.post('/login', (req, res) => {
  const { username, password, channel } = req.body;
  
  // اعتبارسنجی
  if (!username || !password || !channel) {
    return res.status(400).json({ success: false, message: 'لطفاً تمام فیلدها را پر کنید' });
  }
  
  const user = db.users[username];
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ success: false, message: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  
  if (!db.channels[channel]) {
    return res.status(404).json({ success: false, message: `چنل ${channel} یافت نشد` });
  }
  
  if (!user.channels.includes(channel)) {
    return res.status(403).json({ success: false, message: 'شما به این چنل دسترسی ندارید' });
  }
  
  res.json({ 
    success: true,
    user: {
      username,
      role: user.role,
      channels: user.channels,
      muted: user.muted
    },
    channel: channel
  });
});

app.get('/users', (req, res) => {
  const users = Object.keys(db.users).map(username => ({
    username,
    role: db.users[username].role,
    channels: db.users[username].channels
  }));
  res.json(users);
});

// مدیریت سوکت‌ها
const activeUsers = {};

io.on('connection', (socket) => {
  console.log('کاربر متصل شد:', socket.id);

  socket.on('join', ({ username, channel }) => {
    // ذخیره اطلاعات کاربر
    activeUsers[socket.id] = { username, channel, role: db.users[username].role };
    
    // عضویت در اتاق چنل
    socket.join(channel);
    
    // ارسال تاریخچه پیام‌ها
    if (db.channels[channel] && db.channels[channel].messages) {
      socket.emit('message-history', db.channels[channel].messages.slice(-50));
    }
    
    // اطلاع به سایر کاربران
    io.to(channel).emit('user-joined', username);
    updateChannelInfo(channel);
  });

  socket.on('voice', (data) => {
    const user = activeUsers[socket.id];
    if (!user || !db.channels[user.channel]?.settings.speakPermission || db.users[user.username]?.muted) return;
    
    // ذخیره پیام در تاریخچه
    const message = {
      username: user.username,
      audio: data.audio,
      timestamp: new Date().toISOString(),
      type: 'voice'
    };
    
    if (!db.channels[user.channel].messages) {
      db.channels[user.channel].messages = [];
    }
    
    db.channels[user.channel].messages.push(message);
    saveDB();
    
    // ارسال صوت به سایر کاربران در همان چنل
    socket.to(user.channel).emit('voice', message);
    
    // پخش خودکار صدا برای فرستنده
    socket.emit('play-voice', message);
  });

  socket.on('admin-action', (data) => {
    const user = activeUsers[socket.id];
    if (!user || user.role !== 'admin') return;
    
    switch (data.action) {
      case 'create-channel':
        if (!db.channels[data.channelName]) {
          db.channels[data.channelName] = {
            creator: user.username,
            users: [user.username],
            settings: {
              speakPermission: true
            },
            messages: []
          };
          
          // اضافه کردن چنل به کاربر ادمین
          if (!db.users[user.username].channels.includes(data.channelName)) {
            db.users[user.username].channels.push(data.channelName);
          }
          
          saveDB();
          io.emit('channel-created', {
            name: data.channelName,
            creator: user.username
          });
        }
        break;
        
      case 'add-user-to-channel':
        if (db.channels[data.channel] && db.users[data.username]) {
          // اضافه کردن کاربر به چنل
          if (!db.channels[data.channel].users.includes(data.username)) {
            db.channels[data.channel].users.push(data.username);
          }
          
          // اضافه کردن چنل به لیست چنل‌های کاربر
          if (!db.users[data.username].channels.includes(data.channel)) {
            db.users[data.username].channels.push(data.channel);
          }
          
          saveDB();
          io.emit('user-added-to-channel', {
            username: data.username,
            channel: data.channel
          });
          updateChannelInfo(data.channel);
        }
        break;
        
      case 'remove-user-from-channel':
        if (db.channels[data.channel] && db.users[data.username]) {
          // حذف کاربر از چنل
          db.channels[data.channel].users = db.channels[data.channel].users.filter(u => u !== data.username);
          
          // حذف چنل از لیست چنل‌های کاربر
          db.users[data.username].channels = db.users[data.username].channels.filter(c => c !== data.channel);
          
          saveDB();
          io.to(data.channel).emit('user-removed-from-channel', data.username);
          updateChannelInfo(data.channel);
        }
        break;
        
      case 'toggle-mute-user':
        if (db.users[data.username]) {
          db.users[data.username].muted = data.status;
          saveDB();
          io.emit('user-mute-updated', {
            username: data.username,
            status: data.status
          });
        }
        break;
        
      case 'get-channels':
        const channelsList = Object.entries(db.channels).map(([name, channel]) => ({
          name,
          creator: channel.creator,
          users: channel.users,
          settings: channel.settings
        }));
        socket.emit('channels-list', channelsList);
        break;
        
      case 'get-channel-users':
        if (db.channels[data.channel]) {
          const users = db.channels[data.channel].users.map(username => ({
            username,
            role: db.users[username].role,
            muted: db.users[username].muted
          }));
          socket.emit('channel-users', {
            channel: data.channel,
            users
          });
        }
        break;
    }
  });

  socket.on('request-message-history', ({ channel, limit }) => {
    if (db.channels[channel] && db.channels[channel].messages) {
      socket.emit('message-history', db.channels[channel].messages.slice(-limit));
    }
  });

  socket.on('request-replay', ({ username, channel }) => {
    if (db.channels[channel] && db.channels[channel].messages) {
      const userMessages = db.channels[channel].messages
        .filter(msg => msg.username === username)
        .slice(-5);
      socket.emit('replay-messages', userMessages);
    }
  });

  socket.on('disconnect', () => {
    const user = activeUsers[socket.id];
    if (user) {
      const { username, channel } = user;
      delete activeUsers[socket.id];
      io.to(channel).emit('user-left', username);
      updateChannelInfo(channel);
    }
  });
});

function updateChannelInfo(channel) {
  if (db.channels[channel]) {
    const users = db.channels[channel].users.map(username => ({
      username,
      role: db.users[username].role,
      muted: db.users[username].muted
    }));
    
    io.to(channel).emit('channel-info', {
      users,
      settings: db.channels[channel].settings
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور در حال اجرا روی پورت ${PORT}`);
});