const socket = io();
let currentUser = null;
let currentChannel = null;
let canSpeak = true;
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let messageHistory = [];
let allUsers = [];
let currentChannelUsers = [];

// عناصر DOM
const elements = {
  // صفحات
  loginPage: document.getElementById('loginPage'),
  registerPage: document.getElementById('registerPage'),
  chatPage: document.getElementById('chatPage'),
  adminPage: document.getElementById('adminPage'),
  channelPage: document.getElementById('channelPage'),
  addMembersPage: document.getElementById('addMembersPage'),
  
  // دکمه‌ها
  adminBtn: document.getElementById('adminBtn'),
  backToChatBtn: document.getElementById('backToChat'),
  createChannelBtn: document.getElementById('createChannelBtn'),
  talkButton: document.getElementById('talkButton'),
  addMembersBtn: document.getElementById('addMembersBtn'),
  backToChannelBtn: document.getElementById('backToChannelBtn'),
  saveMembersBtn: document.getElementById('saveMembersBtn'),
  
  // فیلدهای ورودی
  usernameInput: document.getElementById('username'),
  passwordInput: document.getElementById('password'),
  channelInput: document.getElementById('channel'),
  regUsernameInput: document.getElementById('regUsername'),
  regPasswordInput: document.getElementById('regPassword'),
  regConfirmPasswordInput: document.getElementById('regConfirmPassword'),
  newChannelInput: document.getElementById('newChannelName'),
  
  // نمایش اطلاعات
  currentUsername: document.getElementById('currentUsername'),
  currentChannel: document.getElementById('currentChannel'),
  messagesContainer: document.getElementById('messagesContainer'),
  usersList: document.getElementById('usersList'),
  channelsList: document.getElementById('channelsList'),
  channelUsersList: document.getElementById('channelUsersList'),
  allUsersList: document.getElementById('allUsersList'),
  status: document.getElementById('status'),
  
  // پیام‌های خطا
  errorMessage: document.getElementById('errorMessage'),
  regErrorMessage: document.getElementById('regErrorMessage')
};

// مدیریت رویدادها
document.getElementById('showRegister').addEventListener('click', showRegisterPage);
document.getElementById('showLogin').addEventListener('click', showLoginPage);
document.getElementById('registerBtn').addEventListener('click', registerUser);
document.getElementById('loginBtn').addEventListener('click', loginUser);
elements.adminBtn.addEventListener('click', showAdminPanel);
elements.backToChatBtn.addEventListener('click', backToChat);
elements.createChannelBtn.addEventListener('click', createChannel);
elements.talkButton.addEventListener('mousedown', startRecording);
elements.talkButton.addEventListener('mouseup', stopRecording);
elements.talkButton.addEventListener('touchstart', startRecording);
elements.talkButton.addEventListener('touchend', stopRecording);
elements.addMembersBtn.addEventListener('click', showAddMembersPage);
elements.backToChannelBtn.addEventListener('click', backToChannelPage);
elements.saveMembersBtn.addEventListener('click', saveMembers);

// توابع صفحه‌بندی
function showRegisterPage() {
  elements.loginPage.classList.add('hidden');
  elements.registerPage.classList.remove('hidden');
}

function showLoginPage() {
  elements.registerPage.classList.add('hidden');
  elements.loginPage.classList.remove('hidden');
}

function showAdminPanel() {
  elements.chatPage.classList.add('hidden');
  elements.adminPage.classList.remove('hidden');
  loadAdminData();
}

function backToChat() {
  elements.adminPage.classList.add('hidden');
  elements.channelPage.classList.add('hidden');
  elements.chatPage.classList.remove('hidden');
}

function showChannelPage(channel) {
  elements.chatPage.classList.add('hidden');
  elements.channelPage.classList.remove('hidden');
  document.getElementById('channelTitle').textContent = `مدیریت چنل: ${channel}`;
  loadChannelUsers(channel);
}

function showAddMembersPage() {
  elements.channelPage.classList.add('hidden');
  elements.addMembersPage.classList.remove('hidden');
  loadAllUsers();
}

function backToChannelPage() {
  elements.addMembersPage.classList.add('hidden');
  elements.channelPage.classList.remove('hidden');
}

// ثبت نام کاربر
async function registerUser() {
  const username = elements.regUsernameInput.value.trim();
  const password = elements.regPasswordInput.value;
  const confirmPassword = elements.regConfirmPasswordInput.value;

  try {
    const response = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, confirmPassword })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(data.message);
      showLoginPage();
    } else {
      showError(data.message, 'regErrorMessage');
    }
  } catch (error) {
    showError('خطا در ارتباط با سرور', 'regErrorMessage');
  }
}

