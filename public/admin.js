(function () {
    'use strict';

    const API_BASE = '/api/v1';
    const CHUNK_SIZE = 5 * 1024 * 1024;

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    const STATE = {
        currentTab: 'dashboard',
        videos: { page: 1, pageSize: 10, total: 0, items: [], filters: { search: '', categoryId: '', status: '' } },
        liveRooms: { page: 1, pageSize: 10, total: 0, items: [], filters: { search: '', categoryId: '', status: '' } },
        categories: [],
        templates: [],
        tags: [],
        gifts: [],
    };

    const api = {
        async fetch(url, options = {}) {
            const opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options);
            if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
                opts.body = JSON.stringify(opts.body);
            } else if (opts.body instanceof FormData) {
                delete opts.headers['Content-Type'];
            }
            try {
                const res = await fetch(API_BASE + url, opts);
                const text = await res.text();
                let data;
                try { data = text ? JSON.parse(text) : {}; } catch { data = { success: false, error: text }; }
                if (!res.ok || data.success === false) {
                    throw new Error(data.error || ('HTTP ' + res.status));
                }
                return data;
            } catch (err) {
                toast.error(err.message || '请求失败');
                throw err;
            }
        },
        get(url) { return this.fetch(url); },
        post(url, body) { return this.fetch(url, { method: 'POST', body }); },
        put(url, body) { return this.fetch(url, { method: 'PUT', body }); },
        delete(url) { return this.fetch(url, { method: 'DELETE' }); },
        upload(url, formData, onProgress) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', API_BASE + url);
                xhr.upload.onprogress = (e) => {
                    if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total);
                };
                xhr.onload = () => {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (xhr.status >= 200 && xhr.status < 300 && data.success !== false) {
                            resolve(data);
                        } else {
                            reject(new Error(data.error || ('HTTP ' + xhr.status)));
                        }
                    } catch {
                        reject(new Error('解析响应失败'));
                    }
                };
                xhr.onerror = () => reject(new Error('网络错误'));
                xhr.onabort = () => reject(new Error('上传已取消'));
                xhr.send(formData);
            });
        },
    };

    const toast = {
        show(msg, type = 'info', duration = 3000) {
            const el = document.createElement('div');
            el.className = 'toast-item ' + type;
            el.textContent = msg;
            $('#toast').appendChild(el);
            setTimeout(() => {
                el.style.transition = 'opacity .3s';
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 300);
            }, duration);
        },
        success(msg) { this.show(msg, 'success'); },
        error(msg) { this.show(msg, 'error', 4500); },
        info(msg) { this.show(msg, 'info'); },
        warning(msg) { this.show(msg, 'warning'); },
    };

    const modal = {
        open({ title, body, footer, size = '' }) {
            const dialog = $('#modal .modal-dialog');
            dialog.classList.remove('modal-lg', 'modal-sm');
            if (size) dialog.classList.add('modal-' + size);
            $('#modalTitle').textContent = title || '';
            $('#modalBody').innerHTML = '';
            if (typeof body === 'string') $('#modalBody').innerHTML = body;
            else if (body instanceof HTMLElement) $('#modalBody').appendChild(body);
            $('#modalFooter').innerHTML = '';
            if (typeof footer === 'string') $('#modalFooter').innerHTML = footer;
            else if (footer instanceof HTMLElement) $('#modalFooter').appendChild(footer);
            $('#modal').classList.add('active');
        },
        close() { $('#modal').classList.remove('active'); },
        confirm({ title, message, okText = '确认', cancelText = '取消', danger = false }) {
            return new Promise((resolve) => {
                const footer = document.createElement('div');
                footer.innerHTML = `
                    <button class="btn btn-ghost" data-action="cancel">${cancelText}</button>
                    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="ok">${okText}</button>
                `;
                this.open({
                    title,
                    body: `<div style="font-size:14px;color:var(--text-muted);line-height:1.6;">${message}</div>`,
                    footer,
                    size: 'sm',
                });
                footer.querySelector('[data-action="cancel"]').onclick = () => { this.close(); resolve(false); };
                footer.querySelector('[data-action="ok"]').onclick = () => { this.close(); resolve(true); };
            });
        },
    };

    function fmtSize(bytes) {
        if (bytes == null) return '-';
        const b = Number(bytes);
        if (!b) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }

    function fmtDuration(seconds) {
        if (!seconds) return '-';
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        return `${m}:${String(sec).padStart(2, '0')}`;
    }

    function fmtDate(iso) {
        if (!iso) return '-';
        try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso; }
    }

    function statusBadge(status) {
        const map = {
            UPLOADING: ['上传中', 'badge-info'],
            UPLOADED: ['已上传', 'badge-info'],
            TRANSCODING: ['转码中', 'badge-warning'],
            TRANSCODED: ['已转码', 'badge-success'],
            PUBLISHED: ['已发布', 'badge-success'],
            FAILED: ['失败', 'badge-danger'],
            ARCHIVED: ['已归档', 'badge-muted'],
            PENDING: ['等待中', 'badge-muted'],
            PROCESSING: ['处理中', 'badge-warning'],
            COMPLETED: ['完成', 'badge-success'],
            RETRYING: ['重试中', 'badge-warning'],
        };
        const [label, cls] = map[status] || [status || '-', 'badge-muted'];
        return `<span class="badge ${cls}">${label}</span>`;
    }

    function switchTab(tab) {
        STATE.currentTab = tab;
        $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
        $$('.tab-pane').forEach(el => el.classList.toggle('active', el.id === 'tab-' + tab));
        const titles = {
            dashboard: '概览', videos: '视频管理', upload: '上传视频',
            templates: '转码模板', categories: '分类管理', tags: '标签管理', storage: '存储管理',
            'live-rooms': '直播间管理', 'live-gifts': '礼物管理',
        };
        $('#breadcrumb').textContent = titles[tab] || '';
        if (tab === 'dashboard') loadDashboard();
        if (tab === 'videos') loadVideos();
        if (tab === 'templates') loadTemplates();
        if (tab === 'categories') loadCategories();
        if (tab === 'tags') loadTags();
        if (tab === 'storage') loadStorage();
        if (tab === 'live-rooms') loadLiveRooms();
        if (tab === 'live-gifts') loadGifts();
    }

    async function loadDashboard() {
        const grid = $('#statsGrid');
        try {
            const [videosRes, storageRes] = await Promise.all([
                api.get('/videos?page=1&pageSize=1'),
                api.get('/storage/stats').catch(() => null),
            ]);

            const total = videosRes.data?.total || 0;
            const published = (videosRes.data?.items || []).filter(v => v.status === 'PUBLISHED').length;
            const transcoding = (videosRes.data?.items || []).filter(v => v.status === 'TRANSCODING').length;
            const totalSize = storageRes?.data?.total?.sizeFormatted || '0 B';

            grid.innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">视频总数</div>
                    <div class="stat-value">${total}</div>
                    <div class="stat-meta">全部视频</div>
                </div>
                <div class="stat-card success">
                    <div class="stat-label">已发布</div>
                    <div class="stat-value">${published}</div>
                    <div class="stat-meta">已发布的视频</div>
                </div>
                <div class="stat-card warning">
                    <div class="stat-label">转码中</div>
                    <div class="stat-value">${transcoding}</div>
                    <div class="stat-meta">正在处理</div>
                </div>
                <div class="stat-card info">
                    <div class="stat-label">存储占用</div>
                    <div class="stat-value" style="font-size:22px;">${totalSize}</div>
                    <div class="stat-meta">视频 + 缩略图</div>
                </div>
            `;
        } catch (e) {
            grid.innerHTML = `<div class="stat-card"><div class="stat-label">错误</div><div class="stat-value" style="font-size:14px;">${e.message}</div></div>`;
        }

        try {
            const res = await api.get('/videos?page=1&pageSize=5');
            const rows = (res.data?.items || []).map(v => `
                <tr>
                    <td><strong>${escapeHtml(v.title)}</strong></td>
                    <td>${statusBadge(v.status)}</td>
                    <td>${fmtDuration(v.duration)}</td>
                    <td>${escapeHtml(v.category?.name || '-')}</td>
                    <td>${fmtDate(v.createdAt)}</td>
                    <td>
                        <button class="action-btn primary" data-action="view" data-id="${v.id}">查看</button>
                        <button class="action-btn" data-action="play" data-id="${v.id}">播放</button>
                    </td>
                </tr>
            `).join('');
            $('#recentVideosTable tbody').innerHTML = rows || '<tr><td colspan="6" class="empty">暂无数据</td></tr>';
        } catch {
            $('#recentVideosTable tbody').innerHTML = '<tr><td colspan="6" class="empty">加载失败</td></tr>';
        }
    }

    async function loadVideos() {
        const { page, pageSize, filters } = STATE.videos;
        const params = new URLSearchParams({ page, pageSize });
        if (filters.search) params.set('search', filters.search);
        if (filters.categoryId) params.set('categoryId', filters.categoryId);
        if (filters.status) params.set('status', filters.status);

        try {
            const res = await api.get('/videos?' + params.toString());
            const data = res.data || {};
            STATE.videos.items = data.items || [];
            STATE.videos.total = data.total || 0;
            renderVideosTable();
            renderPagination();
        } catch (e) {
            $('#videosTable tbody').innerHTML = `<tr><td colspan="11" class="empty">加载失败: ${escapeHtml(e.message)}</td></tr>`;
        }
    }

    function renderVideosTable() {
        const rows = STATE.videos.items.map(v => {
            const thumb = v.thumbnailUrl
                ? `<img class="thumbnail" src="/api/v1/storage/url/thumbnail/${encodeURIComponent(v.thumbnailUrl)}" alt="">`
                : `<div class="thumbnail-placeholder">🎬</div>`;
            const tagChips = (v.tags || []).slice(0, 3).map(t => `<span class="tag-chip">${escapeHtml(t.tag.name)}</span>`).join('');
            const uploadProgress = v.status === 'UPLOADING'
                ? `<span class="progress-mini"><span class="progress-mini-fill" style="width:${v.uploadProgress || 0}%"></span></span>${v.uploadProgress || 0}%`
                : '-';
            return `
                <tr data-id="${v.id}">
                    <td>${thumb}</td>
                    <td><strong>${escapeHtml(v.title)}</strong><br><span style="color:var(--text-dim);font-size:11px;">${escapeHtml(v.fileName || '')}</span></td>
                    <td>${statusBadge(v.status)}</td>
                    <td>${fmtDuration(v.duration)}</td>
                    <td>${fmtSize(v.fileSize)}</td>
                    <td>${escapeHtml(v.category?.name || '-')}</td>
                    <td>${tagChips || '-'}</td>
                    <td>${v.views || 0}</td>
                    <td>${uploadProgress}</td>
                    <td style="white-space:nowrap;">${fmtDate(v.createdAt)}</td>
                    <td>
                        <div class="action-group">
                            <button class="action-btn primary" data-action="view">查看</button>
                            <button class="action-btn" data-action="play">播放</button>
                            <button class="action-btn" data-action="edit">编辑</button>
                            <button class="action-btn" data-action="transcode">转码</button>
                            <button class="action-btn" data-action="thumb">截图</button>
                            ${v.status === 'TRANSCODED' ? '<button class="action-btn primary" data-action="publish">发布</button>' : ''}
                            <button class="action-btn danger" data-action="delete">删除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        $('#videosTable tbody').innerHTML = rows || '<tr><td colspan="11" class="empty">暂无视频</td></tr>';
    }

    function renderPagination() {
        const { page, pageSize, total } = STATE.videos;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const from = (page - 1) * pageSize + 1;
        const to = Math.min(page * pageSize, total);
        let pages = '';
        const maxShow = 5;
        let start = Math.max(1, page - 2);
        let end = Math.min(totalPages, start + maxShow - 1);
        start = Math.max(1, end - maxShow + 1);
        for (let i = start; i <= end; i++) {
            pages += `<button class="page-btn ${i === page ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        $('#videosPagination').innerHTML = `
            <div class="page-info">共 ${total} 条 · 显示 ${from}-${to} / ${totalPages} 页</div>
            <div class="page-controls">
                <button class="page-btn" data-page="1" ${page === 1 ? 'disabled' : ''}>«</button>
                <button class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>
                ${pages}
                <button class="page-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>›</button>
                <button class="page-btn" data-page="${totalPages}" ${page === totalPages ? 'disabled' : ''}>»</button>
            </div>
        `;
    }

    async function loadCategoriesForSelect() {
        try {
            const res = await api.get('/categories');
            STATE.categories = res.data || [];
            const opts = STATE.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
            $('#videoCategoryFilter').innerHTML = '<option value="">全部分类</option>' + opts;
            $('#uploadCategory').innerHTML = '<option value="">未分类</option>' + opts;
            const liveCatFilter = $('#liveRoomCategoryFilter');
            if (liveCatFilter) liveCatFilter.innerHTML = '<option value="">全部分类</option>' + opts;
        } catch {}
    }

    async function viewVideo(id) {
        try {
            const res = await api.get('/videos/' + id);
            const v = res.data || {};
            const tags = (v.tags || []).map(t => t.tag.name).join(', ');
            const tasksHtml = (v.transcodeTasks || []).slice(0, 5).map(t => `
                <tr>
                    <td>${escapeHtml(t.templateName || '-')}</td>
                    <td>${statusBadge(t.status)}</td>
                    <td>${t.progress || 0}%</td>
                    <td>${fmtSize(t.outputSize)}</td>
                    <td>${fmtDate(t.completedAt || t.startedAt)}</td>
                </tr>
            `).join('');
            const thumbs = (v.thumbnails || []).slice(0, 4).map(t => `
                <div style="display:inline-block;margin:4px;">
                    <img src="/api/v1/storage/url/thumbnail/${encodeURIComponent(t.url || t.filePath)}" style="width:140px;height:84px;object-fit:cover;border-radius:6px;">
                    <div style="text-align:center;font-size:11px;color:var(--text-dim);">${t.timePoint}s</div>
                </div>
            `).join('');
            const html = `
                <div class="detail-grid">
                    <div class="label">标题</div><div class="value">${escapeHtml(v.title)}</div>
                    <div class="label">状态</div><div class="value">${statusBadge(v.status)}</div>
                    <div class="label">文件名</div><div class="value">${escapeHtml(v.fileName || '-')}</div>
                    <div class="label">时长</div><div class="value">${fmtDuration(v.duration)}</div>
                    <div class="label">分辨率</div><div class="value">${v.width && v.height ? v.width + '×' + v.height : '-'}</div>
                    <div class="label">码率</div><div class="value">${v.bitrate ? (v.bitrate / 1_000_000).toFixed(2) + ' Mbps' : '-'}</div>
                    <div class="label">格式</div><div class="value">${escapeHtml(v.format || '-')}</div>
                    <div class="label">文件大小</div><div class="value">${fmtSize(v.fileSize)}</div>
                    <div class="label">分类</div><div class="value">${escapeHtml(v.category?.name || '-')}</div>
                    <div class="label">标签</div><div class="value">${escapeHtml(tags || '-')}</div>
                    <div class="label">观看</div><div class="value">${v.views || 0}</div>
                    <div class="label">公开</div><div class="value">${v.isPublic ? '是' : '否'}</div>
                    <div class="label">创建时间</div><div class="value">${fmtDate(v.createdAt)}</div>
                    ${v.description ? `<div class="label">描述</div><div class="value">${escapeHtml(v.description)}</div>` : ''}
                </div>
                ${thumbs ? `<div style="margin-top:16px;"><strong style="font-size:13px;">缩略图</strong><div>${thumbs}</div></div>` : ''}
                ${tasksHtml ? `<div style="margin-top:16px;"><strong style="font-size:13px;">转码任务</strong>
                    <table class="table" style="margin-top:8px;">
                        <thead><tr><th>模板</th><th>状态</th><th>进度</th><th>大小</th><th>完成时间</th></tr></thead>
                        <tbody>${tasksHtml}</tbody>
                    </table></div>` : ''}
            `;
            modal.open({ title: '视频详情', body: html, size: 'lg', footer: '<button class="btn btn-ghost" data-close="modal">关闭</button>' });
        } catch {}
    }

    async function editVideo(id) {
        try {
            const res = await api.get('/videos/' + id);
            const v = res.data || {};
            const tags = (v.tags || []).map(t => t.tag.name).join(', ');
            const catOpts = STATE.categories.map(c => `<option value="${c.id}" ${c.id === v.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
            const body = document.createElement('div');
            body.innerHTML = `
                <form class="form" id="editForm">
                    <div class="form-row"><label class="form-label">标题</label><input class="input" name="title" value="${escapeAttr(v.title)}"></div>
                    <div class="form-row"><label class="form-label">描述</label><textarea class="input" name="description" rows="3">${escapeHtml(v.description || '')}</textarea></div>
                    <div class="form-row"><label class="form-label">分类</label>
                        <select class="input" name="categoryId"><option value="">未分类</option>${catOpts}</select>
                    </div>
                    <div class="form-row"><label class="form-label">标签（逗号分隔）</label><input class="input" name="tags" value="${escapeAttr(tags)}"></div>
                    <div class="form-row"><label class="checkbox"><input type="checkbox" name="isPublic" ${v.isPublic ? 'checked' : ''}> 公开</label></div>
                    <div class="form-row"><label class="form-label">过期时间</label><input type="datetime-local" class="input" name="expiresAt" value="${v.expiresAt ? v.expiresAt.slice(0, 16) : ''}"></div>
                </form>
            `;
            const footer = document.createElement('div');
            footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveEditBtn">保存</button>';
            modal.open({ title: '编辑视频', body, footer });
            footer.querySelector('#saveEditBtn').onclick = async () => {
                const form = body.querySelector('#editForm');
                const payload = {
                    title: form.title.value.trim(),
                    description: form.description.value,
                    categoryId: form.categoryId.value || null,
                    isPublic: form.isPublic.checked,
                    expiresAt: form.expiresAt.value || null,
                    tags: form.tags.value.split(',').map(s => s.trim()).filter(Boolean),
                };
                try {
                    await api.put('/videos/' + id, payload);
                    toast.success('保存成功');
                    modal.close();
                    loadVideos();
                } catch (e) { toast.error(e.message); }
            };
        } catch {}
    }

    async function transcodeVideo(id) {
        try {
            const res = await api.get('/transcode-templates');
            const tpls = res.data || [];
            const body = document.createElement('div');
            body.innerHTML = `
                <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted);">选择要应用的转码模板，可多选：</div>
                <div id="tplList" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
                    ${tpls.map(t => `
                        <label class="checkbox" style="padding:10px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);">
                            <input type="checkbox" value="${t.id}" ${t.isPreset ? 'checked' : ''}>
                            <div style="flex:1;">
                                <div style="font-weight:500;">${escapeHtml(t.name)} ${t.isPreset ? '<span class="badge badge-info">预设</span>' : ''}</div>
                                <div style="font-size:12px;color:var(--text-dim);">${t.width || '?'}×${t.height || '?'} · ${(t.videoBitrate || 0) / 1000}kbps · ${t.outputFormat} ${t.isHls ? '· HLS' : ''} ${t.isDash ? '· DASH' : ''}</div>
                            </div>
                        </label>
                    `).join('')}
                </div>
                <label class="checkbox" style="margin-top:14px;"><input type="checkbox" id="isABR"> ABR 自适应码率 (HLS)</label>
            `;
            const footer = document.createElement('div');
            footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="startTranscodeBtn">开始转码</button>';
            modal.open({ title: '启动转码', body, footer });
            footer.querySelector('#startTranscodeBtn').onclick = async () => {
                const ids = $$('#tplList input:checked', body).map(i => i.value);
                const isABR = body.querySelector('#isABR').checked;
                try {
                    if (isABR) {
                        await api.post('/videos/' + id + '/transcode', { isABR: true });
                    } else if (ids.length === 1) {
                        await api.post('/videos/' + id + '/transcode', { templateId: ids[0] });
                    } else if (ids.length > 1) {
                        await api.post('/videos/' + id + '/transcode', { templateIds: ids });
                    } else {
                        toast.warning('请至少选择一个模板');
                        return;
                    }
                    toast.success('转码任务已启动');
                    modal.close();
                    loadVideos();
                } catch (e) { toast.error(e.message); }
            };
        } catch {}
    }

    async function thumbnailVideo(id) {
        const body = document.createElement('div');
        body.innerHTML = `
            <form class="form" id="thumbForm">
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">时间点（秒）</label><input class="input" name="timePoint" type="number" step="0.1"></div>
                    <div class="form-row"><label class="form-label">数量</label><input class="input" name="count" type="number" value="1" min="1"></div>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">间隔（秒）</label><input class="input" name="interval" type="number" step="0.1"></div>
                    <div class="form-row"><label class="form-label">格式</label>
                        <select class="input" name="format"><option value="jpg">JPG</option><option value="png">PNG</option><option value="webp">WEBP</option></select>
                    </div>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">宽度</label><input class="input" name="width" type="number" placeholder="可选"></div>
                    <div class="form-row"><label class="form-label">高度</label><input class="input" name="height" type="number" placeholder="可选"></div>
                </div>
                <label class="checkbox"><input type="checkbox" name="sprite"> 生成雪碧图</label>
            </form>
        `;
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="genThumbBtn">生成</button>';
        modal.open({ title: '生成缩略图', body, footer });
        footer.querySelector('#genThumbBtn').onclick = async () => {
            const form = body.querySelector('#thumbForm');
            const payload = {};
            ['timePoint', 'count', 'interval', 'width', 'height', 'format'].forEach(k => {
                const v = form[k].value;
                if (v !== '' && v != null) payload[k] = isNaN(Number(v)) ? v : Number(v);
            });
            payload.sprite = form.sprite.checked;
            if (!payload.timePoint && !payload.count && !payload.interval) {
                toast.warning('请指定时间点、数量或间隔');
                return;
            }
            try {
                await api.post('/videos/' + id + '/thumbnails', payload);
                toast.success('缩略图任务已启动');
                modal.close();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function publishVideo(id) {
        const ok = await modal.confirm({ title: '发布视频', message: '确定要发布该视频吗？发布后将对用户可见。', okText: '发布' });
        if (!ok) return;
        try {
            await api.post('/videos/' + id + '/publish');
            toast.success('发布成功');
            loadVideos();
        } catch {}
    }

    async function deleteVideo(id) {
        const ok = await modal.confirm({ title: '删除视频', message: '此操作不可恢复，确定要删除该视频及其所有关联数据吗？', okText: '删除', danger: true });
        if (!ok) return;
        try {
            await api.delete('/videos/' + id);
            toast.success('已删除');
            loadVideos();
        } catch {}
    }

    function playVideo(id) {
        window.open('/player/' + id, '_blank');
    }

    function initUploadTab() {
        const fileInput = $('#fileInput');
        const dropzone = $('#dropzone');
        let currentFile = null;
        let cancelled = false;

        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) handleFile(e.target.files[0]);
        });

        function handleFile(file) {
            currentFile = file;
            $('#fileInfo').style.display = 'flex';
            $('#fileInfo').innerHTML = `
                <span class="file-info-icon">🎬</span>
                <span class="file-info-name">${escapeHtml(file.name)}</span>
                <span class="file-info-size">${fmtSize(file.size)}</span>
                <button class="file-info-remove" id="removeFileBtn" title="移除">✕</button>
            `;
            $('#removeFileBtn').onclick = () => {
                currentFile = null;
                fileInput.value = '';
                $('#fileInfo').style.display = 'none';
                $('#startUploadBtn').disabled = true;
            };
            const form = $('#uploadForm');
            if (!form.title.value) form.title.value = file.name.replace(/\.[^/.]+$/, '');
            $('#startUploadBtn').disabled = false;
        }

        $('#uploadForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentFile) return;
            const form = e.target;
            const title = form.title.value.trim();
            if (!title) { toast.warning('请填写标题'); return; }
            const categoryId = form.categoryId.value || null;
            const description = form.description.value || null;
            const tags = form.tags.value.split(',').map(s => s.trim()).filter(Boolean);

            $('#uploadProgress').style.display = 'block';
            $('#uploadAlert').style.display = 'none';
            $('#startUploadBtn').disabled = true;
            $('#cancelUploadBtn').style.display = 'inline-flex';
            cancelled = false;

            try {
                const init = await api.post('/upload/initiate', {
                    fileName: currentFile.name, fileSize: currentFile.size,
                    title, description, categoryId, tags,
                });
                const uploadId = init.data.uploadId;
                const videoId = init.data.videoId;
                const chunkSize = init.data.chunkSize || CHUNK_SIZE;
                const totalChunks = Math.ceil(currentFile.size / chunkSize);

                updateProgress('初始化上传...', 2);

                for (let i = 0; i < totalChunks; i++) {
                    if (cancelled) {
                        await api.delete('/upload/cancel/' + uploadId).catch(() => {});
                        throw new Error('上传已取消');
                    }
                    const start = i * chunkSize;
                    const end = Math.min(start + chunkSize, currentFile.size);
                    const chunk = currentFile.slice(start, end);
                    const fd = new FormData();
                    fd.append('chunk', chunk, i.toString());
                    fd.append('chunkIndex', i);
                    fd.append('totalChunks', totalChunks);

                    updateProgress(`上传分片 ${i + 1} / ${totalChunks}`, Math.round(((i + 1) / totalChunks) * 95));
                    await api.upload('/upload/chunk/' + uploadId, fd);
                }

                updateProgress('合并分片...', 98);
                const complete = await api.post('/upload/complete/' + uploadId);
                updateProgress('上传完成', 100);

                $('#uploadAlert').className = 'alert alert-success';
                $('#uploadAlert').style.display = 'block';
                $('#uploadAlert').innerHTML = `上传完成！视频 ID: <strong>${videoId}</strong> · <a class="link" onclick="window.open('/player/${videoId}','_blank')">播放</a> · <a class="link" data-switch-tab="videos">查看管理列表</a>`;

                currentFile = null;
                fileInput.value = '';
                form.reset();
                $('#fileInfo').style.display = 'none';
                $('#uploadProgress').style.display = 'none';
                $('#progressFill').style.width = '0%';
                $('#startUploadBtn').disabled = true;

                toast.success('上传完成');
            } catch (e) {
                $('#uploadAlert').className = 'alert alert-danger';
                $('#uploadAlert').style.display = 'block';
                $('#uploadAlert').textContent = '上传失败: ' + e.message;
                toast.error(e.message);
            } finally {
                $('#startUploadBtn').disabled = false;
                $('#cancelUploadBtn').style.display = 'none';
            }
        });

        $('#cancelUploadBtn').addEventListener('click', () => { cancelled = true; });

        function updateProgress(stage, percent) {
            $('#uploadStage').textContent = stage;
            $('#uploadPercent').textContent = percent + '%';
            $('#progressFill').style.width = percent + '%';
        }
    }

    async function loadTemplates() {
        const includePresets = $('#includePresets').checked;
        try {
            const res = await api.get('/transcode-templates?includePresets=' + includePresets);
            STATE.templates = res.data || [];
            renderTemplatesTable();
        } catch {}
    }

    function renderTemplatesTable() {
        const rows = STATE.templates.map(t => `
            <tr>
                <td><strong>${escapeHtml(t.name)}</strong>${t.isPreset ? ' <span class="badge badge-info">预设</span>' : ''}<br><span style="color:var(--text-dim);font-size:11px;">${escapeHtml(t.description || '')}</span></td>
                <td>${t.width || '?'}×${t.height || '?'}</td>
                <td>${t.videoBitrate ? (t.videoBitrate / 1000) + ' kbps' : '-'}</td>
                <td><span class="badge">${t.videoCodec}</span> / <span class="badge badge-muted">${t.audioCodec}</span></td>
                <td><span class="badge">${t.outputFormat}</span></td>
                <td>${t.isHls ? '<span class="badge badge-success">HLS</span>' : ''} ${t.isDash ? '<span class="badge badge-success">DASH</span>' : '-'}</td>
                <td>${t.isPreset ? '是' : '否'}</td>
                <td>
                    <div class="action-group">
                        <button class="action-btn primary" data-action="view" data-id="${t.id}">查看</button>
                        ${!t.isPreset ? `
                            <button class="action-btn" data-action="edit" data-id="${t.id}">编辑</button>
                            <button class="action-btn danger" data-action="delete" data-id="${t.id}">删除</button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `).join('');
        $('#templatesTable tbody').innerHTML = rows || '<tr><td colspan="8" class="empty">暂无模板</td></tr>';
    }

    function templateForm(initial = {}) {
        const el = document.createElement('div');
        el.innerHTML = `
            <form class="form" id="tplForm">
                <div class="form-row"><label class="form-label">名称 <span class="required">*</span></label><input class="input" name="name" required value="${escapeAttr(initial.name || '')}"></div>
                <div class="form-row"><label class="form-label">描述</label><textarea class="input" name="description" rows="2">${escapeHtml(initial.description || '')}</textarea></div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">宽度</label><input class="input" name="width" type="number" value="${initial.width || ''}"></div>
                    <div class="form-row"><label class="form-label">高度</label><input class="input" name="height" type="number" value="${initial.height || ''}"></div>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">视频码率 (kbps)</label><input class="input" name="videoBitrate" type="number" value="${initial.videoBitrate || ''}"></div>
                    <div class="form-row"><label class="form-label">音频码率 (kbps)</label><input class="input" name="audioBitrate" type="number" value="${initial.audioBitrate || ''}"></div>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">视频编码</label>
                        <select class="input" name="videoCodec"><option>H264</option><option>H265</option><option>AV1</option></select>
                    </div>
                    <div class="form-row"><label class="form-label">音频编码</label>
                        <select class="input" name="audioCodec"><option>AAC</option><option>MP3</option><option>OPUS</option></select>
                    </div>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">帧率</label><input class="input" name="framerate" type="number" value="${initial.framerate || ''}"></div>
                    <div class="form-row"><label class="form-label">CRF (0-51)</label><input class="input" name="crf" type="number" min="0" max="51" value="${initial.crf ?? ''}"></div>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">预设 (preset)</label><input class="input" name="preset" value="${escapeAttr(initial.preset || '')}"></div>
                    <div class="form-row"><label class="form-label">输出格式</label><input class="input" name="outputFormat" value="${escapeAttr(initial.outputFormat || 'mp4')}"></div>
                </div>
                <div style="display:flex;gap:20px;">
                    <label class="checkbox"><input type="checkbox" name="isHls" ${initial.isHls ? 'checked' : ''}> 生成 HLS</label>
                    <label class="checkbox"><input type="checkbox" name="isDash" ${initial.isDash ? 'checked' : ''}> 生成 DASH</label>
                </div>
            </form>
        `;
        if (initial.videoCodec) el.querySelector('[name=videoCodec]').value = initial.videoCodec;
        if (initial.audioCodec) el.querySelector('[name=audioCodec]').value = initial.audioCodec;
        return el;
    }

    function readForm(form) {
        const data = {};
        ['name', 'description', 'preset', 'outputFormat'].forEach(k => data[k] = form[k].value || undefined);
        ['width', 'height', 'videoBitrate', 'audioBitrate', 'framerate', 'crf'].forEach(k => {
            const v = form[k].value;
            data[k] = v === '' ? undefined : Number(v);
        });
        data.videoCodec = form.videoCodec.value;
        data.audioCodec = form.audioCodec.value;
        data.isHls = form.isHls.checked;
        data.isDash = form.isDash.checked;
        return data;
    }

    async function newTemplate() {
        const body = templateForm({ videoCodec: 'H264', audioCodec: 'AAC', outputFormat: 'mp4' });
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveBtn">创建</button>';
        modal.open({ title: '新建转码模板', body, footer });
        footer.querySelector('#saveBtn').onclick = async () => {
            const form = body.querySelector('#tplForm');
            if (!form.name.value.trim()) { toast.warning('名称必填'); return; }
            try {
                await api.post('/transcode-templates', readForm(form));
                toast.success('模板已创建');
                modal.close();
                loadTemplates();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function editTemplate(id) {
        try {
            const res = await api.get('/transcode-templates/' + id);
            const t = res.data || {};
            const body = templateForm(t);
            const footer = document.createElement('div');
            footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveBtn">保存</button>';
            modal.open({ title: '编辑模板', body, footer });
            footer.querySelector('#saveBtn').onclick = async () => {
                const form = body.querySelector('#tplForm');
                try {
                    await api.put('/transcode-templates/' + id, readForm(form));
                    toast.success('已保存');
                    modal.close();
                    loadTemplates();
                } catch (e) { toast.error(e.message); }
            };
        } catch {}
    }

    async function deleteTemplate(id) {
        const ok = await modal.confirm({ title: '删除模板', message: '确定要删除此模板吗？', okText: '删除', danger: true });
        if (!ok) return;
        try {
            await api.delete('/transcode-templates/' + id);
            toast.success('已删除');
            loadTemplates();
        } catch {}
    }

    async function loadCategories() {
        try {
            const res = await api.get('/categories');
            STATE.categories = res.data || [];
            renderCategoriesTable();
        } catch {}
    }

    function renderCategoriesTable() {
        const rows = STATE.categories.map(c => `
            <tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${escapeHtml(c.description || '-')}</td>
                <td><span class="badge badge-info">${c._count?.videos || 0}</span></td>
                <td style="white-space:nowrap;">${fmtDate(c.createdAt)}</td>
                <td>
                    <div class="action-group">
                        <button class="action-btn" data-action="edit" data-id="${c.id}">编辑</button>
                        <button class="action-btn danger" data-action="delete" data-id="${c.id}">删除</button>
                    </div>
                </td>
            </tr>
        `).join('');
        $('#categoriesTable tbody').innerHTML = rows || '<tr><td colspan="5" class="empty">暂无分类</td></tr>';
    }

    function categoryForm(initial = {}) {
        const el = document.createElement('div');
        el.innerHTML = `
            <form class="form" id="catForm">
                <div class="form-row"><label class="form-label">名称 <span class="required">*</span></label><input class="input" name="name" required value="${escapeAttr(initial.name || '')}"></div>
                <div class="form-row"><label class="form-label">描述</label><textarea class="input" name="description" rows="3">${escapeHtml(initial.description || '')}</textarea></div>
            </form>
        `;
        return el;
    }

    async function newCategory() {
        const body = categoryForm();
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveBtn">创建</button>';
        modal.open({ title: '新建分类', body, footer });
        footer.querySelector('#saveBtn').onclick = async () => {
            const form = body.querySelector('#catForm');
            if (!form.name.value.trim()) { toast.warning('名称必填'); return; }
            try {
                await api.post('/categories', { name: form.name.value.trim(), description: form.description.value });
                toast.success('已创建');
                modal.close();
                loadCategories();
                loadCategoriesForSelect();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function editCategory(id) {
        const c = STATE.categories.find(x => x.id === id);
        if (!c) return;
        const body = categoryForm(c);
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveBtn">保存</button>';
        modal.open({ title: '编辑分类', body, footer });
        footer.querySelector('#saveBtn').onclick = async () => {
            const form = body.querySelector('#catForm');
            try {
                await api.put('/categories/' + id, { name: form.name.value.trim(), description: form.description.value });
                toast.success('已保存');
                modal.close();
                loadCategories();
                loadCategoriesForSelect();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function deleteCategory(id) {
        const c = STATE.categories.find(x => x.id === id);
        const ok = await modal.confirm({ title: '删除分类', message: `确定删除分类 "${c?.name || ''}" 吗？存在视频的分类无法删除。`, okText: '删除', danger: true });
        if (!ok) return;
        try {
            await api.delete('/categories/' + id);
            toast.success('已删除');
            loadCategories();
            loadCategoriesForSelect();
        } catch {}
    }

    async function loadTags() {
        const search = $('#tagSearch').value;
        try {
            const res = await api.get('/tags?limit=200' + (search ? '&search=' + encodeURIComponent(search) : ''));
            STATE.tags = res.data || [];
            renderTagsList();
        } catch {}
    }

    function renderTagsList() {
        const html = STATE.tags.map(t => `
            <span class="tag-item">
                #${escapeHtml(t.name)}
                <span class="tag-count">${t._count?.videos || 0}</span>
                <span class="tag-del" data-id="${t.id}" title="删除">✕</span>
            </span>
        `).join('');
        $('#tagsList').innerHTML = html || '<div style="padding:20px;color:var(--text-dim);">暂无标签</div>';
    }

    async function newTag() {
        const body = document.createElement('div');
        body.innerHTML = `<form class="form" id="tagForm"><div class="form-row"><label class="form-label">标签名 <span class="required">*</span></label><input class="input" name="name" required></div></form>`;
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveBtn">创建</button>';
        modal.open({ title: '新建标签', body, footer, size: 'sm' });
        footer.querySelector('#saveBtn').onclick = async () => {
            const name = body.querySelector('[name=name]').value.trim();
            if (!name) { toast.warning('名称必填'); return; }
            try {
                await api.post('/tags', { name });
                toast.success('已创建');
                modal.close();
                loadTags();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function deleteTag(id) {
        const ok = await modal.confirm({ title: '删除标签', message: '标签将从所有视频中移除，确定继续？', okText: '删除', danger: true });
        if (!ok) return;
        try {
            await api.delete('/tags/' + id);
            toast.success('已删除');
            loadTags();
        } catch {}
    }

    async function loadStorage() {
        try {
            const res = await api.get('/storage/stats');
            const d = res.data || {};
            $('#storageStats').innerHTML = `
                <div class="stat-card info">
                    <div class="stat-label">视频数量</div>
                    <div class="stat-value">${d.videos?.count || 0}</div>
                    <div class="stat-meta">${d.videos?.sizeFormatted || '0 B'}</div>
                </div>
                <div class="stat-card warning">
                    <div class="stat-label">缩略图数量</div>
                    <div class="stat-value">${d.thumbnails?.count || 0}</div>
                    <div class="stat-meta">${d.thumbnails?.sizeFormatted || '0 B'}</div>
                </div>
                <div class="stat-card success">
                    <div class="stat-label">总计</div>
                    <div class="stat-value" style="font-size:22px;">${d.total?.sizeFormatted || '0 B'}</div>
                    <div class="stat-meta">${d.total?.count || 0} 个对象</div>
                </div>
            `;
        } catch (e) {
            $('#storageStats').innerHTML = `<div class="stat-card"><div class="stat-label">错误</div><div class="stat-value" style="font-size:14px;">${e.message}</div></div>`;
        }
    }

    async function listObjects() {
        const prefix = $('#objectPrefix').value;
        try {
            const res = await api.get('/storage/objects' + (prefix ? '?prefix=' + encodeURIComponent(prefix) : ''));
            const items = res.data || [];
            const rows = items.map(o => `
                <tr>
                    <td>${escapeHtml(o.name)}</td>
                    <td>${o.sizeFormatted || '-'}</td>
                    <td style="white-space:nowrap;">${fmtDate(o.lastModified)}</td>
                    <td style="font-family:monospace;font-size:12px;">${escapeHtml(o.etag || '-')}</td>
                    <td><button class="action-btn danger" data-action="delete" data-name="${escapeAttr(o.name)}">删除</button></td>
                </tr>
            `).join('');
            $('#objectsTable tbody').innerHTML = rows || '<tr><td colspan="5" class="empty">没有对象</td></tr>';
        } catch (e) {
            $('#objectsTable tbody').innerHTML = `<tr><td colspan="5" class="empty">加载失败: ${escapeHtml(e.message)}</td></tr>`;
        }
    }

    async function deleteObject(name) {
        const ok = await modal.confirm({ title: '删除对象', message: `确定删除存储对象 "${escapeHtml(name)}" 吗？`, okText: '删除', danger: true });
        if (!ok) return;
        try {
            await api.delete('/storage/objects/video/' + encodeURIComponent(name));
            toast.success('已删除');
            listObjects();
        } catch {}
    }

    function liveRoomStatusBadge(status) {
        const map = {
            NOT_STARTED: ['未开始', 'badge-muted'],
            LIVING: ['直播中', 'badge-success'],
            ENDED: ['已结束', 'badge-info'],
            BANNED: ['已封禁', 'badge-danger'],
        };
        const [label, cls] = map[status] || [status || '-', 'badge-muted'];
        return `<span class="badge ${cls}">${label}</span>`;
    }

    function liveStreamStatusBadge(status) {
        const map = {
            PUSHING: ['推流中', 'badge-success'],
            INTERRUPTED: ['中断', 'badge-warning'],
            STOPPED: ['已停止', 'badge-muted'],
            FAILED: ['失败', 'badge-danger'],
        };
        const [label, cls] = map[status] || [status || '-', 'badge-muted'];
        return `<span class="badge ${cls}">${label}</span>`;
    }

    async function loadLiveRooms() {
        const { page, pageSize, filters } = STATE.liveRooms;
        const params = new URLSearchParams({ page, pageSize });
        if (filters.search) params.set('search', filters.search);
        if (filters.categoryId) params.set('categoryId', filters.categoryId);
        if (filters.status) params.set('status', filters.status);

        try {
            const res = await api.get('/live-rooms?' + params.toString());
            const data = res.data || {};
            STATE.liveRooms.items = data.items || [];
            STATE.liveRooms.total = data.total || 0;
            renderLiveRoomsTable();
            renderLiveRoomsPagination();
        } catch (e) {
            $('#liveRoomsTable tbody').innerHTML = `<tr><td colspan="10" class="empty">加载失败: ${escapeHtml(e.message)}</td></tr>`;
        }
    }

    function renderLiveRoomsTable() {
        const rows = STATE.liveRooms.items.map(r => `
            <tr data-id="${r.id}">
                <td><strong>${escapeHtml(r.title)}</strong><br><span style="color:var(--text-dim);font-size:11px;">${escapeHtml(r.description || '')}</span></td>
                <td>${liveRoomStatusBadge(r.status)}</td>
                <td>${escapeHtml(r.category?.name || '-')}</td>
                <td>${r.isRecorded ? '<span class="badge badge-success">录制</span>' : '<span class="badge badge-muted">不录制</span>'}</td>
                <td>${r.viewCount || 0}</td>
                <td>${r.peakViewers || 0}</td>
                <td>${r.likeCount || 0}</td>
                <td style="white-space:nowrap;">${fmtDate(r.createdAt)}</td>
                <td>${fmtDuration(r.duration)}</td>
                <td>
                    <div class="action-group">
                        <button class="action-btn primary" data-action="view-room">查看</button>
                        <button class="action-btn" data-action="stream-config">推流</button>
                        <button class="action-btn" data-action="edit-room">编辑</button>
                        ${r.status === 'LIVING' ? '<button class="action-btn" data-action="recordings">录制</button>' : ''}
                        ${r.status === 'BANNED' ? '<button class="action-btn primary" data-action="unban-room">解禁</button>' : '<button class="action-btn danger" data-action="ban-room">封禁</button>'}
                        <button class="action-btn" data-action="reset-key">重置密钥</button>
                        <button class="action-btn" data-action="room-stats">统计</button>
                        <button class="action-btn danger" data-action="delete-room">删除</button>
                    </div>
                </td>
            </tr>
        `).join('');
        $('#liveRoomsTable tbody').innerHTML = rows || '<tr><td colspan="10" class="empty">暂无直播间</td></tr>';
    }

    function renderLiveRoomsPagination() {
        const { page, pageSize, total } = STATE.liveRooms;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const from = (page - 1) * pageSize + 1;
        const to = Math.min(page * pageSize, total);
        let pages = '';
        const maxShow = 5;
        let start = Math.max(1, page - 2);
        let end = Math.min(totalPages, start + maxShow - 1);
        start = Math.max(1, end - maxShow + 1);
        for (let i = start; i <= end; i++) {
            pages += `<button class="page-btn ${i === page ? 'active' : ''}" data-live-page="${i}">${i}</button>`;
        }
        $('#liveRoomsPagination').innerHTML = `
            <div class="page-info">共 ${total} 条 · 显示 ${from}-${to} / ${totalPages} 页</div>
            <div class="page-controls">
                <button class="page-btn" data-live-page="1" ${page === 1 ? 'disabled' : ''}>«</button>
                <button class="page-btn" data-live-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹</button>
                ${pages}
                <button class="page-btn" data-live-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>›</button>
                <button class="page-btn" data-live-page="${totalPages}" ${page === totalPages ? 'disabled' : ''}>»</button>
            </div>
        `;
    }

    async function createLiveRoom() {
        const catOpts = STATE.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
        const body = document.createElement('div');
        body.innerHTML = `
            <form class="form" id="liveRoomForm">
                <div class="form-row"><label class="form-label">标题 <span class="required">*</span></label><input class="input" name="title" required></div>
                <div class="form-row"><label class="form-label">描述</label><textarea class="input" name="description" rows="2"></textarea></div>
                <div class="form-row"><label class="form-label">封面URL</label><input class="input" name="coverUrl"></div>
                <div class="form-row"><label class="form-label">分类</label>
                    <select class="input" name="categoryId"><option value="">未分类</option>${catOpts}</select>
                </div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">最大码率 (kbps)</label><input class="input" name="maxBitrate" type="number" placeholder="可选"></div>
                    <div class="form-row"><label class="form-label">录制格式</label>
                        <select class="input" name="recordFormat">
                            <option value="FLV">FLV</option>
                            <option value="HLS">HLS</option>
                            <option value="MP4">MP4</option>
                        </select>
                    </div>
                </div>
                <div style="display:flex;gap:20px;">
                    <label class="checkbox"><input type="checkbox" name="isPublic" checked> 公开</label>
                    <label class="checkbox"><input type="checkbox" name="isRecorded" checked> 自动录制</label>
                </div>
            </form>
        `;
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveRoomBtn">创建</button>';
        modal.open({ title: '创建直播间', body, footer });
        footer.querySelector('#saveRoomBtn').onclick = async () => {
            const form = body.querySelector('#liveRoomForm');
            const payload = {
                title: form.title.value.trim(),
                description: form.description.value || undefined,
                coverUrl: form.coverUrl.value || undefined,
                categoryId: form.categoryId.value || null,
                isPublic: form.isPublic.checked,
                isRecorded: form.isRecorded.checked,
                recordFormat: form.recordFormat.value,
                maxBitrate: form.maxBitrate.value ? Number(form.maxBitrate.value) : undefined,
            };
            if (!payload.title) { toast.warning('标题必填'); return; }
            try {
                await api.post('/live-rooms', payload);
                toast.success('直播间已创建');
                modal.close();
                loadLiveRooms();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function viewLiveRoom(id) {
        try {
            const res = await api.get('/live-rooms/' + id);
            const r = res.data || {};
            const streams = (r.streams || []).slice(0, 5).map(s => `
                <tr>
                    <td>${s.streamIndex}${s.isPrimary ? ' (主)' : ''}</td>
                    <td>${s.protocol}</td>
                    <td>${liveStreamStatusBadge(s.status)}</td>
                    <td>${s.bitrate ? (s.bitrate / 1000) + ' kbps' : '-'}</td>
                    <td>${s.width && s.height ? s.width + '×' + s.height : '-'}</td>
                    <td>${fmtDate(s.connectedAt)}</td>
                    <td>${fmtDuration(s.duration)}</td>
                </tr>
            `).join('');
            const transcodes = (r.transcodes || []).slice(0, 5).map(t => `
                <tr>
                    <td>${escapeHtml(t.name)}</td>
                    <td>${t.width}×${t.height}</td>
                    <td>${t.videoBitrate / 1000} kbps</td>
                    <td><span class="badge">${t.videoCodec}</span></td>
                    <td>${t.latencyMs}ms</td>
                    <td>${t.isBackup ? '<span class="badge badge-warning">备路</span>' : '<span class="badge badge-info">主路</span>'}</td>
                    <td>${t.status === 'RUNNING' ? '<span class="badge badge-success">运行中</span>' : '<span class="badge badge-muted">已停止</span>'}</td>
                </tr>
            `).join('');
            const html = `
                <div class="detail-grid">
                    <div class="label">标题</div><div class="value">${escapeHtml(r.title)}</div>
                    <div class="label">状态</div><div class="value">${liveRoomStatusBadge(r.status)}</div>
                    <div class="label">推流密钥</div><div class="value"><code style="font-size:12px;background:var(--bg-secondary);padding:2px 6px;border-radius:4px;">${escapeHtml(r.streamKey)}</code></div>
                    <div class="label">分类</div><div class="value">${escapeHtml(r.category?.name || '-')}</div>
                    <div class="label">公开</div><div class="value">${r.isPublic ? '是' : '否'}</div>
                    <div class="label">自动录制</div><div class="value">${r.isRecorded ? '是 (' + r.recordFormat + ')' : '否'}</div>
                    <div class="label">观看人数</div><div class="value">${r.viewCount || 0}</div>
                    <div class="label">峰值观看</div><div class="value">${r.peakViewers || 0}</div>
                    <div class="label">点赞数</div><div class="value">${r.likeCount || 0}</div>
                    <div class="label">时长</div><div class="value">${fmtDuration(r.duration)}</div>
                    <div class="label">创建时间</div><div class="value">${fmtDate(r.createdAt)}</div>
                </div>
                ${streams ? `<div style="margin-top:16px;"><strong style="font-size:13px;">推流记录</strong>
                    <table class="table" style="margin-top:8px;">
                        <thead><tr><th>序号</th><th>协议</th><th>状态</th><th>码率</th><th>分辨率</th><th>连接时间</th><th>时长</th></tr></thead>
                        <tbody>${streams}</tbody>
                    </table></div>` : ''}
                ${transcodes ? `<div style="margin-top:16px;"><strong style="font-size:13px;">转码任务</strong>
                    <table class="table" style="margin-top:8px;">
                        <thead><tr><th>名称</th><th>分辨率</th><th>码率</th><th>编码</th><th>延迟</th><th>类型</th><th>状态</th></tr></thead>
                        <tbody>${transcodes}</tbody>
                    </table></div>` : ''}
                ${r.description ? `<div style="margin-top:16px;"><strong style="font-size:13px;">描述</strong><div style="margin-top:4px;">${escapeHtml(r.description)}</div></div>` : ''}
            `;
            modal.open({ title: '直播间详情', body: html, size: 'lg', footer: '<button class="btn btn-ghost" data-close="modal">关闭</button>' });
        } catch {}
    }

    async function editLiveRoom(id) {
        try {
            const res = await api.get('/live-rooms/' + id);
            const r = res.data || {};
            const catOpts = STATE.categories.map(c => `<option value="${c.id}" ${c.id === r.categoryId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
            const body = document.createElement('div');
            body.innerHTML = `
                <form class="form" id="editLiveRoomForm">
                    <div class="form-row"><label class="form-label">标题</label><input class="input" name="title" value="${escapeAttr(r.title)}"></div>
                    <div class="form-row"><label class="form-label">描述</label><textarea class="input" name="description" rows="2">${escapeHtml(r.description || '')}</textarea></div>
                    <div class="form-row"><label class="form-label">封面URL</label><input class="input" name="coverUrl" value="${escapeAttr(r.coverUrl || '')}"></div>
                    <div class="form-row"><label class="form-label">分类</label>
                        <select class="input" name="categoryId"><option value="">未分类</option>${catOpts}</select>
                    </div>
                    <div class="form-grid">
                        <div class="form-row"><label class="form-label">最大码率 (kbps)</label><input class="input" name="maxBitrate" type="number" value="${r.maxBitrate || ''}"></div>
                        <div class="form-row"><label class="form-label">录制格式</label>
                            <select class="input" name="recordFormat">
                                <option value="FLV" ${r.recordFormat === 'FLV' ? 'selected' : ''}>FLV</option>
                                <option value="HLS" ${r.recordFormat === 'HLS' ? 'selected' : ''}>HLS</option>
                                <option value="MP4" ${r.recordFormat === 'MP4' ? 'selected' : ''}>MP4</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:flex;gap:20px;">
                        <label class="checkbox"><input type="checkbox" name="isPublic" ${r.isPublic ? 'checked' : ''}> 公开</label>
                        <label class="checkbox"><input type="checkbox" name="isRecorded" ${r.isRecorded ? 'checked' : ''}> 自动录制</label>
                    </div>
                </form>
            `;
            const footer = document.createElement('div');
            footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveEditRoomBtn">保存</button>';
            modal.open({ title: '编辑直播间', body, footer });
            footer.querySelector('#saveEditRoomBtn').onclick = async () => {
                const form = body.querySelector('#editLiveRoomForm');
                const payload = {
                    title: form.title.value.trim(),
                    description: form.description.value || undefined,
                    coverUrl: form.coverUrl.value || undefined,
                    categoryId: form.categoryId.value || null,
                    isPublic: form.isPublic.checked,
                    isRecorded: form.isRecorded.checked,
                    recordFormat: form.recordFormat.value,
                    maxBitrate: form.maxBitrate.value ? Number(form.maxBitrate.value) : undefined,
                };
                try {
                    await api.put('/live-rooms/' + id, payload);
                    toast.success('已保存');
                    modal.close();
                    loadLiveRooms();
                } catch (e) { toast.error(e.message); }
            };
        } catch {}
    }

    async function deleteLiveRoom(id) {
        const ok = await modal.confirm({ title: '删除直播间', message: '此操作不可恢复，确定要删除该直播间吗？', okText: '删除', danger: true });
        if (!ok) return;
        try {
            await api.delete('/live-rooms/' + id);
            toast.success('已删除');
            loadLiveRooms();
        } catch (e) { toast.error(e.message); }
    }

    async function banLiveRoom(id) {
        const body = document.createElement('div');
        body.innerHTML = `<form class="form"><div class="form-row"><label class="form-label">封禁原因</label><textarea class="input" name="reason" rows="2"></textarea></div></form>`;
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-danger" id="confirmBanBtn">封禁</button>';
        modal.open({ title: '封禁直播间', body, footer });
        footer.querySelector('#confirmBanBtn').onclick = async () => {
            const reason = body.querySelector('[name=reason]').value;
            try {
                await api.post('/live-rooms/' + id + '/ban', { reason });
                toast.success('已封禁');
                modal.close();
                loadLiveRooms();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function unbanLiveRoom(id) {
        const ok = await modal.confirm({ title: '解禁直播间', message: '确定要解除该直播间的封禁吗？', okText: '解禁' });
        if (!ok) return;
        try {
            await api.post('/live-rooms/' + id + '/unban');
            toast.success('已解禁');
            loadLiveRooms();
        } catch (e) { toast.error(e.message); }
    }

    async function resetStreamKey(id) {
        const ok = await modal.confirm({ title: '重置推流密钥', message: '重置后旧密钥将失效，推流端需要使用新密钥重新推流。确定继续？', okText: '重置', danger: true });
        if (!ok) return;
        try {
            const res = await api.post('/live-rooms/' + id + '/reset-key');
            const body = document.createElement('div');
            body.innerHTML = `<div style="text-align:center;padding:10px;">
                <div style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">新推流密钥</div>
                <div style="font-family:monospace;font-size:14px;background:var(--bg-secondary);padding:10px;border-radius:6px;word-break:break-all;">${escapeHtml(res.data.streamKey)}</div>
            </div>`;
            modal.open({ title: '密钥已重置', body, footer: '<button class="btn btn-primary" data-close="modal">确定</button>', size: 'sm' });
            loadLiveRooms();
        } catch (e) { toast.error(e.message); }
    }

    async function viewStreamConfig(id) {
        try {
            const res = await api.get('/live-rooms/' + id + '/stream-config');
            const d = res.data || {};
            const html = `
                <div style="padding:10px 0;">
                    <div class="form-row" style="margin-bottom:12px;">
                        <label class="form-label">推流密钥</label>
                        <div style="display:flex;gap:8px;">
                            <input class="input" id="streamKeyInput" value="${escapeAttr(d.streamKey)}" readonly>
                            <button class="btn btn-ghost" onclick="navigator.clipboard.writeText(document.getElementById('streamKeyInput').value)">复制</button>
                        </div>
                    </div>
                    <div class="form-row" style="margin-bottom:12px;">
                        <label class="form-label">RTMP 推流地址</label>
                        <div style="display:flex;gap:8px;">
                            <input class="input" value="${escapeAttr(d.pushUrl || 'rtmp://your-server/live/' + d.streamKey)}" readonly>
                            <button class="btn btn-ghost" onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">复制</button>
                        </div>
                    </div>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:16px;padding:10px;background:var(--bg-secondary);border-radius:6px;">
                        <strong>推流说明：</strong><br>
                        1. 使用 OBS 或其他推流软件<br>
                        2. 服务器地址: <code>rtmp://your-server/live</code><br>
                        3. 密钥: 上面的推流密钥<br>
                        4. 推流开始后直播间状态将自动变为"直播中"
                    </div>
                    <div style="margin-top:16px;">
                        <strong style="font-size:13px;">拉流地址</strong>
                        <div style="margin-top:8px;font-size:12px;">
                            ${d.playUrls?.hls ? `<div>HLS: <code>${escapeHtml(d.playUrls.hls)}</code></div>` : ''}
                            ${d.playUrls?.flv ? `<div>FLV: <code>${escapeHtml(d.playUrls.flv)}</code></div>` : ''}
                            ${d.playUrls?.webrtc ? `<div>WebRTC: <code>${escapeHtml(d.playUrls.webrtc)}</code></div>` : ''}
                        </div>
                    </div>
                </div>
            `;
            modal.open({ title: '推流配置', body: html, size: 'lg', footer: '<button class="btn btn-primary" data-close="modal">关闭</button>' });
        } catch (e) { toast.error(e.message); }
    }

    async function viewRoomStats(id) {
        try {
            const res = await api.get('/live-rooms/' + id + '/stats');
            const s = res.data || {};
            const html = `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                    <div class="stat-card info"><div class="stat-label">观看人数</div><div class="stat-value">${s.viewCount || 0}</div></div>
                    <div class="stat-card success"><div class="stat-label">峰值观看</div><div class="stat-value">${s.peakViewers || 0}</div></div>
                    <div class="stat-card warning"><div class="stat-label">点赞数</div><div class="stat-value">${s.likeCount || 0}</div></div>
                    <div class="stat-card"><div class="stat-label">弹幕数</div><div class="stat-value">${s.danmakuCount || 0}</div></div>
                    <div class="stat-card"><div class="stat-label">礼物数</div><div class="stat-value">${s.giftCount || 0}</div></div>
                    <div class="stat-card"><div class="stat-label">直播时长</div><div class="stat-value">${fmtDuration(s.duration)}</div></div>
                </div>
                <div style="margin-top:16px;font-size:12px;color:var(--text-muted);">
                    ${s.startTime ? `<div>开始时间: ${fmtDate(s.startTime)}</div>` : ''}
                    ${s.endTime ? `<div>结束时间: ${fmtDate(s.endTime)}</div>` : ''}
                </div>
            `;
            modal.open({ title: '直播间统计', body: html, size: 'lg', footer: '<button class="btn btn-ghost" data-close="modal">关闭</button>' });
        } catch (e) { toast.error(e.message); }
    }

    async function viewRoomRecordings(id) {
        try {
            const res = await api.get('/live-rooms/' + id + '/recordings');
            const d = res.data || {};
            const rows = (d.history || []).map(r => `
                <tr>
                    <td>${r.format}</td>
                    <td>${r.status === 'COMPLETED' ? '<span class="badge badge-success">完成</span>' : r.status === 'RECORDING' ? '<span class="badge badge-warning">录制中</span>' : r.status === 'STOPPED' ? '<span class="badge badge-muted">已停止</span>' : '<span class="badge badge-danger">失败</span>'}</td>
                    <td>${fmtSize(r.fileSize)}</td>
                    <td>${fmtDuration(r.duration)}</td>
                    <td style="white-space:nowrap;">${fmtDate(r.startedAt)}</td>
                    <td>${r.segmentIndex || 0}</td>
                </tr>
            `).join('');
            const html = `
                <div style="margin-bottom:12px;"><span class="badge badge-info">录制中: ${(d.active || []).length}</span> <span class="badge">总计: ${(d.history || []).length}</span></div>
                <table class="table">
                    <thead><tr><th>格式</th><th>状态</th><th>大小</th><th>时长</th><th>开始时间</th><th>片段</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="6" class="empty">暂无录制</td></tr>'}</tbody>
                </table>
            `;
            modal.open({ title: '录制文件', body: html, size: 'lg', footer: '<button class="btn btn-ghost" data-close="modal">关闭</button>' });
        } catch (e) { toast.error(e.message); }
    }

    async function loadGifts() {
        try {
            const res = await api.get('/live-interact/gifts');
            STATE.gifts = res.data?.gifts || res.data || [];
            renderGiftsTable();
        } catch (e) {
            $('#giftsTable tbody').innerHTML = `<tr><td colspan="6" class="empty">加载失败: ${escapeHtml(e.message)}</td></tr>`;
        }
    }

    function renderGiftsTable() {
        const rows = STATE.gifts.map(g => `
            <tr>
                <td><img src="${escapeHtml(g.iconUrl)}" alt="" style="width:32px;height:32px;border-radius:6px;vertical-align:middle;"> <strong>${escapeHtml(g.name)}</strong></td>
                <td>${g.price}</td>
                <td>${g.value}</td>
                <td>${g.sortOrder || 0}</td>
                <td>${g.status === 'ENABLED' ? '<span class="badge badge-success">启用</span>' : '<span class="badge badge-muted">禁用</span>'}</td>
                <td>
                    <div class="action-group">
                        <button class="action-btn" data-action="edit-gift" data-id="${g.id}">编辑</button>
                        <button class="action-btn" data-action="toggle-gift" data-id="${g.id}">${g.status === 'ENABLED' ? '禁用' : '启用'}</button>
                    </div>
                </td>
            </tr>
        `).join('');
        $('#giftsTable tbody').innerHTML = rows || '<tr><td colspan="6" class="empty">暂无礼物</td></tr>';
    }

    async function createGift() {
        const body = document.createElement('div');
        body.innerHTML = `
            <form class="form" id="giftForm">
                <div class="form-row"><label class="form-label">名称 <span class="required">*</span></label><input class="input" name="name" required></div>
                <div class="form-row"><label class="form-label">图标URL <span class="required">*</span></label><input class="input" name="iconUrl" required></div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">价格 <span class="required">*</span></label><input class="input" name="price" type="number" step="0.01" required></div>
                    <div class="form-row"><label class="form-label">价值 <span class="required">*</span></label><input class="input" name="value" type="number" required></div>
                </div>
                <div class="form-row"><label class="form-label">排序</label><input class="input" name="sortOrder" type="number" value="0"></div>
            </form>
        `;
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveGiftBtn">创建</button>';
        modal.open({ title: '创建礼物', body, footer, size: 'sm' });
        footer.querySelector('#saveGiftBtn').onclick = async () => {
            const form = body.querySelector('#giftForm');
            const payload = {
                name: form.name.value.trim(),
                iconUrl: form.iconUrl.value.trim(),
                price: Number(form.price.value),
                value: Number(form.value.value),
                sortOrder: Number(form.sortOrder.value) || 0,
            };
            try {
                await api.post('/live-interact/gifts', payload);
                toast.success('礼物已创建');
                modal.close();
                loadGifts();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function editGift(id) {
        const g = STATE.gifts.find(x => x.id === id);
        if (!g) return;
        const body = document.createElement('div');
        body.innerHTML = `
            <form class="form" id="editGiftForm">
                <div class="form-row"><label class="form-label">名称</label><input class="input" name="name" value="${escapeAttr(g.name)}"></div>
                <div class="form-row"><label class="form-label">图标URL</label><input class="input" name="iconUrl" value="${escapeAttr(g.iconUrl)}"></div>
                <div class="form-grid">
                    <div class="form-row"><label class="form-label">价格</label><input class="input" name="price" type="number" step="0.01" value="${g.price}"></div>
                    <div class="form-row"><label class="form-label">价值</label><input class="input" name="value" type="number" value="${g.value}"></div>
                </div>
                <div class="form-row"><label class="form-label">排序</label><input class="input" name="sortOrder" type="number" value="${g.sortOrder || 0}"></div>
            </form>
        `;
        const footer = document.createElement('div');
        footer.innerHTML = '<button class="btn btn-ghost" data-close="modal">取消</button><button class="btn btn-primary" id="saveEditGiftBtn">保存</button>';
        modal.open({ title: '编辑礼物', body, footer, size: 'sm' });
        footer.querySelector('#saveEditGiftBtn').onclick = async () => {
            const form = body.querySelector('#editGiftForm');
            const payload = {
                name: form.name.value.trim(),
                iconUrl: form.iconUrl.value.trim(),
                price: Number(form.price.value),
                value: Number(form.value.value),
                sortOrder: Number(form.sortOrder.value) || 0,
            };
            try {
                await api.put('/live-interact/gifts/' + id, payload);
                toast.success('已保存');
                modal.close();
                loadGifts();
            } catch (e) { toast.error(e.message); }
        };
    }

    async function toggleGift(id) {
        const g = STATE.gifts.find(x => x.id === id);
        if (!g) return;
        const newStatus = g.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
        try {
            await api.put('/live-interact/gifts/' + id, { status: newStatus });
            toast.success(newStatus === 'ENABLED' ? '已启用' : '已禁用');
            loadGifts();
        } catch (e) { toast.error(e.message); }
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function escapeAttr(s) { return escapeHtml(s); }

    async function checkHealth() {
        try {
            await api.get('/health');
            $('#statusDot').className = 'status-dot ok';
            $('#statusText').textContent = '服务正常';
        } catch {
            $('#statusDot').className = 'status-dot err';
            $('#statusText').textContent = '连接失败';
        }
    }

    function bindEvents() {
        document.addEventListener('click', (e) => {
            const navEl = e.target.closest('[data-tab]');
            if (navEl) {
                e.preventDefault();
                switchTab(navEl.dataset.tab);
                return;
            }
            const switchEl = e.target.closest('[data-switch-tab]');
            if (switchEl) {
                switchTab(switchEl.dataset.switchTab);
                return;
            }
            if (e.target.matches('[data-close="modal"]')) {
                modal.close();
                return;
            }

            const action = e.target.dataset.action;
            if (!action) return;
            const row = e.target.closest('tr');
            const id = e.target.dataset.id || (row && row.dataset.id);

            if (action === 'view' && e.target.closest('#videosTable')) viewVideo(id);
            else if (action === 'play' && e.target.closest('#videosTable')) playVideo(id);
            else if (action === 'play' && e.target.closest('#recentVideosTable')) playVideo(id);
            else if (action === 'view' && e.target.closest('#recentVideosTable')) viewVideo(id);
            else if (action === 'edit' && e.target.closest('#videosTable')) editVideo(id);
            else if (action === 'transcode') transcodeVideo(id);
            else if (action === 'thumb') thumbnailVideo(id);
            else if (action === 'publish') publishVideo(id);
            else if (action === 'delete' && e.target.closest('#videosTable')) deleteVideo(id);

            else if (action === 'view' && e.target.closest('#templatesTable')) {
                const t = STATE.templates.find(x => x.id === id);
                if (t) modal.open({ title: '模板详情', body: `<pre style="white-space:pre-wrap;font-size:12px;">${escapeHtml(JSON.stringify(t, null, 2))}</pre>`, footer: '<button class="btn btn-ghost" data-close="modal">关闭</button>', size: 'lg' });
            }
            else if (action === 'edit' && e.target.closest('#templatesTable')) editTemplate(id);
            else if (action === 'delete' && e.target.closest('#templatesTable')) deleteTemplate(id);

            else if (action === 'edit' && e.target.closest('#categoriesTable')) editCategory(id);
            else if (action === 'delete' && e.target.closest('#categoriesTable')) deleteCategory(id);

            else if (action === 'delete' && e.target.closest('#objectsTable')) deleteObject(e.target.dataset.name);

            else if (action === 'view-room') viewLiveRoom(id);
            else if (action === 'edit-room') editLiveRoom(id);
            else if (action === 'delete-room') deleteLiveRoom(id);
            else if (action === 'ban-room') banLiveRoom(id);
            else if (action === 'unban-room') unbanLiveRoom(id);
            else if (action === 'reset-key') resetStreamKey(id);
            else if (action === 'stream-config') viewStreamConfig(id);
            else if (action === 'room-stats') viewRoomStats(id);
            else if (action === 'recordings') viewRoomRecordings(id);

            else if (action === 'edit-gift') editGift(id);
            else if (action === 'toggle-gift') toggleGift(id);
        });

        $('#refreshBtn').addEventListener('click', () => switchTab(STATE.currentTab));
        $('#newUploadBtn').addEventListener('click', () => switchTab('upload'));
        $('#newLiveRoomBtn').addEventListener('click', createLiveRoom);
        $('#newGiftBtn').addEventListener('click', createGift);
        $('#videoSearch').addEventListener('input', debounce((e) => {
            STATE.videos.filters.search = e.target.value;
            STATE.videos.page = 1;
            loadVideos();
        }, 300));
        $('#videoCategoryFilter').addEventListener('change', (e) => {
            STATE.videos.filters.categoryId = e.target.value;
            STATE.videos.page = 1;
            loadVideos();
        });
        $('#videoStatusFilter').addEventListener('change', (e) => {
            STATE.videos.filters.status = e.target.value;
            STATE.videos.page = 1;
            loadVideos();
        });
        $('#videosPagination').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-page]');
            if (!btn || btn.disabled) return;
            const p = parseInt(btn.dataset.page, 10);
            if (!isNaN(p)) { STATE.videos.page = p; loadVideos(); }
        });

        $('#includePresets').addEventListener('change', loadTemplates);
        $('#newTemplateBtn').addEventListener('click', newTemplate);
        $('#newCategoryBtn').addEventListener('click', newCategory);
        $('#newTagBtn').addEventListener('click', newTag);
        $('#tagSearch').addEventListener('input', debounce(loadTags, 300));
        $('#tagsList').addEventListener('click', (e) => {
            const del = e.target.closest('.tag-del');
            if (del) deleteTag(del.dataset.id);
        });
        $('#refreshStorageBtn').addEventListener('click', loadStorage);
        $('#listObjectsBtn').addEventListener('click', listObjects);

        $('#liveRoomSearch').addEventListener('input', debounce((e) => {
            STATE.liveRooms.filters.search = e.target.value;
            STATE.liveRooms.page = 1;
            loadLiveRooms();
        }, 300));
        $('#liveRoomCategoryFilter').addEventListener('change', (e) => {
            STATE.liveRooms.filters.categoryId = e.target.value;
            STATE.liveRooms.page = 1;
            loadLiveRooms();
        });
        $('#liveRoomStatusFilter').addEventListener('change', (e) => {
            STATE.liveRooms.filters.status = e.target.value;
            STATE.liveRooms.page = 1;
            loadLiveRooms();
        });
        $('#liveRoomsPagination').addEventListener('click', (e) => {
            const btn = e.target.closest('[data-live-page]');
            if (!btn || btn.disabled) return;
            const p = parseInt(btn.dataset.livePage, 10);
            if (!isNaN(p)) { STATE.liveRooms.page = p; loadLiveRooms(); }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') modal.close();
        });
    }

    function debounce(fn, wait) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function init() {
        bindEvents();
        initUploadTab();
        loadCategoriesForSelect();
        checkHealth();
        loadDashboard();
        setInterval(checkHealth, 30000);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
