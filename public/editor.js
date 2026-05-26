const API_BASE = '/api/v1/video-edit';

let projectId = null;
let project = null;
let timeline = null;
let selectedClipId = null;
let selectedTrackId = null;
let currentTime = 0;
let duration = 0;
let isPlaying = false;
let zoomLevel = 50;
let pixelsPerSecond = zoomLevel;

function goBack() {
  window.history.back();
}

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function formatRulerTime(seconds) {
  if (seconds == null || isNaN(seconds)) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateUndoRedoButtons() {
  fetch(`${API_BASE}/${projectId}/undo-redo-status`)
    .then(r => r.json())
    .then(data => {
      document.getElementById('undoBtn').disabled = !data.data.canUndo;
      document.getElementById('redoBtn').disabled = !data.data.canRedo;
    });
}

async function createProject() {
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '未命名项目',
        width: 1920,
        height: 1080,
        fps: 30,
      }),
    });
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Failed to create project:', error);
    return null;
  }
}

function sourcePathToUrl(sourcePath) {
  if (!sourcePath) return '';
  const normalized = sourcePath.replace(/\\/g, '/');
  const idx = normalized.indexOf('/uploads/');
  if (idx >= 0) {
    return normalized.substring(idx);
  }
  return '/uploads/' + normalized.split('/').filter(Boolean).slice(-2).join('/');
}

function updateVideoPlayerSource() {
  const video = document.getElementById('previewVideo');
  if (!video) return;
  
  if (!timeline?.tracks) return;
  
  let firstVideoClip = null;
  for (const track of timeline.tracks) {
    if (track.type === 'VIDEO' && track.clips?.length > 0) {
      firstVideoClip = track.clips[0];
      break;
    }
  }
  
  if (firstVideoClip?.sourcePath) {
    const url = sourcePathToUrl(firstVideoClip.sourcePath);
    if (video.src !== url) {
      video.src = url;
      video.load();
    }
  }
}

function initVideoPlayerSync() {
  const video = document.getElementById('previewVideo');
  if (!video) return;
  
  video.addEventListener('timeupdate', () => {
    currentTime = video.currentTime;
    document.getElementById('currentTime').textContent = formatTime(currentTime);
    updatePlayhead();
    updateTextOverlay();
  });
  
  video.addEventListener('play', () => {
    isPlaying = true;
    document.getElementById('playBtn').textContent = '⏸';
  });
  
  video.addEventListener('pause', () => {
    isPlaying = false;
    document.getElementById('playBtn').textContent = '▶';
  });
  
  video.addEventListener('ended', () => {
    isPlaying = false;
    document.getElementById('playBtn').textContent = '▶';
  });
  
  video.addEventListener('loadedmetadata', () => {
    updateTextOverlay();
  });
  
  video.addEventListener('error', (e) => {
    console.error('Video playback error:', e);
  });
}

function updateTextOverlay() {
  const overlay = document.getElementById('textOverlay');
  if (!overlay) return;
  
  if (overlay.querySelector('.overlay-text.editing')) return;
  
  overlay.innerHTML = '';
  
  if (!timeline?.tracks) return;
  
  const video = document.getElementById('previewVideo');
  const videoWidth = video?.videoWidth || 1920;
  const videoHeight = video?.videoHeight || 1080;
  
  const wrapper = overlay.parentElement;
  if (wrapper && videoWidth && videoHeight) {
    wrapper.style.aspectRatio = videoWidth + ' / ' + videoHeight;
  }
  
  for (const track of timeline.tracks) {
    if (!track.clips) continue;
    
    for (const clip of track.clips) {
      if (currentTime < clip.startTime || currentTime > clip.endTime) continue;
      
      if (!clip.effects) continue;
      
      for (const effect of clip.effects) {
        if (effect.type !== 'TEXT') continue;
        
        const params = effect.parameters || {};
        const text = params.text || '';
        if (!text) continue;
        
        const textEl = document.createElement('div');
        textEl.className = 'overlay-text';
        
        const fontSize = params.fontSize || 24;
        const color = params.color || params.fontColor || '#ffffff';
        const xPercent = params.x ?? params.positionX ?? 50;
        const yPercent = params.y ?? params.positionY ?? 50;
        
        textEl.textContent = text;
        textEl.dataset.clipId = clip.id;
        textEl.dataset.effectId = effect.id;
        textEl.style.fontSize = (fontSize * (video.videoHeight / videoHeight) * 0.5) + 'px';
        textEl.style.color = color;
        textEl.style.left = xPercent + '%';
        textEl.style.top = yPercent + '%';
        
        if (effect.textType === 'WATERMARK') {
          textEl.style.opacity = '0.6';
        }
        
        textEl.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          editTextEffect(clip.id, effect.id, textEl);
        });
        
        overlay.appendChild(textEl);
      }
    }
  }
}

