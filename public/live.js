const API_BASE = '/api/v1';
const SOCKET_URL = window.location.origin;

let socket = null;
let player = null;
let hls = null;
let flvPlayer = null;
let currentRoomId = null;
let currentUserId = null;
let currentUserName = null;
let showDanmaku = true;
let danmakuColor = '#FFFFFF';
let likeCount = 0;
let onlineCount = 0;
let danmakuTracks = [];
const MAX_TRACKS = 10;

function getRoomId() {
    const pathParts = window.location.pathname.split('/');
    return pathParts[pathParts.length - 1] || new URLSearchParams(window.location.search).get('roomId');
}

function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

function initLogin() {
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const userName = document.getElementById('userName').value.trim();
        const password = document.getElementById('roomPassword').value;

        if (!userName || !password) {
            showLoginError('请填写完整信息');
            return;
        }

        const roomId = getRoomId();
        if (!roomId) {
            showLoginError('未找到直播间ID');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/live-rooms/${roomId}`);
            const result = await response.json();

            if (!result.success) {
                showLoginError('直播间不存在');
                return;
            }

            const room = result.data;
            
            if (room.status === 'NOT_STARTED') {
                showLoginError('直播尚未开始');
                return;
            }
            
            if (room.status === 'ENDED') {
                showLoginError('直播已结束');
                return;
            }

            currentRoomId = roomId;
            currentUserId = generateUserId();
            currentUserName = userName;

            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('liveScreen').style.display = 'block';
            
            document.getElementById('roomTitle').textContent = room.title || '直播间';
            
            initPlayer(room);
            initSocket();
            initDanmakuTracks();
            loadGifts();
            
        } catch (error) {
            showLoginError('连接服务器失败: ' + error.message);
        }
    });
}

function showLoginError(message) {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    setTimeout(() => errorEl.classList.remove('show'), 3000);
}

function initPlayer(room) {
    const videoElement = document.getElementById('videoPlayer');
    
    player = videojs('videoPlayer', {
        fluid: false,
        controls: true,
        autoplay: true,
        muted: true,
        preload: 'auto',
    });

    const streamKey = room.streamKey;
    const hlsUrl = `/hls/${streamKey}/index.m3u8`;
    const flvUrl = `/live/${streamKey}.flv`;

    if (Hls.isSupported()) {
        hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            liveSyncDurationCount: 3,
        });

        hls.loadSource(hlsUrl);
        hls.attachMedia(videoElement);

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.log('HLS error, trying FLV...');
                if (flvjs.isSupported()) {
                    initFlvPlayer(flvUrl);
                }
            }
        });
    } else if (flvjs.isSupported()) {
        initFlvPlayer(flvUrl);
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
        videoElement.src = hlsUrl;
        videoElement.play();
    }
}

function initFlvPlayer(url) {
    if (flvPlayer) {
        flvPlayer.destroy();
    }
    
    flvPlayer = flvjs.createPlayer({
        type: 'flv',
        url: url,
        isLive: true,
        cors: true,
    });

    flvPlayer.attachMediaElement(document.getElementById('videoPlayer'));
    flvPlayer.load();
    flvPlayer.play();

    flvPlayer.on(flvjs.Events.ERROR, (errorType, errorDetail, errorInfo) => {
        console.error('FLV error:', errorType, errorDetail, errorInfo);
    });
}

function initSocket() {
    socket = io(SOCKET_URL + '/live', {
        transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
        console.log('Connected to WebSocket');
        
        socket.emit('join-room', {
            liveRoomId: currentRoomId,
            userId: currentUserId,
            userName: currentUserName,
            protocol: 'hls',
        });
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from WebSocket');
    });

    socket.on('user-joined', (data) => {
        addSystemMessage(`${data.userName} 加入了直播间`);
        updateOnlineCount(data.onlineCount);
    });

    socket.on('user-left', (data) => {
        addSystemMessage(`用户离开了直播间`);
        updateOnlineCount(data.onlineCount);
    });

    socket.on('online-count', (data) => {
        updateOnlineCount(data.count);
    });

    socket.on('online-update', (data) => {
        updateOnlineCount(data.count);
        updateOnlineList(data.users || []);
    });

    socket.on('danmaku', (data) => {
        addChatMessage(data.userName, data.content, data.color);
        
        if (showDanmaku) {
            showDanmakuOnVideo(data);
        }
    });

    socket.on('danmaku-history', (data) => {
        if (Array.isArray(data)) {
            data.forEach(d => {
                addChatMessage(d.userName, d.content, d.color);
            });
        }
    });

    socket.on('gift', (data) => {
        addGiftMessage(data);
        showGiftAnimation(data);
    });

    socket.on('like', (data) => {
        updateLikeCount(data.count);
    });
}

function initDanmakuTracks() {
    danmakuTracks = new Array(MAX_TRACKS).fill(null);
}

function showDanmakuOnVideo(data) {
    const layer = document.getElementById('danmakuLayer');
    const videoWrapper = document.querySelector('.video-wrapper');
    
    if (!layer || !videoWrapper) return;

    const danmaku = document.createElement('div');
    danmaku.className = 'danmaku-item';
    danmaku.textContent = `${data.userName}: ${data.content}`;
    danmaku.style.color = data.color || '#FFFFFF';
    danmaku.style.fontSize = (data.fontSize || 24) + 'px';

    const trackIndex = findAvailableTrack();
    const videoHeight = videoWrapper.clientHeight;
    const trackHeight = videoHeight / MAX_TRACKS;
    
    danmaku.style.top = (trackIndex * trackHeight + 10) + 'px';
    
    const duration = 8 + Math.random() * 4;
    danmaku.style.animationDuration = duration + 's';

    danmakuTracks[trackIndex] = Date.now() + duration * 1000;

    layer.appendChild(danmaku);

    setTimeout(() => {
        danmaku.remove();
    }, duration * 1000);
}

function findAvailableTrack() {
    const now = Date.now();
    for (let i = 0; i < danmakuTracks.length; i++) {
        if (!danmakuTracks[i] || danmakuTracks[i] < now) {
            return i;
        }
    }
    return Math.floor(Math.random() * MAX_TRACKS);
}

function addChatMessage(userName, content, color = '#667eea') {
    const container = document.getElementById('chatMessages');
    const message = document.createElement('div');
    message.className = 'chat-message';
    message.innerHTML = `<span class="user-name" style="color: ${color}">${userName}:</span>${content}`;
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
}

function addSystemMessage(content) {
    const container = document.getElementById('chatMessages');
    const message = document.createElement('div');
    message.className = 'chat-message system-message';
    message.textContent = content;
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
}

function addGiftMessage(data) {
    const container = document.getElementById('chatMessages');
    const message = document.createElement('div');
    message.className = 'chat-message gift-message';
    message.innerHTML = `<span class="user-name">${data.userName}</span> 送出了 <strong>${data.quantity} 个 ${data.giftName}</strong> 🎁`;
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;

    const historyContainer = document.getElementById('giftHistory');
    if (historyContainer) {
        const historyItem = document.createElement('div');
        historyItem.className = 'gift-history-item';
        historyItem.innerHTML = `
            <span class="user">${data.userName}</span>
            <span class="gift-info">${data.giftName} x${data.quantity}</span>
        `;
        historyContainer.insertBefore(historyItem, historyContainer.firstChild);
        
        while (historyContainer.children.length > 20) {
            historyContainer.removeChild(historyContainer.lastChild);
        }
    }
}

function showGiftAnimation(data) {
    const container = document.getElementById('giftAnimation');
    const gift = document.createElement('div');
    gift.className = 'gift-animation-item';
    gift.textContent = data.iconUrl || '🎁';
    gift.style.left = (Math.random() * 100 - 50) + 'px';
    container.appendChild(gift);

    setTimeout(() => gift.remove(), 1000);
}

function updateOnlineCount(count) {
    onlineCount = count;
    document.getElementById('viewerCount').textContent = `👥 ${count} 人观看`;
}

function updateLikeCount(count) {
    likeCount = count;
    document.getElementById('likeCount').textContent = `❤️ ${count} 点赞`;
}

function updateOnlineList(users) {
    const container = document.getElementById('onlineList');
    if (!container) return;
    
    container.innerHTML = users.slice(0, 50).map(user => `
        <div class="online-item">
            <div class="online-avatar">${user.userName.charAt(0).toUpperCase()}</div>
            <span>${user.userName}</span>
        </div>
    `).join('');
}

async function loadGifts() {
    try {
        const response = await fetch(`${API_BASE}/live-interact/gifts`);
        const result = await response.json();
        
        if (result.success && result.data.gifts) {
            renderGiftList(result.data.gifts);
        }
    } catch (error) {
        console.error('Failed to load gifts:', error);
    }
}

function renderGiftList(gifts) {
    const container = document.getElementById('giftList');
    container.innerHTML = gifts.map(gift => `
        <div class="gift-item" data-gift-id="${gift.id}" data-gift-name="${gift.name}" data-gift-icon="${gift.iconUrl}">
            <div class="gift-icon">${gift.iconUrl || '🎁'}</div>
            <div class="gift-name">${gift.name}</div>
            <div class="gift-value">${gift.value} 积分</div>
        </div>
    `).join('');

    container.querySelectorAll('.gift-item').forEach(item => {
        item.addEventListener('click', () => {
            const giftId = item.dataset.giftId;
            const giftName = item.dataset.giftName;
            const giftIcon = item.dataset.giftIcon;
            sendGift(giftId, giftName, giftIcon);
        });
    });
}

function sendGift(giftId, giftName, giftIcon) {
    if (!socket) return;

    socket.emit('send-gift', {
        liveRoomId: currentRoomId,
        giftId: giftId,
        userId: currentUserId,
        userName: currentUserName,
        quantity: 1,
    });
}

function sendLike() {
    if (!socket) return;

    const likeBtn = document.getElementById('likeBtn');
    likeBtn.classList.add('liked');
    setTimeout(() => likeBtn.classList.remove('liked'), 300);

    showLikeAnimation();

    socket.emit('send-like', {
        liveRoomId: currentRoomId,
        userId: currentUserId,
        count: 1,
    });
}

function showLikeAnimation() {
    const videoWrapper = document.querySelector('.video-wrapper');
    if (!videoWrapper) return;

    const like = document.createElement('div');
    like.className = 'like-animation';
    like.textContent = '❤️';
    like.style.left = (50 + Math.random() * 100) + 'px';
    like.style.bottom = '100px';
    videoWrapper.appendChild(like);

    setTimeout(() => like.remove(), 1000);
}

function sendDanmaku() {
    const input = document.getElementById('danmakuInput');
    const content = input.value.trim();

    if (!content || !socket) return;

    socket.emit('send-danmaku', {
        liveRoomId: currentRoomId,
        userId: currentUserId,
        userName: currentUserName,
        content: content,
        color: danmakuColor,
        fontSize: 24,
        mode: 1,
    });

    input.value = '';
}

function initEventListeners() {
    document.getElementById('sendDanmakuBtn').addEventListener('click', sendDanmaku);
    
    document.getElementById('danmakuInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendDanmaku();
        }
    });

    document.getElementById('likeBtn').addEventListener('click', sendLike);

    document.getElementById('showDanmaku').addEventListener('change', (e) => {
        showDanmaku = e.target.checked;
    });

    document.getElementById('danmakuColor').addEventListener('change', (e) => {
        danmakuColor = e.target.value;
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(tabName + 'Panel').classList.add('active');
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            sendLike();
        }
    });
}

function cleanup() {
    if (socket) {
        socket.emit('leave-room', {
            liveRoomId: currentRoomId,
            userId: currentUserId,
        });
        socket.disconnect();
    }
    
    if (hls) {
        hls.destroy();
    }
    
    if (flvPlayer) {
        flvPlayer.destroy();
    }
    
    if (player) {
        player.dispose();
    }
}

window.addEventListener('load', () => {
    initLogin();
    initEventListeners();
});

window.addEventListener('beforeunload', cleanup);