// ورود کاربر
async function loginUser() {
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;
  const channel = elements.channelInput.value.trim();

  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, channel })
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentUser = data.user;
      currentChannel = data.channel;
      
      // به‌روزرسانی UI
      elements.loginPage.classList.add('hidden');
      elements.chatPage.classList.remove('hidden');
      elements.currentUsername.textContent = currentUser.username;
      elements.currentChannel.textContent = currentChannel;
      
      // نمایش دکمه ادمین اگر کاربر ادمین باشد
      if (currentUser.role === 'admin') {
        elements.adminBtn.classList.remove('hidden');
      } else {
        elements.adminBtn.classList.add('hidden');
      }
      
      // اتصال به سوکت
      socket.emit('join', { 
        username: currentUser.username, 
        channel: currentChannel 
      });
    } else {
      showError(data.message, 'errorMessage');
    }
  } catch (error) {
    showError('خطا در ارتباط با سرور', 'errorMessage');
  }
}

// مدیریت ضبط صدا
async function startRecording() {
  if (isRecording || !canSpeak || currentUser.muted) return;
  
  try {
    elements.status.textContent = 'در حال ضبط...';
    elements.talkButton.classList.add('recording');
    addMessage('شما در حال ضبط پیام هستید...', 'info');
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = () => {
        const base64Audio = reader.result.split(',')[1];
        socket.emit('voice', { audio: base64Audio });
        addMessage('پیام شما ارسال شد', 'info');
      };
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start();
    isRecording = true;
  } catch (error) {
    console.error('خطا در دسترسی به میکروفون:', error);
    addMessage('خطا در دسترسی به میکروفون', 'error');
    elements.status.textContent = 'خطا در دسترسی به میکروفون';
  }
}

function stopRecording() {
  if (!isRecording) return;
  
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    isRecording = false;
    elements.talkButton.classList.remove('recording');
    elements.status.textContent = 'پیام ارسال شد';
    setTimeout(() => elements.status.textContent = 'آماده', 1000);
  }
}

// نمایش پیام‌ها
function addMessage(text, type = 'info', audioData = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  
  const time = new Date().toLocaleTimeString('fa-IR');
  
  if (audioData) {
    messageDiv.innerHTML = `
      <div class="message-content">${text}</div>
      <button class="play-btn" onclick="playAudio('${audioData}')">
        <i class="fas fa-redo"></i> پخش مجدد
      </button>
      <div class="message-time">${time}</div>
    `;
  } else {
    messageDiv.innerHTML = `
      <div class="message-content">${text}</div>
      <div class="message-time">${time}</div>
    `;
  }
  
  elements.messagesContainer.prepend(messageDiv);
}

// پخش صوت
function playAudio(audioData) {
  const audio = new Audio(`data:audio/webm;base64,${audioData}`);
  audio.play().catch(console.error);
}

// بارگذاری داده‌های ادمین
function loadAdminData() {
  socket.emit('admin-action', { action: 'get-channels' });
}

// بارگذاری کاربران چنل
function loadChannelUsers(channel) {
  socket.emit('admin-action', { 
    action: 'get-channel-users',
    channel
  });
}

// بارگذاری تمام کاربران
function loadAllUsers() {
  fetch('/users')
    .then(res => res.json())
    .then(users => {
      allUsers = users;
      renderAllUsersList();
    });
}

// نمایش لیست تمام کاربران
function renderAllUsersList() {
  const channelUsers = currentChannelUsers.map(u => u.username);
  const html = allUsers
    .filter(user => !channelUsers.includes(user.username))
    .map(user => `
      <li>
        ${user.username}
        <button onclick="addUserToChannel('${user.username}')">افزودن</button>
      </li>
    `)
    .join('');
  
  elements.allUsersList.innerHTML = html || '<li>همه کاربران به چنل اضافه شده‌اند</li>';
}

// نمایش لیست کاربران چنل
function renderChannelUsersList() {
  const html = currentChannelUsers.map(user => `
    <li>
      ${user.username} (${user.role})
      ${user.muted ? '(سکوت)' : ''}
      ${user.username !== currentUser.username ? `
        <button onclick="removeUserFromChannel('${user.username}')">حذف</button>
        <button onclick="toggleMuteUser('${user.username}', ${!user.muted})">
          ${user.muted ? 'لغو سکوت' : 'سکوت'}
        </button>
      ` : ''}
    </li>
  `).join('');
  
  elements.channelUsersList.innerHTML = html;
}