function editTextEffect(clipId, effectId, textEl) {
  const overlay = document.getElementById('textOverlay');
  overlay.querySelectorAll('.overlay-text.selected').forEach(el => el.classList.remove('selected'));
  textEl.classList.add('selected');
  
  if (textEl.classList.contains('editing')) return;
  
  const currentText = textEl.textContent;
  textEl.classList.add('editing');
  textEl.textContent = '';
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentText;
  textEl.appendChild(input);
  input.focus();
  input.select();
  
  const finishEdit = async (save) => {
    const newText = input.value;
    textEl.classList.remove('editing');
    textEl.classList.remove('selected');
    textEl.innerHTML = '';
    
    if (save && newText && newText !== currentText) {
      try {
        await fetch(`${API_BASE}/${projectId}/effects/${effectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parameters: { text: newText },
          }),
        });
        await loadProject(projectId);
      } catch (error) {
        console.error('Failed to update text:', error);
        textEl.textContent = currentText;
      }
    }
    updateTextOverlay();
  };
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    }
  });
  
  input.addEventListener('blur', () => {
    finishEdit(true);
  });
}

async function loadProject(pid) {
  try {
    projectId = pid;
    const [projectResp, timelineResp] = await Promise.all([
      fetch(`${API_BASE}/${pid}`),
      fetch(`${API_BASE}/${pid}/timeline`),
    ]);
    
    const projectData = await projectResp.json();
    const timelineData = await timelineResp.json();
    
    project = projectData.data;
    timeline = timelineData.data;
    duration = timeline.duration || 60;
    
    document.getElementById('projectName').value = project.name;
    document.getElementById('totalTime').textContent = formatTime(duration);
    
    renderTimeline();
    renderTracks();
    updateUndoRedoButtons();
    updateVideoPlayerSource();
    updateTextOverlay();
  } catch (error) {
    console.error('Failed to load project:', error);
  }
}

async function updateProjectName() {
  if (!projectId) return;
  
  const name = document.getElementById('projectName').value;
  try {
    await fetch(`${API_BASE}/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch (error) {
    console.error('Failed to update project name:', error);
  }
}

async function saveProject() {
  alert('项目已自动保存');
}

async function undo() {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/undo`, { method: 'POST' });
    await loadProject(projectId);
  } catch (error) {
    console.error('Undo failed:', error);
  }
}

async function redo() {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/redo`, { method: 'POST' });
    await loadProject(projectId);
  } catch (error) {
    console.error('Redo failed:', error);
  }
}

function seekTo(time) {
  currentTime = Math.max(0, Math.min(time, duration));
  document.getElementById('currentTime').textContent = formatTime(currentTime);
  updatePlayhead();
  
  const video = document.getElementById('previewVideo');
  if (video && !isNaN(video.duration) && Math.abs(video.currentTime - currentTime) > 0.1) {
    video.currentTime = currentTime;
  }
}

function togglePlay() {
  const video = document.getElementById('previewVideo');
  
  if (video && video.src) {
    if (isPlaying) {
      video.pause();
      isPlaying = false;
      document.getElementById('playBtn').textContent = '▶';
    } else {
      video.play().catch(e => console.error('Play failed:', e));
      isPlaying = true;
      document.getElementById('playBtn').textContent = '⏸';
    }
  } else {
    isPlaying = !isPlaying;
    const btn = document.getElementById('playBtn');
    btn.textContent = isPlaying ? '⏸' : '▶';
    if (isPlaying) {
      playLoop();
    }
  }
}

function playLoop() {
  if (!isPlaying) return;
  
  currentTime += 1/30;
  if (currentTime >= duration) {
    currentTime = 0;
    isPlaying = false;
    document.getElementById('playBtn').textContent = '▶';
  }
  
  document.getElementById('currentTime').textContent = formatTime(currentTime);
  updatePlayhead();
  
  if (isPlaying) {
    requestAnimationFrame(playLoop);
  }
}

function stepBackward() {
  seekTo(Math.max(0, currentTime - 1/30));
}

function stepForward() {
  seekTo(Math.min(duration, currentTime + 1/30));
}

function updatePlayhead() {
  const playhead = document.getElementById('playhead');
  const left = currentTime * pixelsPerSecond;
  playhead.style.left = left + 'px';
}

function zoomIn() {
  zoomLevel = Math.min(200, zoomLevel + 25);
  pixelsPerSecond = zoomLevel;
  renderTimeline();
  renderTracks();
  updatePlayhead();
}

function zoomOut() {
  zoomLevel = Math.max(10, zoomLevel - 25);
  pixelsPerSecond = zoomLevel;
  renderTimeline();
  renderTracks();
  updatePlayhead();
}

function fitToWindow() {
  const rulerWidth = document.getElementById('timelineRuler').clientWidth;
  pixelsPerSecond = rulerWidth / duration;
  renderTimeline();
  renderTracks();
  updatePlayhead();
}

function renderTimeline() {
  const ruler = document.getElementById('timelineRuler');
  ruler.innerHTML = '';
  
  const interval = pixelsPerSecond >= 50 ? 1 : pixelsPerSecond >= 25 ? 2 : 5;
  
  for (let t = 0; t <= duration; t += interval) {
    const marker = document.createElement('div');
    marker.className = 'ruler-marker';
    marker.style.left = (t * pixelsPerSecond) + 'px';
    
    if (t % 60 === 0) {
      marker.innerHTML = formatRulerTime(t);
      marker.style.borderLeftWidth = '2px';
    } else if (t % 10 === 0) {
      marker.innerHTML = formatRulerTime(t);
    }
    
    ruler.appendChild(marker);
  }
  
  ruler.style.width = (duration * pixelsPerSecond + 100) + 'px';
}

function renderTracks() {
  const trackHeadersEl = document.getElementById('trackHeaders');
  const tracksAreaEl = document.getElementById('tracksArea');
  const timelineScrollContent = document.getElementById('timelineScrollContent');
  
  trackHeadersEl.innerHTML = '';
  tracksAreaEl.innerHTML = '';
  
  if (!timeline?.tracks) return;
  
  const contentWidth = duration * pixelsPerSecond + 100;
  timelineScrollContent.style.minWidth = contentWidth + 'px';
  
  timeline.tracks.forEach(track => {
    const trackIcons = { VIDEO: '🎬', AUDIO: '🎵', SUBTITLE: '📝' };
    
    const headerRow = document.createElement('div');
    headerRow.className = 'track-header-row';
    headerRow.dataset.trackId = track.id;
    headerRow.innerHTML = `
      <div class="track-icon">${trackIcons[track.type] || '📦'}</div>
      <div class="track-name">${track.name}</div>
    `;
    trackHeadersEl.appendChild(headerRow);
    
    const trackEl = document.createElement('div');
    trackEl.className = `track ${track.type.toLowerCase()}`;
    trackEl.dataset.trackId = track.id;
    trackEl.innerHTML = `
      <div class="track-content">
        <div class="clips-container" style="min-width: ${contentWidth}px;">
          ${renderClips(track)}
        </div>
      </div>
    `;
    tracksAreaEl.appendChild(trackEl);
  });
  
  const addTrackBtn = document.createElement('div');
  addTrackBtn.className = 'add-track-btn-wrapper';
  addTrackBtn.innerHTML = `
    <button class="add-track-btn" onclick="showAddTrackMenu()">+ 添加轨道</button>
  `;
  tracksAreaEl.appendChild(addTrackBtn);
  
  const addTrackHeader = document.createElement('div');
  addTrackHeader.className = 'add-track-header';
  trackHeadersEl.appendChild(addTrackHeader);
  
  document.querySelectorAll('.clip').forEach(clipEl => {
    clipEl.addEventListener('click', (e) => {
      e.stopPropagation();
      selectClip(clipEl.dataset.clipId);
    });
    
    clipEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const clipId = clipEl.dataset.clipId;
      splitClipAtPlayhead(clipId);
    });
    
    const leftHandle = clipEl.querySelector('.clip-handle.left');
    const rightHandle = clipEl.querySelector('.clip-handle.right');
    
    if (leftHandle) {
      leftHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startClipResize(clipEl.dataset.clipId, 'left', e);
      });
    }
    
    if (rightHandle) {
      rightHandle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        startClipResize(clipEl.dataset.clipId, 'right', e);
      });
    }
  });
  
  document.querySelectorAll('.track-content').forEach(trackContent => {
    trackContent.addEventListener('click', (e) => {
      if (e.target === trackContent || e.target.classList.contains('clips-container')) {
        const rect = trackContent.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const time = clickX / pixelsPerSecond;
        seekTo(time);
      }
    });
    
    trackContent.addEventListener('dragover', (e) => {
      if (draggedMediaItem) {
        const trackEl = trackContent.closest('.track');
        const trackId = trackEl?.dataset.trackId;
        const track = timeline?.tracks?.find(t => t.id === trackId);
        const mediaItem = findMediaItemById(draggedMediaItem);
        
        if (track && mediaItem && isDropAllowed(track.type, mediaItem.type)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          trackContent.classList.add('drag-over');
        }
      }
    });
    
    trackContent.addEventListener('dragleave', (e) => {
      trackContent.classList.remove('drag-over');
    });
    
    trackContent.addEventListener('drop', async (e) => {
      e.preventDefault();
      trackContent.classList.remove('drag-over');
      
      if (draggedMediaItem) {
        const trackEl = trackContent.closest('.track');
        const trackId = trackEl?.dataset.trackId;
        const track = timeline?.tracks?.find(t => t.id === trackId);
        const mediaItem = findMediaItemById(draggedMediaItem);
        
        if (track && mediaItem && isDropAllowed(track.type, mediaItem.type)) {
          const rect = trackContent.getBoundingClientRect();
          const dropX = e.clientX - rect.left;
          const dropTime = Math.max(0, dropX / pixelsPerSecond);
          
          currentTime = dropTime;
          await addMediaToTimeline(draggedMediaItem, trackId);
          document.getElementById('currentTime').textContent = formatTime(currentTime);
          updatePlayhead();
        }
        draggedMediaItem = null;
      }
    });
  });
}

