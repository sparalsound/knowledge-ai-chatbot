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

    // Webhook URL Setup
    let WEBHOOK_URL = localStorage.getItem('n8nWebhookUrl') || "https://islamist-mouth-rocker.ngrok-free.dev/webhook/chat";
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
    });

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
