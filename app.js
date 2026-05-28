/**
 * 墨砚台 - AI 小说创作平台
 * Frontend Application Logic
 * 
 * Uses Tauri invoke when available (desktop), falls back to Store (localStorage) for browser preview.
 */

// ============================================
// Bridge: Tauri or localStorage
// ============================================
const Bridge = {
    _useTauri: false,
    
    init() {
        this._useTauri = typeof window.__TAURI__ !== 'undefined';
    },
    
    async invoke(cmd, args = {}) {
        if (this._useTauri) {
            try {
                return await window.__TAURI__.invoke(cmd, args);
            } catch (e) {
                console.error('Tauri invoke error:', e);
                return null;
            }
        }
        return null;
    },
    
    isTauri() { return this._useTauri; }
};

// ============================================
// Storage Adapter (wraps Store for localStorage)
// ============================================
const Store = {
    _data: {},
    
    init() {
        const saved = localStorage.getItem('moyantai_data');
        if (saved) {
            try { this._data = JSON.parse(saved); } catch(e) { this._data = {}; }
        }
        if (!this._data.books) this._data.books = {};
        if (!this._data.settings) this._data.settings = this._defaultSettings();
    },
    
    _defaultSettings() {
        return {
            theme: 'parchment',
            editorFontSize: 16,
            editorLineHeight: 1.8,
            editorMaxWidth: 1100,
            glassEnabled: true,
            aiProvider: 'openai',
            aiProviderType: 'openai',
            aiApiKey: '',
            aiBaseUrl: '',
            aiModel: 'gpt-4o',
            chapterListOrder: 'asc'
        };
    },
    
    save() {
        localStorage.setItem('moyantai_data', JSON.stringify(this._data));
    },
    
    get books() { return this._data.books; },
    get settings() { return this._data.settings; },
    
    getBook(bookId) { return this._data.books[bookId] || null; },
    
    createBook(title, genre, desc) {
        const id = 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        this._data.books[id] = {
            id,
            title,
            genre,
            description: desc || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            chapters: {},
            chapterOrder: []
        };
        this.save();
        return id;
    },
    
    deleteBook(bookId) {
        delete this._data.books[bookId];
        this.save();
    },
    
    addChapter(bookId, title) {
        const book = this._data.books[bookId];
        if (!book) return null;
        const chId = 'ch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const chTitle = title || `第${book.chapterOrder.length + 1}章`;
        book.chapters[chId] = {
            id: chId,
            title: chTitle,
            content: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: []
        };
        book.chapterOrder.push(chId);
        book.updatedAt = new Date().toISOString();
        this.save();
        return chId;
    },
    
    updateChapter(bookId, chId, content, title) {
        const book = this._data.books[bookId];
        if (!book || !book.chapters[chId]) return;
        const ch = book.chapters[chId];
        if (ch.content && ch.content !== content) {
            ch.history.push({
                at: ch.updatedAt,
                content: ch.content,
                id: 'hist_' + Date.now()
            });
        }
        if (title) ch.title = title;
        ch.content = content;
        ch.updatedAt = new Date().toISOString();
        book.updatedAt = new Date().toISOString();
        this.save();
    },
    
    deleteChapter(bookId, chId) {
        const book = this._data.books[bookId];
        if (!book) return;
        delete book.chapters[chId];
        book.chapterOrder = book.chapterOrder.filter(id => id !== chId);
        book.updatedAt = new Date().toISOString();
        this.save();
    },
    
    updateSettings(key, value) {
        this._data.settings[key] = value;
        this.save();
    }
};