function findMediaItemById(id) {
  return mediaItems.find(m => m.id === id);
}

function isDropAllowed(trackType, mediaType) {
  if (trackType === 'VIDEO' && mediaType === 'video') return true;
  if (trackType === 'VIDEO' && mediaType === 'audio') return true;
  if (trackType === 'AUDIO' && mediaType === 'audio') return true;
  if (trackType === 'SUBTITLE' && mediaType === 'subtitle') return true;
  return false;
}

async function addMediaToTimeline(mediaId, trackId) {
  if (!projectId) return;
  const mediaItem = findMediaItemById(mediaId);
  
  try {
    await fetch(`${API_BASE}/${projectId}/tracks/${trackId}/clips/add-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: mediaId, startTime: currentTime }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
  } catch (error) {
    console.error('Failed to add media to timeline:', error);
  }
}

function renderClips(track) {
  if (!track.clips) return '';
  
  return track.clips.map(clip => {
    const left = clip.startTime * pixelsPerSecond;
    const width = clip.duration * pixelsPerSecond;
    const isSelected = clip.id === selectedClipId;
    
    return `
      <div class="clip ${isSelected ? 'selected' : ''}" 
           data-clip-id="${clip.id}"
           style="left: ${left}px; width: ${width}px;">
        <div class="clip-thumbnail">
          ${clip.thumbnailUrl ? `<img src="${clip.thumbnailUrl}" alt="">` : ''}
        </div>
        <div class="clip-label">${clip.name || '片段'}</div>
        <div class="clip-handle left"></div>
        <div class="clip-handle right"></div>
      </div>
    `;
  }).join('');
}

function selectClip(clipId) {
  selectedClipId = clipId;
  selectedTrackId = null;
  
  document.querySelectorAll('.clip').forEach(el => {
    el.classList.toggle('selected', el.dataset.clipId === clipId);
  });
  
  renderClipProperties(clipId);
}

function renderClipProperties(clipId) {
  const clip = findClipById(clipId);
  if (!clip) return;
  
  const content = document.getElementById('propertiesContent');
  content.innerHTML = `
    <div class="property-group">
      <label>片段名称</label>
      <input type="text" value="${clip.name || ''}" onchange="updateClipProperty('${clipId}', 'name', this.value)">
    </div>
    <div class="property-group">
      <label>开始时间 (秒)</label>
      <input type="number" value="${clip.startTime.toFixed(3)}" step="0.001" 
             onchange="updateClipProperty('${clipId}', 'startTime', parseFloat(this.value))">
    </div>
    <div class="property-group">
      <label>持续时间 (秒)</label>
      <input type="number" value="${clip.duration.toFixed(3)}" step="0.001" 
             onchange="updateClipProperty('${clipId}', 'duration', parseFloat(this.value))">
    </div>
    <div class="property-group">
      <label>速度倍率</label>
      <input type="number" value="${clip.speed || 1}" min="0.1" max="10" step="0.1"
             onchange="updateClipSpeed('${clipId}', parseFloat(this.value))">
    </div>
    <div class="property-group">
      <label>音量</label>
      <input type="range" min="0" max="200" value="${(clip.volume || 1) * 100}"
             onchange="updateClipVolume('${clipId}', this.value / 100)">
    </div>
    <div class="property-group">
      <button class="btn btn-secondary w-full" onclick="splitClipAtPlayhead('${clipId}')">在播放头分割</button>
    </div>
    <div class="property-group">
      <button class="btn btn-secondary w-full" style="background: #c0392b;" 
              onclick="deleteClip('${clipId}')">删除片段</button>
    </div>
  `;
}

function findClipById(clipId) {
  if (!timeline?.tracks) return null;
  
  for (const track of timeline.tracks) {
    const clip = track.clips?.find(c => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

async function updateClipProperty(clipId, property, value) {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [property]: value }),
    });
    await loadProject(projectId);
  } catch (error) {
    console.error('Failed to update clip:', error);
  }
}

async function updateClipSpeed(clipId, speed) {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}/speed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed }),
    });
    await loadProject(projectId);
  } catch (error) {
    console.error('Failed to update speed:', error);
  }
}

async function updateClipVolume(clipId, volume) {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    });
  } catch (error) {
    console.error('Failed to update volume:', error);
  }
}

async function splitClipAtPlayhead(clipId) {
  if (!projectId) return;
  
  const clip = findClipById(clipId);
  if (!clip) return;
  
  const splitTime = currentTime - clip.startTime;
  if (splitTime <= 0 || splitTime >= clip.duration) {
    alert('请将播放头移动到片段内');
    return;
  }
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ splitTime }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
  } catch (error) {
    console.error('Failed to split clip:', error);
  }
}

async function deleteClip(clipId) {
  if (!projectId || !confirm('确定要删除这个片段吗？')) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}`, { method: 'DELETE' });
    selectedClipId = null;
    await loadProject(projectId);
    updateUndoRedoButtons();
    
    document.getElementById('propertiesContent').innerHTML = 
      '<p class="empty-state">选择一个片段或轨道来查看属性</p>';
  } catch (error) {
    console.error('Failed to delete clip:', error);
  }
}

