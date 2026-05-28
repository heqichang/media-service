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
  const compositionLayer = document.getElementById('compositionLayer');
  if (!compositionLayer) return;
  
  if (!timeline?.tracks) return;
  
  const baseWidth = project?.width || 1920;
  const baseHeight = project?.height || 1080;
  const wrapper = document.getElementById('previewWrapper');
  if (wrapper) {
    wrapper.style.aspectRatio = baseWidth + ' / ' + baseHeight;
    const paddingTop = (baseHeight / baseWidth) * 100;
    wrapper.style.setProperty('--aspect-padding', paddingTop + '%');
  }
  
  const allClips = [];
  for (let trackIdx = 0; trackIdx < timeline.tracks.length; trackIdx++) {
    const track = timeline.tracks[trackIdx];
    if (!track.clips) continue;
    
    for (const clip of track.clips) {
      allClips.push({ track, clip, trackIdx });
    }
  }
  
  allClips.sort((a, b) => a.clip.startTime - b.clip.startTime);
  
  compositionLayer.innerHTML = '';
  
  for (const { clip, track, trackIdx } of allClips) {
    if (!clip.sourcePath) continue;
    
    const url = sourcePathToUrl(clip.sourcePath);
    const mediaType = clip.sourceType || 'video';
    
    let mediaEl;
    if (mediaType === 'image') {
      mediaEl = document.createElement('img');
      mediaEl.src = url;
      mediaEl.crossOrigin = 'anonymous';
    } else {
      mediaEl = document.createElement('video');
      mediaEl.src = url;
      mediaEl.crossOrigin = 'anonymous';
      mediaEl.preload = 'auto';
      mediaEl.muted = track.type === 'AUDIO' ? false : (trackIdx !== 0);
      mediaEl.volume = clip.volume !== undefined ? clip.volume : 1;
    }
    
    mediaEl.dataset.clipId = clip.id;
    mediaEl.dataset.startTime = clip.startTime;
    mediaEl.dataset.endTime = clip.endTime;
    mediaEl.dataset.sourceIn = clip.sourceIn || 0;
    mediaEl.dataset.sourceOut = clip.sourceOut || clip.duration;
    mediaEl.dataset.trackIndex = trackIdx;
    
    const zIndex = (timeline.tracks.length - trackIdx) * 10;
    mediaEl.style.zIndex = zIndex;
    
    const opacity = clip.opacity !== undefined ? clip.opacity : 1;
    const scale = clip.scale !== undefined ? clip.scale : 1;
    const posX = clip.positionX !== undefined ? clip.positionX : 0;
    const posY = clip.positionY !== undefined ? clip.positionY : 0;
    const rotation = clip.rotation !== undefined ? clip.rotation : 0;
    
    mediaEl.style.opacity = opacity;
    mediaEl.style.transform = `translate(${posX}px, ${posY}px) scale(${scale}) rotate(${rotation}deg)`;
    mediaEl.style.display = currentTime >= clip.startTime && currentTime <= clip.endTime ? 'block' : 'none';
    
    if (mediaType === 'video') {
      mediaEl.addEventListener('loadedmetadata', () => {
        syncVideoToCurrentTime(mediaEl);
      });
      mediaEl.addEventListener('error', (e) => {
        console.error('Video load error:', url, e);
      });
    }
    
    compositionLayer.appendChild(mediaEl);
    
    if (clip.effects) {
      for (const effect of clip.effects) {
        if (effect.type !== 'TEXT') continue;
        const params = effect.parameters || {};
        const text = params.text || '';
        if (!text) continue;
        
        const textEl = document.createElement('div');
        textEl.className = 'composition-text';
        textEl.dataset.clipId = clip.id;
        textEl.dataset.effectId = effect.id;
        textEl.dataset.startTime = clip.startTime;
        textEl.dataset.endTime = clip.endTime;
        textEl.dataset.trackIndex = trackIdx;
        textEl.dataset.textType = effect.textType || 'TITLE';
        
        const fontSize = params.fontSize || 24;
        const color = params.color || params.fontColor || '#ffffff';
        const xPercent = params.x ?? params.positionX ?? 50;
        const yPercent = params.y ?? params.positionY ?? 50;
        
        textEl.textContent = text;
        textEl.style.fontSize = fontSize + 'px';
        textEl.style.color = color;
        textEl.style.left = xPercent + '%';
        textEl.style.top = yPercent + '%';
        textEl.style.zIndex = zIndex + 5;
        
        if (effect.textType === 'WATERMARK') {
          textEl.style.opacity = '0.6';
        }
        
        textEl.style.display = currentTime >= clip.startTime && currentTime <= clip.endTime ? 'block' : 'none';
        
        compositionLayer.appendChild(textEl);
      }
    }
  }
  
  const allVideos = compositionLayer.querySelectorAll('video');
  if (allVideos.length > 0) {
    const baseVideo = allVideos[0];
    if (baseVideo) {
      baseVideo.addEventListener('timeupdate', () => {
        currentTime = baseVideo.currentTime;
        document.getElementById('currentTime').textContent = formatTime(currentTime);
        updatePlayhead();
        updateMediaVisibility();
        updateTextOverlay();
      });
      
      baseVideo.addEventListener('play', () => {
        isPlaying = true;
        document.getElementById('playBtn').textContent = '⏸';
        syncAllVideos('play');
      });
      
      baseVideo.addEventListener('pause', () => {
        isPlaying = false;
        document.getElementById('playBtn').textContent = '▶';
        syncAllVideos('pause');
      });
      
      baseVideo.addEventListener('ended', () => {
        isPlaying = false;
        document.getElementById('playBtn').textContent = '▶';
        syncAllVideos('pause');
      });
    }
  }
}