// ============================================
// App Controller
// ============================================
const App = {
    currentBookId: null,
    currentChapterId: null,
    saveTimer: null,
    isDirty: false,
    
    async init() {
        Bridge.init();
        Store.init();
        this.bindNavigation();
        this.bindCreateForm();
        this.bindEditor();
        this.bindSettings();
        this.bindAI();
        this.bindSidebar();
        
        // Try loading settings from Tauri backend
        if (Bridge.isTauri()) {
            const settings = await Bridge.invoke('get_settings');
            if (settings) {
                this._remoteSettings = settings;
            }
        }
        
        this.applySettings();
        this.applyTheme();
        this.showPage('create');
    },
    
    _remoteSettings: null,
    
    // ---------- Navigation ----------
    bindNavigation() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                this.showPage(page);
            });
        });
    },
    
    showPage(page) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        
        const pageEl = document.getElementById('page-' + page);
        if (pageEl) pageEl.classList.add('active');
        
        const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navBtn) navBtn.classList.add('active');
        
        if (page === 'open') this.renderBookList();
        if (page === 'workspace' && !this.currentBookId) {
            this.showPage('open');
        }
    },
    
    // ---------- Sidebar ----------
    bindSidebar() {
        const toggle = document.getElementById('toggle-sidebar');
        const sidebar = document.getElementById('sidebar');
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    },
    
    // ---------- Create Book ----------
    bindCreateForm() {
        const form = document.getElementById('form-create');
        const cancelBtn = document.getElementById('btn-create-cancel');
        
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('book-title').value.trim();
            const genre = document.getElementById('book-genre').value;
            const desc = document.getElementById('book-desc').value.trim();
            if (!title) return;
            
            if (Bridge.isTauri()) {
                const result = await Bridge.invoke('create_book', {
                    title, genre, description: desc
                });
                if (result) {
                    this.openBook(result.id);
                    return;
                }
            }
            
            const bookId = Store.createBook(title, genre, desc);
            document.getElementById('book-title').value = '';
            document.getElementById('book-desc').value = '';
            this.openBook(bookId);
        });
        
        cancelBtn.addEventListener('click', () => {
            form.reset();
            this.showPage('open');
        });
    },
    
    // ---------- Book List ----------
    async renderBookList() {
        const grid = document.getElementById('book-list');
        const empty = document.getElementById('no-books');
        let books = [];
        
        if (Bridge.isTauri()) {
            const result = await Bridge.invoke('get_books');
            if (result) books = result;
        }
        
        if (books.length === 0) {
            books = Object.values(Store.books);
        }
        
        if (books.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        
        empty.classList.add('hidden');
        
        const genreMap = {
            xuanhuan: '玄幻', qihuan: '奇幻', wuxia: '武侠', xianxia: '仙侠',
            dushi: '都市', lishi: '历史', junshi: '军事', kehuan: '科幻',
            lingyi: '灵异', youxi: '游戏', jingji: '竞技', tongren: '同人'
        };
        
        grid.innerHTML = books.map(book => {
            const chCount = book.chapter_order ? book.chapter_order.length : 0;
            const chs = book.chapters || {};
            const wordCount = Object.values(chs).reduce((sum, ch) => {
                return sum + (ch.content ? ch.content.replace(/<[^>]*>/g, '').length : 0);
            }, 0);
            const date = new Date(book.updated_at).toLocaleDateString('zh-CN');
            
            return `
                <div class="book-card" data-book-id="${book.id}">
                    <div class="book-card-title">${this._escHtml(book.title)}</div>
                    <div class="book-card-genre">${genreMap[book.genre] || book.genre} · ${chCount} 章</div>
                    <div class="book-card-meta">${wordCount} 字 · 更新于 ${date}</div>
                </div>
            `;
        }).join('');
        
        grid.querySelectorAll('.book-card').forEach(card => {
            card.addEventListener('click', () => {
                this.openBook(card.dataset.bookId);
            });
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (confirm('确定删除此作品？')) {
                    if (Bridge.isTauri()) {
                        Bridge.invoke('delete_book', { book_id: card.dataset.bookId });
                    } else {
                        Store.deleteBook(card.dataset.bookId);
                    }
                    this.renderBookList();
                }
            });
        });
    },
    
    // ---------- Open Book / Workspace ----------
    openBook(bookId) {
        this.currentBookId = bookId;
        this.currentChapterId = null;
        
        if (Bridge.isTauri()) {
            Bridge.invoke('get_books').then(books => {
                const book = books.find(b => b.id === bookId);
                if (book) {
                    document.getElementById('editor-book-title').textContent = book.title;
                    this.renderChapterListTauri(book);
                    this.showPage('workspace');
                }
            });
        } else {
            const book = Store.getBook(bookId);
            if (book) {
                document.getElementById('editor-book-title').textContent = book.title;
                this.renderChapterList();
                this.showPage('workspace');
            }
        }
    },
    
    // ---------- Chapter List ----------
    renderChapterList() {
        const list = document.getElementById('chapter-list');
        const book = Store.getBook(this.currentBookId);
        if (!book) return;
        
        const order = book.chapterOrder || [];
        if (order.length === 0) {
            list.innerHTML = `<div class="empty-state" style="padding:40px 10px;"><p style="font-size:13px;">暂无章节</p></div>`;
            return;
        }
        
        list.innerHTML = order.map((chId) => {
            const ch = book.chapters[chId];
            if (!ch) return '';
            return `
                <div class="chapter-item ${chId === this.currentChapterId ? 'active' : ''}" data-ch-id="${chId}">
                    <span class="chapter-item-title">${this._escHtml(ch.title)}</span>
                    <div class="chapter-item-actions">
                        <button class="icon-btn btn-delete-ch" data-ch-id="${chId}" title="删除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        this._bindChapterEvents();
    },
    
    async renderChapterListTauri(book) {
        const list = document.getElementById('chapter-list');
        const order = book.chapter_order || [];
        if (order.length === 0) {
            list.innerHTML = `<div class="empty-state" style="padding:40px 10px;"><p style="font-size:13px;">暂无章节</p></div>`;
            return;
        }
        
        list.innerHTML = order.map((chId) => {
            const ch = (book.chapters || {})[chId];
            if (!ch) return '';
            return `
                <div class="chapter-item ${chId === this.currentChapterId ? 'active' : ''}" data-ch-id="${chId}">
                    <span class="chapter-item-title">${this._escHtml(ch.title)}</span>
                    <div class="chapter-item-actions">
                        <button class="icon-btn btn-delete-ch" data-ch-id="${chId}" title="删除">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        this._bindChapterEvents();
    },
    
    _bindChapterEvents() {
        const list = document.getElementById('chapter-list');
        list.querySelectorAll('.chapter-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-ch')) return;
                this.selectChapter(item.dataset.chId);
            });
        });
        list.querySelectorAll('.btn-delete-ch').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('确定删除此章节？')) {
                    const chId = btn.dataset.chId;
                    if (Bridge.isTauri()) {
                        await Bridge.invoke('delete_chapter', {
                            book_id: this.currentBookId,
                            chapter_id: chId
                        });
                    } else {
                        Store.deleteChapter(this.currentBookId, chId);
                    }
                    if (chId === this.currentChapterId) {
                        this.currentChapterId = null;
                        document.getElementById('editor').value = '';
                        document.getElementById('status-words').textContent = '字数：0';
                        document.getElementById('editor-chapter-title').textContent = '-';
                    }
                    this.refreshChapterList();
                }
            });
        });
    },
    
    async refreshChapterList() {
        if (Bridge.isTauri()) {
            const books = await Bridge.invoke('get_books');
            const book = books ? books.find(b => b.id === this.currentBookId) : null;
            if (book) {
                await this.renderChapterListTauri(book);
            }
        } else {
            this.renderChapterList();
        }
    },
    
    selectChapter(chId) {
        this.flushSave();
        this.currentChapterId = chId;
        
        if (Bridge.isTauri()) {
            // In Tauri mode, we need to get the full book data
            Bridge.invoke('get_books').then(books => {
                const book = books.find(b => b.id === this.currentBookId);
                const ch = book ? (book.chapters || {})[chId] : null;
                if (ch) {
                    document.getElementById('editor').value = ch.content || '';
                    document.getElementById('editor-chapter-title').textContent = ch.title;
                    this.updateWordCount();
                    document.getElementById('status-saved').textContent = '已保存';
                    this.isDirty = false;
                }
                this.refreshChapterList();
                document.getElementById('editor').focus();
            });
        } else {
            const book = Store.getBook(this.currentBookId);
            const ch = book ? book.chapters[chId] : null;
            if (ch) {
                document.getElementById('editor').value = ch.content || '';
                document.getElementById('editor-chapter-title').textContent = ch.title;
                this.updateWordCount();
                document.getElementById('status-saved').textContent = '已保存';
                this.isDirty = false;
            }
            this.renderChapterList();
            document.getElementById('editor').focus();
        }
    },
    
    // ---------- Editor ----------
    bindEditor() {
        const editor = document.getElementById('editor');
        
        editor.addEventListener('input', () => {
            this.isDirty = true;
            document.getElementById('status-saved').textContent = '编辑中...';
            this.updateWordCount();
            this.autoSave();
        });
        
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
                this.isDirty = true;
                this.autoSave();
            }
        });
        
        document.getElementById('btn-add-chapter').addEventListener('click', async () => {
            if (Bridge.isTauri()) {
                const ch = await Bridge.invoke('add_chapter', {
                    book_id: this.currentBookId,
                    title: null
                });
                if (ch) {
                    await this.refreshChapterList();
                    this.selectChapter(ch.id);
                }
            } else {
                const chId = Store.addChapter(this.currentBookId);
                if (chId) {
                    this.renderChapterList();
                    this.selectChapter(chId);
                }
            }
        });
        
        document.getElementById('btn-save-chapter').addEventListener('click', () => {
            this.flushSave();
        });
        
        document.getElementById('btn-ai-continue').addEventListener('click', () => {
            this.openAI();
        });
    },
    
    autoSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSave(), 1500);
    },
    
    async flushSave() {
        if (!this.isDirty || !this.currentBookId || !this.currentChapterId) return;
        
        const content = document.getElementById('editor').value;
        
        if (Bridge.isTauri()) {
            await Bridge.invoke('update_chapter', {
                book_id: this.currentBookId,
                chapter_id: this.currentChapterId,
                content: content,
                title: null
            });
        } else {
            const book = Store.getBook(this.currentBookId);
            const ch = book ? book.chapters[this.currentChapterId] : null;
            if (ch) {
                Store.updateChapter(this.currentBookId, this.currentChapterId, content, ch.title);
            }
        }
        
        this.isDirty = false;
        document.getElementById('status-saved').textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN');
        await this.refreshChapterList();
    },
    
    updateWordCount() {
        const text = document.getElementById('editor').value;
        const count = text.replace(/<[^>]*>/g, '').replace(/\s/g, '').length;
        document.getElementById('status-words').textContent = `字数：${count}`;
    },
    
    // ---------- Settings ----------
    bindSettings() {
        const overlay = document.getElementById('settings-overlay');
        
        document.getElementById('btn-settings').addEventListener('click', () => {
            overlay.classList.remove('hidden');
            this.loadSettingsUI();
        });
        
        document.getElementById('btn-close-settings').addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.add('hidden');
        });
        
        document.getElementById('setting-font-size').addEventListener('input', (e) => {
            Store.updateSettings('editorFontSize', parseInt(e.target.value));
            document.getElementById('font-size-value').textContent = e.target.value + 'px';
            this.applyEditorStyles();
        });
        
        document.getElementById('setting-line-height').addEventListener('input', (e) => {
            Store.updateSettings('editorLineHeight', parseFloat(e.target.value));
            document.getElementById('line-height-value').textContent = e.target.value;
            this.applyEditorStyles();
        });
        
        document.getElementById('setting-theme').addEventListener('change', (e) => {
            Store.updateSettings('theme', e.target.value);
            this.applyTheme();
        });
        
        ['setting-provider', 'setting-apikey', 'setting-baseurl', 'setting-model'].forEach(id => {
            document.getElementById(id).addEventListener('change', (e) => {
                const keyMap = {
                    'setting-provider': 'aiProvider',
                    'setting-apikey': 'aiApiKey',
                    'setting-baseurl': 'aiBaseUrl',
                    'setting-model': 'aiModel'
                };
                Store.updateSettings(keyMap[id], e.target.value);
                if (id === 'setting-provider') {
                    this._onProviderChange(e.target.value);
                }
            });
        });
    },
    
    loadSettingsUI() {
        const s = Store.settings;
        document.getElementById('setting-font-size').value = s.editorFontSize;
        document.getElementById('font-size-value').textContent = s.editorFontSize + 'px';
        document.getElementById('setting-line-height').value = s.editorLineHeight;
        document.getElementById('line-height-value').textContent = s.editorLineHeight;
        document.getElementById('setting-theme').value = s.theme;
        document.getElementById('setting-provider').value = s.aiProvider;
        document.getElementById('setting-apikey').value = s.aiApiKey;
        document.getElementById('setting-baseurl').value = s.aiBaseUrl;
        document.getElementById('setting-model').value = s.aiModel;
    },
    
    applySettings() {
        this.applyTheme();
        this.applyEditorStyles();
    },
    
    applyTheme() {
        const theme = Store.settings.theme;
        document.documentElement.setAttribute('data-theme', theme);
    },
    
    applyEditorStyles() {
        const s = Store.settings;
        const editor = document.getElementById('editor');
        editor.style.fontSize = s.editorFontSize + 'px';
        editor.style.lineHeight = s.editorLineHeight;
    },
    
    // ---------- AI Panel ----------
    bindAI() {
        const overlay = document.getElementById('ai-overlay');
        
        document.getElementById('btn-close-ai').addEventListener('click', () => {
            overlay.classList.add('hidden');
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.add('hidden');
        });
        
        document.querySelectorAll('.ai-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
            });
        });
        
        document.getElementById('btn-ai-generate').addEventListener('click', () => {
            this.generateAI();
        });
        
        document.getElementById('btn-ai-discard').addEventListener('click', () => {
            document.getElementById('ai-result').classList.add('hidden');
            document.getElementById('ai-prompt-area').classList.remove('hidden');
            document.getElementById('ai-prompt').value = '';
        });
        
        document.getElementById('btn-ai-apply').addEventListener('click', () => {
            this.applyAIResult();
        });
    },
    
    openAI() {
        document.getElementById('ai-overlay').classList.remove('hidden');
        document.getElementById('ai-prompt-area').classList.remove('hidden');
        document.getElementById('ai-result').classList.add('hidden');
        document.getElementById('ai-prompt').value = '根据当前内容，续写一段符合风格的剧情。';
    },
    
    async generateAI() {
        const prompt = document.getElementById('ai-prompt').value.trim();
        if (!prompt) return;
        
        const resultArea = document.getElementById('ai-result');
        const resultText = resultArea.querySelector('.ai-result-text');
        resultText.textContent = '正在生成...';
        resultArea.classList.remove('hidden');
        document.getElementById('ai-prompt-area').classList.add('hidden');
        
        try {
            let aiText = '';
            if (Bridge.isTauri()) {
                aiText = await Bridge.invoke('ai_generate', {
                    book_id: this.currentBookId,
                    chapter_id: this.currentChapterId,
                    prompt: prompt,
                    action: 'continue'
                }) || '生成失败';
            } else {
                aiText = await this._callAIFromBrowser(prompt);
            }
            resultText.textContent = aiText;
        } catch (e) {
            resultText.textContent = '生成失败：' + e.message;
        }
    },
    
    async _callAIFromBrowser(prompt) {
        const s = Store.settings;
        const apiKey = s.aiApiKey;
        const baseUrl = (s.aiBaseUrl || 'https://api.openai.com').replace(/\/$/, '');
        const model = s.aiModel || 'gpt-4o';
        
        if (!apiKey) {
            return '请先在设置中配置 AI API Key。';
        }
        
        // Build context from current chapter
        const editor = document.getElementById('editor');
        const currentContent = editor.value || '';
        const systemPrompt = '你是专业的小说创作助手。请根据用户提供的现有内容和提示词，续写一段符合风格和语境的剧情。保持叙事连贯，人物性格一致，文笔流畅。';
        const userPrompt = `当前章节内容：\n${currentContent.slice(-3000)}\n\n用户要求：${prompt}`;
        
        const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 1024,
                temperature: 0.8
            })
        });
        
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
        }
        
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || 'AI 未返回有效内容';
    },
    
    _onProviderChange(provider) {
        const presets = {
            openai:   { baseUrl: '', model: 'gpt-4o' },
            deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
            zhipu:    { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
            moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
            stepfun:  { baseUrl: 'https://api.stepfun.com/v1', model: 'step-2-16k' },
            google:   { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' }
        };
        const p = presets[provider] || presets.openai;
        Store.updateSettings('aiBaseUrl', p.baseUrl);
        Store.updateSettings('aiModel', p.model);
        document.getElementById('setting-baseurl').value = p.baseUrl;
        document.getElementById('setting-model').value = p.model;
    },
    
    applyAIResult() {
        const resultText = document.querySelector('.ai-result-text').textContent;
        if (resultText && !resultText.includes('待接入')) {
            const editor = document.getElementById('editor');
            editor.value += '\n\n' + resultText;
            this.isDirty = true;
            this.flushSave();
        }
        document.getElementById('ai-overlay').classList.add('hidden');
    },
    
    // ---------- Utilities ----------
    _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

// ============================================
// Bootstrap
// ============================================
document.addEventListener('DOMContentLoaded', () => App.init());