let isResizing = false;
let resizeClipId = null;
let resizeEdge = null;
let resizeStartX = 0;
let resizeStartTime = 0;
let resizeStartDuration = 0;

function startClipResize(clipId, edge, e) {
  isResizing = true;
  resizeClipId = clipId;
  resizeEdge = edge;
  resizeStartX = e.clientX;
  
  const clip = findClipById(clipId);
  if (clip) {
    resizeStartTime = clip.startTime;
    resizeStartDuration = clip.duration;
  }
  
  document.addEventListener('mousemove', handleClipResize);
  document.addEventListener('mouseup', endClipResize);
}

function handleClipResize(e) {
  if (!isResizing) return;
  
  const deltaX = e.clientX - resizeStartX;
  const deltaTime = deltaX / pixelsPerSecond;
  
  const clip = findClipById(resizeClipId);
  if (!clip) return;
  
  if (resizeEdge === 'left') {
    const newStartTime = Math.max(0, resizeStartTime + deltaTime);
    const newDuration = Math.max(0.1, resizeStartDuration - deltaTime);
    updateClipProperty(resizeClipId, 'startTime', newStartTime);
    updateClipProperty(resizeClipId, 'duration', newDuration);
  } else if (resizeEdge === 'right') {
    const newDuration = Math.max(0.1, resizeStartDuration + deltaTime);
    updateClipProperty(resizeClipId, 'duration', newDuration);
  }
}