function syncVideoToCurrentTime(videoEl) {
  const startTime = parseFloat(videoEl.dataset.startTime);
  const sourceIn = parseFloat(videoEl.dataset.sourceIn);
  const clipTime = currentTime - startTime + sourceIn;
  if (videoEl.readyState >= 1 && !isNaN(clipTime)) {
    try {
      videoEl.currentTime = Math.max(0, clipTime);
    } catch (e) {
    }
  }
}

function syncAllVideos(action) {
  const compositionLayer = document.getElementById('compositionLayer');
  if (!compositionLayer) return;
  
  const allVideos = compositionLayer.querySelectorAll('video');
  allVideos.forEach((video, idx) => {
    if (idx === 0) return;
    try {
      if (action === 'play') {
        video.play().catch(() => {});
      } else if (action === 'pause') {
        video.pause();
      }
    } catch (e) {
    }
  });
  
  updateMediaVisibility();
}

function updateMediaVisibility() {
  const compositionLayer = document.getElementById('compositionLayer');
  if (!compositionLayer) return;
  
  const allMedia = compositionLayer.querySelectorAll('video, img, .composition-text');
  allMedia.forEach(media => {
    const startTime = parseFloat(media.dataset.startTime);
    const endTime = parseFloat(media.dataset.endTime);
    const isVisible = currentTime >= startTime && currentTime <= endTime;
    media.style.display = isVisible ? 'block' : 'none';
    
    if (media.tagName === 'VIDEO' && isVisible) {
      syncVideoToCurrentTime(media);
    }
  });
  
  attachTextInteractionHandlers();
}

function getBaseVideo() {
  const compositionLayer = document.getElementById('compositionLayer');
  if (!compositionLayer) return null;
  return compositionLayer.querySelector('video');
}

function initVideoPlayerSync() {
}

function updateTextOverlay() {
  const compositionLayer = document.getElementById('compositionLayer');
  if (!compositionLayer) return;
  
  attachTextInteractionHandlers();
}

function attachTextInteractionHandlers() {
  const compositionLayer = document.getElementById('compositionLayer');
  if (!compositionLayer) return;
  
  const textEls = compositionLayer.querySelectorAll('.composition-text');
  
  textEls.forEach(textEl => {
    if (textEl.dataset.handlersAttached === 'true') return;
    textEl.dataset.handlersAttached = 'true';
    
    const clipId = textEl.dataset.clipId;
    const effectId = textEl.dataset.effectId;
    
    if (!effectId) return;
    
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle se';
    textEl.appendChild(resizeHandle);
    
    textEl.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle')) return;
      if (textEl.classList.contains('editing')) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      compositionLayer.querySelectorAll('.composition-text.selected').forEach(el => el.classList.remove('selected'));
      textEl.classList.add('selected');
      
      isDraggingText = true;
      activeTextEl = textEl;
      activeTextClipId = clipId;
      activeTextEffectId = effectId;
      textDragStartX = e.clientX;
      textDragStartY = e.clientY;
      
      const leftStr = textEl.style.left;
      const topStr = textEl.style.top;
      textStartX = parseFloat(leftStr) || 50;
      textStartY = parseFloat(topStr) || 50;
      
      document.addEventListener('mousemove', handleTextDrag);
      document.addEventListener('mouseup', handleTextDragEnd);
    });
    
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      isResizingText = true;
      activeTextEl = textEl;
      activeTextClipId = clipId;
      activeTextEffectId = effectId;
      textDragStartX = e.clientX;
      textDragStartY = e.clientY;
      
      const fontSizeStr = textEl.style.fontSize;
      textStartFontSize = parseFloat(fontSizeStr) || 24;
      
      document.addEventListener('mousemove', handleTextResize);
      document.addEventListener('mouseup', handleTextResizeEnd);
    });
    
    textEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('resize-handle')) return;
      if (isDraggingText || isResizingText) return;
      e.stopPropagation();
      e.preventDefault();
      
      const wasSelected = textEl.classList.contains('selected');
      compositionLayer.querySelectorAll('.composition-text.selected').forEach(el => el.classList.remove('selected'));
      
      if (wasSelected) {
        editTextEffect(clipId, effectId, textEl);
      } else {
        textEl.classList.add('selected');
      }
    });
  });
}

