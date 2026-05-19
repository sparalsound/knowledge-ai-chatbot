document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');
    const root = document.documentElement;
    const chatMessages = document.getElementById('chatMessages');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsPanel = document.querySelector('.settings-panel');
    const webhookUrlInput = document.getElementById('webhookUrl');
    const saveWebhookBtn = document.getElementById('saveWebhookBtn');

    // Sidebar Manuals List Elements
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarLeft = document.getElementById('sidebarLeft');
    const refreshManualsBtn = document.getElementById('refreshManualsBtn');
    const manualSearchInput = document.getElementById('manualSearch');
    const manualsList = document.getElementById('manualsList');
    const manualCount = document.getElementById('manualCount');

    // Webhook URL Setup
    const urlParams = new URLSearchParams(window.location.search);
    const apiParam = urlParams.get('api');
    if (apiParam) {
        let cleanApi = apiParam.trim();
        if (cleanApi.startsWith('http')) {
            if (!cleanApi.includes('/webhook/')) {
                cleanApi = cleanApi.replace(/\/$/, '') + '/webhook/chat';
            }
            localStorage.setItem('n8nWebhookUrl', cleanApi);
        }
    }

    let WEBHOOK_URL = localStorage.getItem('n8nWebhookUrl') || "http://localhost:5678/webhook/chat";
    webhookUrlInput.value = WEBHOOK_URL;

    // Persistent session ID for conversation memory
    let SESSION_ID = localStorage.getItem('chatSessionId');
    if (!SESSION_ID) {
        SESSION_ID = 'user-session-' + Date.now();
        localStorage.setItem('chatSessionId', SESSION_ID);
    }

    // Theme Management
    const savedTheme = localStorage.getItem('theme') || 'light';
    root.setAttribute('data-theme', savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });

    // Settings Panel Toggle
    settingsToggle.addEventListener('click', () => {
        settingsPanel.classList.toggle('open');
    });

    saveWebhookBtn.addEventListener('click', () => {
        WEBHOOK_URL = webhookUrlInput.value.trim();
        localStorage.setItem('n8nWebhookUrl', WEBHOOK_URL);
        settingsPanel.classList.remove('open');
        
        // Show confirmation
        addBotMessage('Webhook URL이 저장되었습니다. 이제 질문을 시작할 수 있습니다.');
        
        // Refresh manuals list after webhook update
        fetchManuals();
    });

    // Mobile Sidebar Toggling
    if (sidebarToggle && sidebarLeft) {
        sidebarToggle.addEventListener('click', () => {
            sidebarLeft.classList.toggle('open');
        });

        // Close sidebar when clicking outside on mobile devices
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (!sidebarLeft.contains(e.target) && !sidebarToggle.contains(e.target)) {
                    sidebarLeft.classList.remove('open');
                }
            }
        });
    }

    // Reference Manuals State & Logic
    let allManuals = [];

    async function fetchManuals() {
        if (!manualsList) return;

        // Render sleek loading indicator
        manualsList.innerHTML = `
            <div class="manual-loading">
                <div class="pulse-loader"></div>
                <span>학습된 매뉴얼을 불러오는 중...</span>
            </div>
        `;

        try {
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'list_manuals'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            allManuals = data.manuals || [];
            renderManuals(allManuals);

        } catch (error) {
            console.error('Error fetching manuals:', error);
            manualsList.innerHTML = `
                <div class="manual-empty">
                    <i class="ri-error-warning-line" style="font-size: 1.5rem; color: var(--text-secondary);"></i>
                    <p>매뉴얼 목록 로드 실패</p>
                    <span style="font-size: 0.75rem; opacity: 0.6;">n8n 서버 상태를 확인해주세요.</span>
                </div>
            `;
            if (manualCount) manualCount.textContent = '0';
        }
    }

    function renderManuals(manuals) {
        if (manualCount) manualCount.textContent = manuals.length;

        if (manuals.length === 0) {
            manualsList.innerHTML = `
                <div class="manual-empty">
                    <i class="ri-inbox-line" style="font-size: 1.5rem; color: var(--text-secondary);"></i>
                    <p>학습된 매뉴얼이 없습니다.</p>
                </div>
            `;
            return;
        }

        manualsList.innerHTML = '';
        manuals.forEach(manual => {
            const card = document.createElement('div');
            card.className = 'manual-card';

            const isPdf = manual.file.toLowerCase().endsWith('.pdf');
            const iconClass = isPdf ? 'ri-file-pdf-line' : 'ri-file-text-line';
            const iconBgClass = isPdf ? '' : 'doc';

            card.innerHTML = `
                <div class="manual-icon ${iconBgClass}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="manual-info">
                    <span class="manual-name" title="${escapeHTML(manual.name)}">${escapeHTML(manual.name)}</span>
                    <div class="manual-meta">
                        <span class="status-indicator" title="학습 완료"></span>
                        <span style="font-size: 0.7rem; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;" title="${escapeHTML(manual.file)}">${escapeHTML(manual.file)}</span>
                    </div>
                </div>
            `;

            // On manual card click, pre-fill user textarea with custom question prefix
            card.addEventListener('click', () => {
                userInput.value = `[${manual.name}] 관련해서 질문: `;
                userInput.focus();
                userInput.style.height = 'auto';
                userInput.style.height = (userInput.scrollHeight) + 'px';
                sendBtn.removeAttribute('disabled');
            });

            manualsList.appendChild(card);
        });
    }

    // Local Search Filtering
    if (manualSearchInput) {
        manualSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const filtered = allManuals.filter(manual =>
                manual.name.toLowerCase().includes(query) ||
                manual.file.toLowerCase().includes(query)
            );
            renderManuals(filtered);
        });
    }

    // Manual Refresh click listener
    if (refreshManualsBtn) {
        refreshManualsBtn.addEventListener('click', fetchManuals);
    }

    // Initial manual list fetch
    fetchManuals();

    // Auto-resize textarea
    userInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        
        if (this.value.trim() !== '') {
            sendBtn.removeAttribute('disabled');
        } else {
            sendBtn.setAttribute('disabled', 'true');
        }
    });

    // Handle Enter key (Shift+Enter for new line)
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (userInput.value.trim() !== '') {
                sendMessage();
            }
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    function formatTime() {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function addUserMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        
        msgDiv.innerHTML = `
            <div class="message-content">
                <p>${escapeHTML(text)}</p>
                <span class="time">${formatTime()}</span>
            </div>
        `;
        
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function addBotMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot';
        
        // Very basic markdown parser for bold and line breaks
        let formattedText = escapeHTML(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        msgDiv.innerHTML = `
            <div class="avatar"><i class="ri-robot-2-line"></i></div>
            <div class="message-content">
                <p>${formattedText}</p>
                <span class="time">${formatTime()}</span>
            </div>
        `;
        
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function addTypingIndicator() {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message bot typing';
        msgDiv.id = 'typingIndicator';
        
        msgDiv.innerHTML = `
            <div class="avatar"><i class="ri-robot-2-line"></i></div>
            <div class="message-content">
                <p class="typing-indicator">
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                </p>
            </div>
        `;
        
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
        return msgDiv;
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag])
        );
    }

    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text) return;

        // Reset input
        userInput.value = '';
        userInput.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');

        // UI Updates
        addUserMessage(text);
        const typingIndicator = addTypingIndicator();

        try {
            // API Call to n8n Webhook
            const response = await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sessionId: SESSION_ID,
                    chatInput: text
                })
            });

            // 안전하게 텍스트로 먼저 받은 후 JSON 파싱 시도
            const rawText = await response.text();
            
            // Remove typing indicator
            typingIndicator.remove();

            if (!rawText || rawText.trim() === '') {
                addBotMessage('⚠️ 서버가 빈 응답을 반환했습니다. 잠시 후 다시 시도해주세요.');
                return;
            }

            let data;
            try {
                data = JSON.parse(rawText);
            } catch (parseErr) {
                // JSON이 아닌 경우 텍스트 자체를 응답으로 사용
                console.warn('Non-JSON response:', rawText.substring(0, 200));
                addBotMessage(rawText);
                return;
            }

            // Extract the output from n8n response
            const reply = data.output || data.text || data.message || "죄송합니다. 적절한 응답을 찾지 못했습니다.";
            addBotMessage(reply);

            // Dynamically refresh reference manuals list after message exchange to capture any learning updates!
            fetchManuals();

        } catch (error) {
            console.error('Error calling webhook:', error);
            typingIndicator.remove();
            
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                addBotMessage('⚠️ 서버에 연결할 수 없습니다. n8n 워크플로우가 실행 중이고 Webhook URL이 올바른지 설정 패널(우측 상단 톱니바퀴)에서 확인해주세요.');
            } else {
                addBotMessage('⚠️ 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            }
        }
    }
});