function endClipResize() {
  isResizing = false;
  resizeClipId = null;
  document.removeEventListener('mousemove', handleClipResize);
  document.removeEventListener('mouseup', endClipResize);
  loadProject(projectId);
  updateUndoRedoButtons();
}

let draggedMediaItem = null;
let mediaItems = [];

function initDragDrop() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  
  uploadArea.addEventListener('click', () => fileInput.click());
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
  });
}

async function handleFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/') && !file.type.startsWith('image/')) {
      continue;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const uploadResp = await fetch('/api/v1/upload/video', {
        method: 'POST',
        body: formData,
      });
      
      const uploadData = await uploadResp.json();
      if (uploadData.success && uploadData.data) {
        addMediaItem(uploadData.data);
        
        if (file.type.startsWith('video/') && timeline?.tracks?.[0]) {
          await addVideoToTimeline(uploadData.data.id, timeline.tracks[0].id);
        }
      }
    } catch (error) {
      console.error('Upload failed:', error);
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function addMediaItem(media) {
  const mediaList = document.getElementById('mediaList');
  const item = document.createElement('div');
  item.className = 'media-item';
  item.draggable = true;
  item.dataset.videoId = media.id;
  
  let mediaType = media.type;
  if (!mediaType) {
    if (media.originalName) {
      const ext = media.originalName.split('.').pop().toLowerCase();
      if (['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'].includes(ext)) mediaType = 'audio';
      else mediaType = 'video';
    } else {
      mediaType = 'video';
    }
  }
  item.dataset.mediaType = mediaType;
  media.type = mediaType;
  
  mediaItems.push(media);
  
  const name = escapeHtml(media.originalName || media.name || '未命名');
  
  item.innerHTML = `
    ${media.thumbnailUrl ? `<img src="${media.thumbnailUrl}" alt="">` : 
      mediaType === 'audio' ? '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;">🎵</div>' :
      '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;">🎬</div>'}
    <div class="media-name">${name}</div>
  `;
  
  item.addEventListener('dblclick', async () => {
    if (timeline?.tracks?.[0]) {
      await addVideoToTimeline(media.id, timeline.tracks[0].id);
    }
  });
  
  item.addEventListener('dragstart', (e) => {
    draggedMediaItem = media.id;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', media.id);
  });
  
  item.addEventListener('dragend', () => {
    draggedMediaItem = null;
  });
  
  mediaList.appendChild(item);
}

async function addVideoToTimeline(videoId, trackId) {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/tracks/${trackId}/clips/add-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, startTime: currentTime }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
  } catch (error) {
    console.error('Failed to add video to timeline:', error);
  }
}