// ایجاد چنل جدید
function createChannel() {
  const channelName = elements.newChannelInput.value.trim();
  if (!channelName) return;
  
  socket.emit('admin-action', {
    action: 'create-channel',
    channelName
  });
  
  elements.newChannelInput.value = '';
}

// اضافه کردن کاربر به چنل
function addUserToChannel(username) {
  socket.emit('admin-action', {
    action: 'add-user-to-channel',
    username,
    channel: currentChannel
  });
}

// حذف کاربر از چنل
function removeUserFromChannel(username) {
  socket.emit('admin-action', {
    action: 'remove-user-from-channel',
    username,
    channel: currentChannel
  });
}

// تغییر وضعیت سکوت کاربر
function toggleMuteUser(username, status) {
  socket.emit('admin-action', {
    action: 'toggle-mute-user',
    username,
    status
  });
}

// ذخیره اعضای چنل
function saveMembers() {
  backToChannelPage();
}

// نمایش خطا
function showError(message, elementId) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  setTimeout(() => errorElement.style.display = 'none', 5000);
}

// رویدادهای سوکت
socket.on('user-joined', (username) => {
  addMessage(`${username} به چنل پیوست`, 'info');
});

socket.on('user-left', (username) => {
  addMessage(`${username} چنل را ترک کرد`, 'info');
});

socket.on('voice', (message) => {
  // پخش خودکار صدا
  playAudio(message.audio);
  addMessage(`${message.username} در حال صحبت است...`, 'info', message.audio);
});

socket.on('play-voice', (message) => {
  // پخش صدا برای فرستنده
  playAudio(message.audio);
});

socket.on('channel-info', (data) => {
  canSpeak = data.settings.speakPermission;
  updateUserList(data.users);
});

socket.on('channels-list', (channels) => {
  let html = '';
  
  channels.forEach(channel => {
    html += `
      <div class="channel-card" onclick="showChannelPage('${channel.name}')">
        <h3>${channel.name}</h3>
        <p>ساخته شده توسط: ${channel.creator}</p>
        <p>تعداد اعضا: ${channel.users.length}</p>
      </div>
    `;
  });
  
  elements.channelsList.innerHTML = html || '<p>چنلی وجود ندارد</p>';
});

socket.on('channel-users', (data) => {
  currentChannel = data.channel;
  currentChannelUsers = data.users;
  renderChannelUsersList();
});

socket.on('user-added-to-channel', (data) => {
  if (data.channel === currentChannel) {
    loadChannelUsers(currentChannel);
  }
  addMessage(`کاربر ${data.username} به چنل ${data.channel} اضافه شد`, 'server');
});

socket.on('user-removed-from-channel', (username) => {
  addMessage(`کاربر ${username} از چنل حذف شد`, 'server');
  if (currentChannel) {
    loadChannelUsers(currentChannel);
  }
});

socket.on('user-mute-updated', (data) => {
  addMessage(`کاربر ${data.username} ${data.status ? 'سکوت شد' : 'از سکوت خارج شد'}`, 'server');
  if (currentChannel) {
    loadChannelUsers(currentChannel);
  }
});

socket.on('message-history', (messages) => {
  messageHistory = messages;
  elements.messagesContainer.innerHTML = '';
  messages.forEach(msg => {
    if (msg.type === 'voice') {
      // پخش خودکار آخرین پیام
      if (messages.indexOf(msg) === messages.length - 1) {
        playAudio(msg.audio);
      }
      addMessage(`${msg.username} (پیام قبلی)`, 'info', msg.audio);
    }
  });
});

socket.on('replay-messages', (messages) => {
  elements.messagesContainer.innerHTML = '';
  messages.forEach(msg => {
    if (msg.type === 'voice') {
      playAudio(msg.audio);
      addMessage(`${msg.username} (پخش مجدد)`, 'info', msg.audio);
    }
  });
});

// به‌روزرسانی لیست کاربران
function updateUserList(users) {
  elements.usersList.innerHTML = users.map(user => `
    <li>
      ${user.username} (${user.role})
      ${user.muted ? '(سکوت)' : ''}
      <button onclick="requestReplay('${user.username}')">پخش مجدد</button>
    </li>
  `).join('');
}

// درخواست پخش مجدد پیام‌های کاربر
function requestReplay(username) {
  socket.emit('request-replay', {
    username,
    channel: currentChannel
  });
}

// توابع عمومی برای استفاده در HTML
window.playAudio = playAudio;
window.showChannelPage = showChannelPage;
window.addUserToChannel = addUserToChannel;
window.removeUserFromChannel = removeUserFromChannel;
window.toggleMuteUser = toggleMuteUser;
window.requestReplay = requestReplay;