function handleTextDrag(e) {
  if (!isDraggingText || !activeTextEl) return;
  
  const wrapper = document.getElementById('previewWrapper');
  const rect = wrapper.getBoundingClientRect();
  
  const deltaX = e.clientX - textDragStartX;
  const deltaY = e.clientY - textDragStartY;
  
  const deltaXPercent = (deltaX / rect.width) * 100;
  const deltaYPercent = (deltaY / rect.height) * 100;
  
  const newX = Math.max(0, Math.min(100, textStartX + deltaXPercent));
  const newY = Math.max(0, Math.min(100, textStartY + deltaYPercent));
  
  activeTextEl.style.left = newX + '%';
  activeTextEl.style.top = newY + '%';
}

async function handleTextDragEnd() {
  if (!isDraggingText) return;
  
  isDraggingText = false;
  document.removeEventListener('mousemove', handleTextDrag);
  document.removeEventListener('mouseup', handleTextDragEnd);
  
  if (!activeTextEl || !activeTextEffectId || !activeTextClipId) return;
  
  const wrapper = document.getElementById('previewWrapper');
  const rect = wrapper.getBoundingClientRect();
  const deltaX = (event.clientX - textDragStartX) / rect.width * 100;
  const deltaY = (event.clientY - textDragStartY) / rect.height * 100;
  
  const newX = Math.max(0, Math.min(100, textStartX + deltaX));
  const newY = Math.max(0, Math.min(100, textStartY + deltaY));
  
  if (Math.abs(newX - textStartX) > 0.01 || Math.abs(newY - textStartY) > 0.01) {
    try {
      await fetch(`${API_BASE}/${projectId}/effects/${activeTextEffectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameters: { x: newX, y: newY },
        }),
      });
      await loadProject(projectId);
    } catch (error) {
      console.error('Failed to update text position:', error);
    }
  }
  
  activeTextEl = null;
  activeTextClipId = null;
  activeTextEffectId = null;
}

function handleTextResize(e) {
  if (!isResizingText || !activeTextEl) return;
  
  const deltaY = e.clientY - textDragStartY;
  const scaleFactor = 1 + deltaY / 100;
  const newFontSize = Math.max(8, Math.min(200, textStartFontSize * scaleFactor));
  
  activeTextEl.style.fontSize = newFontSize + 'px';
}

async function handleTextResizeEnd() {
  if (!isResizingText) return;
  
  isResizingText = false;
  document.removeEventListener('mousemove', handleTextResize);
  document.removeEventListener('mouseup', handleTextResizeEnd);
  
  if (!activeTextEl || !activeTextEffectId) return;
  
  const deltaY = (event.clientY - textDragStartY) / 100;
  const newFontSize = Math.max(8, Math.min(200, textStartFontSize * (1 + deltaY)));
  
  if (Math.abs(newFontSize - textStartFontSize) > 0.1) {
    try {
      await fetch(`${API_BASE}/${projectId}/effects/${activeTextEffectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parameters: { fontSize: newFontSize },
        }),
      });
      await loadProject(projectId);
    } catch (error) {
      console.error('Failed to update text size:', error);
    }
  }
  
  activeTextEl = null;
  activeTextClipId = null;
  activeTextEffectId = null;
}

function editTextEffect(clipId, effectId, textEl) {
  const compositionLayer = document.getElementById('compositionLayer');
  compositionLayer.querySelectorAll('.composition-text.selected').forEach(el => el.classList.remove('selected'));
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
  
  const baseVideo = getBaseVideo();
  if (baseVideo && !isNaN(baseVideo.duration)) {
    try {
      baseVideo.currentTime = currentTime;
    } catch (e) {
    }
  }
  
  updateMediaVisibility();
  updateTextOverlay();
}

function togglePlay() {
  const baseVideo = getBaseVideo();
  
  if (baseVideo && baseVideo.src) {
    if (isPlaying) {
      baseVideo.pause();
    } else {
      baseVideo.play().catch(e => console.error('Play failed:', e));
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
let isDraggingText = false;
let isResizingText = false;
let activeTextEl = null;
let textDragStartX = 0;
let textDragStartY = 0;
let textStartX = 0;
let textStartY = 0;
let textStartFontSize = 0;
let activeTextEffectId = null;
let activeTextClipId = null;

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
    const fileName = media.originalName || media.name || media.fileName || media.title || '';
    const ext = fileName.split('.').pop().toLowerCase();
    const audioExtensions = ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma', 'amr'];
    const videoExtensions = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    
    if (audioExtensions.includes(ext)) mediaType = 'audio';
    else if (videoExtensions.includes(ext)) mediaType = 'video';
    else if (imageExtensions.includes(ext)) mediaType = 'image';
    else mediaType = 'video';
  }
  item.dataset.mediaType = mediaType;
  media.type = mediaType;
  
  mediaItems.push(media);
  
  const name = escapeHtml(media.originalName || media.name || media.title || '未命名');
  
  item.innerHTML = `
    ${media.thumbnailUrl ? `<img src="${media.thumbnailUrl}" alt="">` : 
      mediaType === 'audio' ? '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;">🎵</div>' :
      mediaType === 'image' ? '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:24px;">🖼️</div>' :
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
      const items = Array.isArray(data.data) ? data.data : data.data.items || [];
      items.forEach(addMediaItem);
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