function showAddTrackMenu() {
  const types = [
    { type: 'VIDEO', name: '视频轨道' },
    { type: 'AUDIO', name: '音频轨道' },
    { type: 'SUBTITLE', name: '字幕轨道' },
  ];
  
  const typeNames = types.map(t => `${t.type} - ${t.name}`).join('\n');
  const choice = prompt(`选择轨道类型:\n${typeNames}\n\n输入 0, 1, 或 2:`, '0');
  
  if (choice !== null && types[parseInt(choice)]) {
    addTrack(types[parseInt(choice)].type);
  }
}

async function addTrack(type) {
  if (!projectId) return;
  
  const names = { VIDEO: '视频轨', AUDIO: '音频轨', SUBTITLE: '字幕轨' };
  const trackNum = (timeline?.tracks?.filter(t => t.type === type)?.length || 0) + 1;
  
  try {
    await fetch(`${API_BASE}/${projectId}/tracks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name: `${names[type]} ${trackNum}` }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
  } catch (error) {
    console.error('Failed to add track:', error);
  }
}

function initTabSwitching() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(tab + 'Tab').classList.add('active');
    });
  });
}

function initEffectItems() {
  document.querySelectorAll('.effect-item[data-type]').forEach(item => {
    item.addEventListener('click', () => {
      if (!selectedClipId) {
        alert('请先选择一个片段');
        return;
      }
      addTransition(selectedClipId, item.dataset.type);
    });
  });
  
  document.querySelectorAll('.effect-item[data-filter]').forEach(item => {
    item.addEventListener('click', () => {
      if (!selectedClipId) {
        alert('请先选择一个片段');
        return;
      }
      addFilter(selectedClipId, item.dataset.filter);
    });
  });
}

async function addTransition(clipId, transitionType) {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transitionType, duration: 0.5 }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
    alert('转场效果已添加');
  } catch (error) {
    console.error('Failed to add transition:', error);
  }
}

async function addFilter(clipId, filterType) {
  if (!projectId) return;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}/filters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filterType, intensity: 1.0 }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
    alert('滤镜效果已添加');
  } catch (error) {
    console.error('Failed to add filter:', error);
  }
}

function initTextPresets() {
  document.querySelectorAll('.text-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      if (!selectedClipId) {
        alert('请先选择一个片段');
        return;
      }
      addTextOverlay(selectedClipId, preset.dataset.type);
    });
  });
}

async function addTextOverlay(clipId, textType) {
  if (!projectId) return;
  
  const defaultTexts = {
    TITLE: { text: '点击编辑标题', fontSize: 48, x: 50, y: 20, color: '#ffffff' },
    SUBTITLE: { text: '点击编辑字幕', fontSize: 24, x: 50, y: 80, color: '#ffffff' },
    WATERMARK: { text: '水印文字', fontSize: 16, x: 90, y: 90, color: '#ffffff' },
  };
  
  const preset = defaultTexts[textType] || defaultTexts.SUBTITLE;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${clipId}/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        textType,
        parameters: {
          text: preset.text,
          fontSize: preset.fontSize,
          x: preset.x,
          y: preset.y,
          color: preset.color,
        },
      }),
    });
    await loadProject(projectId);
    updateUndoRedoButtons();
    updateTextOverlay();
    alert('文字叠加已添加');
  } catch (error) {
    console.error('Failed to add text overlay:', error);
  }
}

async function applyAudioEffect() {
  if (!selectedClipId) {
    alert('请先选择一个片段');
    return;
  }
  
  const volume = document.getElementById('volumeSlider').value / 100;
  const fadeIn = parseFloat(document.getElementById('fadeInDuration').value) || 0;
  const fadeOut = parseFloat(document.getElementById('fadeOutDuration').value) || 0;
  
  try {
    await fetch(`${API_BASE}/${projectId}/clips/${selectedClipId}/audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume, fadeIn, fadeOut }),
    });
    alert('音频效果已应用');
    updateUndoRedoButtons();
  } catch (error) {
    console.error('Failed to apply audio effect:', error);
  }
}

