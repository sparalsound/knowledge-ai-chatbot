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
    
    // Dynamic Config Elements
    const chatbotTitle = document.getElementById('chatbotTitle');
    const chatbotWelcomeMsg = document.getElementById('chatbotWelcomeMsg');
    
    // Password Gate Elements
    const teamGate = document.getElementById('teamGate');
    const teamGateTitle = document.getElementById('teamGateTitle');
    const teamGateDesc = document.getElementById('teamGateDesc');
    const teamGateInput = document.getElementById('teamGateInput');
    const teamGateError = document.getElementById('teamGateError');
    const teamGateSubmitBtn = document.getElementById('teamGateSubmitBtn');

    // Safe localStorage helper to prevent SecurityError when cookies/localStorage are disabled/blocked
    const safeStorage = {
        getItem(key) {
            try { return localStorage.getItem(key); } catch (e) { return null; }
        },
        setItem(key, value) {
            try { localStorage.setItem(key, value); } catch (e) {}
        },
        removeItem(key) {
            try { localStorage.removeItem(key); } catch (e) {}
        }
    };

    // Webhook URL Setup
    const urlParams = new URLSearchParams(window.location.search);
    const teamParam = urlParams.get('team');
    const apiParam = urlParams.get('api');
    if (apiParam) {
        let cleanApi = apiParam.trim();
        if (cleanApi.startsWith('http')) {
            if (!cleanApi.includes('/webhook/')) {
                cleanApi = cleanApi.replace(/\/$/, '') + '/webhook/chat';
            }
            safeStorage.setItem('n8nWebhookUrl', cleanApi);
        }
    }

    let WEBHOOK_URL = safeStorage.getItem('n8nWebhookUrl');
    
    // Auto-detect and discard mismatched hostnames from localStorage
    if (WEBHOOK_URL && !window.location.hostname.includes('localhost') && window.location.protocol !== 'file:') {
        try {
            const savedUrlObj = new URL(WEBHOOK_URL);
            if (savedUrlObj.hostname !== window.location.hostname) {
                console.warn('Discarding cached webhook URL from different domain:', savedUrlObj.hostname);
                safeStorage.removeItem('n8nWebhookUrl');
                WEBHOOK_URL = null;
            }
        } catch (e) {
            safeStorage.removeItem('n8nWebhookUrl');
            WEBHOOK_URL = null;
        }
    }

    // Default dynamically to current domain, fallback to trycloudflare if needed
    if (!WEBHOOK_URL) {
        if (window.location.origin && window.location.origin.startsWith('http') && window.location.protocol !== 'file:') {
            WEBHOOK_URL = window.location.origin + "/webhook/chat";
        } else {
            WEBHOOK_URL = "https://chatbot.brit-team.com/webhook/chat";
        }
    }
    
    const ADMIN_API_URL = WEBHOOK_URL.replace('/webhook/chat', '/webhook/admin-api');
    
    if (webhookUrlInput) {
        webhookUrlInput.value = WEBHOOK_URL;
    }

    // Persistent session ID for conversation memory
    let SESSION_ID = safeStorage.getItem('chatSessionId');
    if (!SESSION_ID) {
        SESSION_ID = 'user-session-' + Date.now();
        safeStorage.setItem('chatSessionId', SESSION_ID);
    }

    let teamConfig = null;

    // Password Gate Logic
    async function loadTeamConfig() {
        if (!teamParam) {
            showGateError('URL에 팀 파라미터가 없습니다. 올바른 주소로 접속해주세요.');
            return;
        }

        try {
            const res = await fetch(ADMIN_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'get_config' })
            });
            const data = await res.json();
            const config = data.config || { teams: {} };
            
            teamConfig = config.teams[teamParam];
            if (!teamConfig) {
                showGateError('유효하지 않은 챗봇 주소입니다.');
                return;
            }

            // Init Gate UI
            teamGateTitle.textContent = teamConfig.botName || '챗봇 접속';
            
            if (teamConfig.password) {
                teamGate.style.display = 'flex';
                teamGateInput.focus();
            } else {
                unlockApp();
            }
        } catch (e) {
            console.error('Config load error:', e);
            showGateError('서버에서 설정을 불러올 수 없습니다.');
        }
    }

    function showGateError(msg) {
        teamGate.style.display = 'flex';
        teamGateInput.style.display = 'none';
        teamGateSubmitBtn.style.display = 'none';
        teamGateError.style.display = 'block';
        teamGateError.textContent = msg;
    }

    teamGateSubmitBtn.addEventListener('click', verifyTeamPassword);
    teamGateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyTeamPassword();
    });

    function verifyTeamPassword() {
        const pwd = teamGateInput.value.trim();
        if (pwd === teamConfig.password) {
            unlockApp();
        } else {
            teamGateError.style.display = 'block';
            teamGateInput.value = '';
            teamGateInput.focus();
        }
    }

    function unlockApp() {
        teamGate.style.display = 'none';
        
        // Set dynamic texts
        if (chatbotTitle && teamConfig.botName) {
            chatbotTitle.textContent = teamConfig.botName;
            document.title = teamConfig.botName;
        }
        if (chatbotWelcomeMsg && teamConfig.welcomeMessage) {
            chatbotWelcomeMsg.innerHTML = escapeHTML(teamConfig.welcomeMessage).replace(/\\n/g, '<br>');
        }
        
        // Initial manual list fetch
        fetchManuals();
    }

    loadTeamConfig();

    // Theme Management
    const savedTheme = safeStorage.getItem('theme') || 'light';
    root.setAttribute('data-theme', savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = root.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', newTheme);
        safeStorage.setItem('theme', newTheme);
    });

    // Settings Panel Toggle
    if (settingsToggle) {
        settingsToggle.addEventListener('click', () => {
            settingsPanel.classList.toggle('open');
        });
    }

    // Close settings panel when close button or backdrop is clicked
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    if (closeSettingsBtn) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsPanel.classList.remove('open');
        });
    }

    if (settingsPanel) {
        settingsPanel.addEventListener('click', (e) => {
            if (e.target === settingsPanel) {
                settingsPanel.classList.remove('open');
            }
        });
    }

    saveWebhookBtn.addEventListener('click', () => {
        WEBHOOK_URL = webhookUrlInput.value.trim();
        safeStorage.setItem('n8nWebhookUrl', WEBHOOK_URL);
        settingsPanel.classList.remove('open');
        
        // Show confirmation
        addBotMessage('Webhook URL이 저장되었습니다. 이제 질문을 시작할 수 있습니다.');
        
        // Refresh manuals list after webhook update
        fetchManuals();
    });
    
    const resetWebhookBtn = document.getElementById('resetWebhookBtn');
    if (resetWebhookBtn) {
        resetWebhookBtn.addEventListener('click', () => {
            safeStorage.removeItem('n8nWebhookUrl');
            
            if (window.location.origin && window.location.origin.startsWith('http')) {
                WEBHOOK_URL = window.location.origin + "/webhook/chat";
            } else {
                WEBHOOK_URL = "https://chatbot.brit-team.com/webhook/chat";
            }
            
            webhookUrlInput.value = WEBHOOK_URL;
            settingsPanel.classList.remove('open');
            
            addBotMessage('Webhook URL이 기본값으로 초기화되었습니다.');
            fetchManuals();
        });
    }

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
                    action: 'list_manuals',
                    team: teamParam
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
                    chatInput: text,
                    team: teamParam
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