document.getElementById('volumeSlider').addEventListener('input', (e) => {
  document.getElementById('volumeValue').textContent = e.target.value + '%';
});

function openExportModal() {
  document.getElementById('exportModal').style.display = 'flex';
}

function closeExportModal() {
  document.getElementById('exportModal').style.display = 'none';
}

async function startExport() {
  if (!projectId) return;
  
  const format = document.getElementById('exportFormat').value;
  const resolution = document.getElementById('exportResolution').value;
  const fps = parseInt(document.getElementById('exportFps').value);
  const quality = document.getElementById('exportQuality').value;
  const bitrate = parseInt(document.getElementById('exportBitrate').value) * 1000000;
  
  const [width, height] = resolution.split('x').map(Number);
  
  closeExportModal();
  
  document.getElementById('exportProgress').style.display = 'flex';
  
  try {
    const response = await fetch(`${API_BASE}/${projectId}/exports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        width,
        height,
        fps,
        videoBitrate: bitrate,
        quality,
      }),
    });
    
    const data = await response.json();
    const exportJobId = data.data.id;
    
    monitorExportProgress(exportJobId);
  } catch (error) {
    console.error('Failed to start export:', error);
    document.getElementById('exportProgress').style.display = 'none';
    alert('导出失败: ' + error.message);
  }
}

function monitorExportProgress(exportJobId) {
  const interval = setInterval(async () => {
    try {
      const response = await fetch(`${API_BASE}/exports/${exportJobId}`);
      const data = await response.json();
      const job = data.data;
      
      const progress = job.progress || 0;
      document.getElementById('progressFill').style.width = progress + '%';
      document.getElementById('progressText').textContent = Math.round(progress) + '%';
      
      if (job.status === 'COMPLETED') {
        clearInterval(interval);
        document.getElementById('exportProgress').style.display = 'none';
        alert('导出完成！\n输出路径: ' + job.outputUrl);
        if (job.outputUrl) {
          window.open(job.outputUrl, '_blank');
        }
      } else if (job.status === 'FAILED') {
        clearInterval(interval);
        document.getElementById('exportProgress').style.display = 'none';
        alert('导出失败: ' + job.errorMessage);
      }
    } catch (error) {
      console.error('Failed to check export status:', error);
    }
  }, 1000);
}

async function init() {
  initDragDrop();
  initTabSwitching();
  initEffectItems();
  initTextPresets();
  initVideoPlayerSync();
  
  const pathParts = window.location.pathname.split('/');
  const urlProjectId = pathParts[pathParts.length - 1];
  
  if (urlProjectId && urlProjectId !== 'editor') {
    await loadProject(urlProjectId);
  } else {
    const newProject = await createProject();
    if (newProject) {
      history.replaceState(null, '', `/editor/${newProject.id}`);
      await loadProject(newProject.id);
    }
  }
  
  try {
    const response = await fetch('/api/v1/videos');
    const data = await response.json();
    if (data.data) {
      data.data.forEach(addMediaItem);
    }
  } catch (error) {
    console.error('Failed to load videos:', error);
  }
  
  document.getElementById('timelineRuler').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const time = clickX / pixelsPerSecond;
    seekTo(time);
  });
  
  updateUndoRedoButtons();
}

init();
