window.onerror = function(message, source, lineno, colno, error) {
    alert("자바스크립트 오류 발생: " + message + " (줄: " + lineno + ", 열: " + colno + ")");
    console.error(error || message);
    return false;
};

function startAdmin() {
    // API Webhook Setup
    const ADMIN_API_URL = window.location.origin + "/webhook/admin-api";
    
    // Auth & Gate elements
    const passwordGate = document.getElementById('passwordGate');
    const gatePasswordInput = document.getElementById('gatePasswordInput');
    const gateSubmitBtn = document.getElementById('gateSubmitBtn');
    const gateErrorMsg = document.getElementById('gateErrorMsg');
    const adminContainer = document.getElementById('adminContainer');
    
    // Dynamic Containers
    const sidebarNav = document.getElementById('sidebarNav');
    const statsGrid = document.getElementById('statsGrid');
    const qdrantStatCard = document.getElementById('qdrantStatCard');
    const infoBlocksGrid = document.getElementById('infoBlocksGrid');
    const dynamicTabContentsContainer = document.getElementById('dynamicTabContentsContainer');
    
    // Header elements
    const currentTabTitle = document.getElementById('currentTabTitle');
    const currentTabDesc = document.getElementById('currentTabDesc');
    const notionStatusLamp = document.getElementById('notionStatusLamp');
    const qdrantStatusLamp = document.getElementById('qdrantStatusLamp');
    const countQdrantVectors = document.getElementById('count-qdrant-vectors');
    
    // Action bar elements
    const actionBar = document.getElementById('actionBar');
    const selectedCountText = document.getElementById('selectedCountText');
    const btnSyncSelected = document.getElementById('btnSyncSelected');
    const btnDeleteSelected = document.getElementById('btnDeleteSelected');
    
    // Console elements
    const consoleLogs = document.getElementById('consoleLogs');
    const clearConsoleBtn = document.getElementById('clearConsoleBtn');
    const refreshAllBtn = document.getElementById('refreshAllBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // State Variables
    let teamsData = [];
    let selectedManuals = new Set(); // Stores composite key "teamId:pageId"
    let currentActiveTab = 'dashboard';

    // 1. Password Verification Gate
    const adminAuthKey = 'chatbot_admin_authenticated';
    
    let isAuthenticated = false;
    try {
        isAuthenticated = (sessionStorage.getItem(adminAuthKey) === 'true');
    } catch (e) {
        console.warn("sessionStorage reading disabled:", e);
    }

    if (isAuthenticated) {
        unlockGate();
    }

    if (gateSubmitBtn) {
        gateSubmitBtn.addEventListener('click', verifyPassword);
    }
    if (gatePasswordInput) {
        gatePasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') verifyPassword();
        });
    }

    function verifyPassword() {
        try {
            if (!gatePasswordInput) {
                throw new Error("Password input element not found in DOM");
            }
            const password = gatePasswordInput.value.trim().toUpperCase();
            if (password === 'ITITIT') {
                try {
                    sessionStorage.setItem(adminAuthKey, 'true');
                } catch (e) {
                    console.warn("sessionStorage writing disabled:", e);
                }
                unlockGate();
            } else {
                if (gateErrorMsg) gateErrorMsg.style.display = 'block';
                gatePasswordInput.value = '';
                gatePasswordInput.focus();
            }
        } catch (err) {
            alert("로그인 처리 중 오류 발생: " + err.message);
            console.error(err);
        }
    }

    function unlockGate() {
        try {
            if (passwordGate) passwordGate.classList.add('hidden');
            if (adminContainer) adminContainer.classList.remove('hidden');
            addLog('관리자 세션 로그인 성공.', 'success');
            refreshAllState();
        } catch (err) {
            alert("대시보드 표시 중 오류 발생: " + err.message);
            console.error(err);
        }
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            try {
                sessionStorage.removeItem(adminAuthKey);
            } catch (e) {
                console.warn("sessionStorage clearing disabled:", e);
            }
            window.location.reload();
        });
    }

    // Dynamic Binding helper for Tabs
    function bindTabEvents() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            // Remove previous event listener if any, by cloning or just setting a new one carefully
            // The simplest is to replace with clone or use onclick
            item.onclick = (e) => {
                e.preventDefault();
                const tabName = item.getAttribute('data-tab');
                switchTab(tabName);
            };
        });
    }

    function switchTab(tabName) {
        currentActiveTab = tabName;
        
        // Update nav UI
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            if (item.getAttribute('data-tab') === tabName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Update content UI
        const tabContents = document.querySelectorAll('.tab-content');
        tabContents.forEach(content => {
            if (content.id === `tabContent-${tabName}`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        // Update header titles
        if (tabName === 'dashboard') {
            currentTabTitle.textContent = '대시보드';
            currentTabDesc.textContent = '지식 베이스 동기화 및 학습 상태 관리';
        } else {
            const team = teamsData.find(t => t.id === tabName);
            if (team) {
                currentTabTitle.textContent = team.name;
                currentTabDesc.textContent = `Notion DB: ${team.dbId} 상태 관리 (team=${team.id})`;
            }
        }

        clearSelections();
    }

    // 3. Logger helper
    function addLog(message, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.className = `log-line ${type}`;
        line.textContent = `[${time}] ${message}`;
        consoleLogs.appendChild(line);
        consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }

    clearConsoleBtn.addEventListener('click', () => {
        consoleLogs.innerHTML = '';
        addLog('로그 콘솔 초기화됨.');
    });

    // 4. API Actions
    refreshAllBtn.addEventListener('click', refreshAllState);

    async function refreshAllState() {
        addLog('데이터베이스 및 지식베이스 상태 동기화 분석을 시작합니다...', 'process');
        
        notionStatusLamp.className = 'status-indicator';
        qdrantStatusLamp.className = 'status-indicator';
        
        try {
            const response = await fetch(ADMIN_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list_all_manuals' })
            });

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status} ${await response.text()}`);
            }

            const data = await response.json();
            
            notionStatusLamp.className = 'status-indicator online';
            qdrantStatusLamp.className = 'status-indicator online';
            
            teamsData = data.teams || [];
            
            renderDynamicUI(data);
            
            addLog('모든 상태 조회가 성공적으로 완료되었습니다.', 'success');
        } catch (err) {
            addLog(`조회 오류 발생: ${err.message}`, 'error');
            console.error(err);
        }
    }

    function renderDynamicUI(data) {
        // 1. Clear dynamic containers
        const navDashboardNode = document.querySelector('.nav-item[data-tab="dashboard"]').cloneNode(true);
        sidebarNav.innerHTML = '';
        sidebarNav.appendChild(navDashboardNode);
        
        // Remove all old stat cards except the Qdrant one
        const statCards = statsGrid.querySelectorAll('.stat-card');
        statCards.forEach(card => {
            if (card.id !== 'qdrantStatCard') card.remove();
        });
        
        infoBlocksGrid.innerHTML = '';
        dynamicTabContentsContainer.innerHTML = '';
        const configFormsContainer = document.getElementById('configFormsContainer');
        if (configFormsContainer) configFormsContainer.innerHTML = '';
        
        // 2. Build for each team
        teamsData.forEach((team, idx) => {
            const manuals = team.manuals || [];
            const syncedCount = manuals.filter(m => m.status === '동기화 완료').length;
            
            // --- Navigation ---
            const navA = document.createElement('a');
            navA.href = '#';
            navA.className = 'nav-item';
            navA.setAttribute('data-tab', team.id);
            // Alternate icons for variety
            const iconClass = idx % 2 === 0 ? 'ri-database-2-line' : 'ri-database-line';
            navA.innerHTML = `<i class="${iconClass}"></i> ${escapeHTML(team.name)}`;
            sidebarNav.appendChild(navA);
            
            // --- Stats Card ---
            const statCard = document.createElement('div');
            statCard.className = 'stat-card';
            const bgClass = idx % 2 === 0 ? 'original' : 'new';
            const statIconClass = idx % 2 === 0 ? 'ri-folders-line' : 'ri-folder-add-line';
            statCard.innerHTML = `
                <div class="stat-icon ${bgClass}"><i class="${statIconClass}"></i></div>
                <div class="stat-info">
                    <span class="stat-label">${escapeHTML(team.name)}</span>
                    <h3 class="stat-val">${manuals.length} 개</h3>
                    <span class="stat-sub">${syncedCount} 개 동기화 완료</span>
                </div>
            `;
            statsGrid.insertBefore(statCard, qdrantStatCard);
            
            // --- Info Block ---
            const infoBlock = document.createElement('div');
            infoBlock.className = 'info-block';
            const badgeClass = idx % 2 === 0 ? 'badge-original' : 'badge-new';
            infoBlock.innerHTML = `
                <div class="block-header">
                    <h4>${escapeHTML(team.name)} 정보</h4>
                    <span class="badge ${badgeClass}">team=${escapeHTML(team.id)}</span>
                </div>
                <div class="block-body">
                    <p><strong>DB ID:</strong> <code>${escapeHTML(team.dbId)}</code></p>
                    <p><strong>첨부파일 컬럼:</strong> <code>File</code> (자동 매핑됨)</p>
                    <p>URL 파라미터 <code>?team=${escapeHTML(team.id)}</code> 설정 시 라우팅되어 참조됩니다.</p>
                </div>
            `;
            infoBlocksGrid.appendChild(infoBlock);
            
            // --- Table Section ---
            const section = document.createElement('section');
            section.className = 'tab-content';
            section.id = `tabContent-${team.id}`;
            section.innerHTML = `
                <div class="table-container">
                    <div class="table-toolbar">
                        <div class="selection-info" id="selectionInfo-${team.id}">선택된 항목 없음</div>
                    </div>
                    <table class="manual-table">
                        <thead>
                            <tr>
                                <th width="40"><input type="checkbox" class="select-all-cb" data-team="${team.id}"></th>
                                <th>매뉴얼 이름</th>
                                <th>첨부파일명</th>
                                <th>마지막 수정일(Notion)</th>
                                <th>동기화 상태</th>
                            </tr>
                        </thead>
                        <tbody id="manualList-${team.id}"></tbody>
                    </table>
                </div>
            `;
            dynamicTabContentsContainer.appendChild(section);
            
            // Populate Table Rows
            const tbody = document.getElementById(`manualList-${team.id}`);
            if (manuals.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">매뉴얼 항목이 없습니다.</td></tr>`;
            } else {
                manuals.forEach(m => {
                    const tr = document.createElement('tr');
                    
                    let statusClass = 'new';
                    if (m.status === '동기화 완료') statusClass = 'synced';
                    if (m.status === '업데이트 필요') statusClass = 'update-needed';
                    const badgeHtml = `<span class="status-badge ${statusClass}">${m.status}</span>`;
                    
                    const dateStr = m.lastEditedTime ? new Date(m.lastEditedTime).toLocaleString() : 'N/A';
                    const chunkInfo = m.chunks > 0 ? `<br><small style="color: var(--text-secondary); opacity: 0.8;">(${m.chunks}개 청크)</small>` : '';

                    tr.innerHTML = `
                        <td><input type="checkbox" class="manual-checkbox" data-team="${team.id}" data-id="${m.id}" data-title="${escapeHTML(m.title)}"></td>
                        <td style="font-weight: 600;">${escapeHTML(m.title)}</td>
                        <td>${escapeHTML(m.fileName)}</td>
                        <td>${dateStr}</td>
                        <td>${badgeHtml} ${chunkInfo}</td>
                    `;
                    tbody.appendChild(tr);
                });
            }
            
            // --- Config Form ---
            if (configFormsContainer) {
                const formBlock = document.createElement('div');
                formBlock.className = 'info-block';
                formBlock.style.border = '1px solid var(--glass-border)';
                formBlock.style.background = 'var(--bg-color)';
                const chatbotUrl = `${window.location.origin}/?team=${team.id}`;
                formBlock.innerHTML = `
                    <div class="block-header">
                        <h4>${escapeHTML(team.name)} 챗봇 설정</h4>
                        <span class="badge ${badgeClass}">team=${escapeHTML(team.id)}</span>
                    </div>
                    <div class="block-body" style="display: flex; flex-direction: column; gap: 10px;">
                        <div>
                            <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-secondary);">챗봇 표시 이름</label>
                            <input type="text" id="config-botName-${team.id}" class="config-input" data-team="${team.id}" value="${escapeHTML(team.botName || '')}" placeholder="예: 회계팀 AI 어시스턴트" style="width: 100%; padding: 8px; border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(0,0,0,0.1); color: var(--text-primary); margin-top: 4px;">
                        </div>
                        <div>
                            <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-secondary);">첫 안내 문구 (인사말)</label>
                            <textarea id="config-welcome-${team.id}" class="config-input" data-team="${team.id}" rows="2" placeholder="안녕하세요! 무엇을 도와드릴까요?" style="width: 100%; padding: 8px; border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(0,0,0,0.1); color: var(--text-primary); margin-top: 4px; resize: vertical;">${escapeHTML(team.welcomeMessage || '')}</textarea>
                        </div>
                        <div>
                            <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-secondary);">접속 비밀번호 (공란 시 비밀번호 없음)</label>
                            <input type="text" id="config-pwd-${team.id}" class="config-input" data-team="${team.id}" value="${escapeHTML(team.password || '')}" placeholder="비밀번호 입력" style="width: 100%; padding: 8px; border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(0,0,0,0.1); color: var(--text-primary); margin-top: 4px;">
                        </div>
                        <div style="margin-top: 5px;">
                            <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-secondary);">접속 URL</label>
                            <div style="display: flex; gap: 8px; margin-top: 4px;">
                                <input type="text" readonly value="${chatbotUrl}" style="flex: 1; padding: 8px; border: 1px solid var(--glass-border); border-radius: 6px; background: rgba(0,0,0,0.2); color: var(--text-secondary);">
                                <button onclick="navigator.clipboard.writeText('${chatbotUrl}').then(()=>alert('복사되었습니다!'))" style="padding: 0 15px; background: var(--bg-color); border: 1px solid var(--glass-border); color: var(--text-primary); border-radius: 6px; cursor: pointer;">복사</button>
                            </div>
                        </div>
                    </div>
                `;
                configFormsContainer.appendChild(formBlock);
            }
        });
        
        // Update Qdrant vectors count
        countQdrantVectors.textContent = `${data.qdrantPointsCount || 0} 개`;
        
        // Bind dynamic events
        bindTabEvents();
        bindCheckboxEvents();
        
        // Restore active tab
        switchTab(currentActiveTab);
    }

    function bindCheckboxEvents() {
        // Individual checkboxes
        const checkboxes = document.querySelectorAll('.manual-checkbox');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', (e) => {
                const tId = e.target.getAttribute('data-team');
                const pId = e.target.getAttribute('data-id');
                const key = `${tId}:${pId}`;
                if (e.target.checked) selectedManuals.add(key);
                else selectedManuals.delete(key);
                updateActionBarState();
            });
        });

        // Select All checkboxes
        const selectAllCbs = document.querySelectorAll('.select-all-cb');
        selectAllCbs.forEach(allCb => {
            allCb.addEventListener('change', (e) => {
                const tId = e.target.getAttribute('data-team');
                const isChecked = e.target.checked;
                const tbody = document.getElementById(`manualList-${tId}`);
                if (!tbody) return;
                
                const cbs = tbody.querySelectorAll('.manual-checkbox');
                cbs.forEach(cb => {
                    cb.checked = isChecked;
                    const pId = cb.getAttribute('data-id');
                    const key = `${tId}:${pId}`;
                    if (isChecked) selectedManuals.add(key);
                    else selectedManuals.delete(key);
                });
                updateActionBarState();
            });
        });
    }

    function clearSelections() {
        selectedManuals.clear();
        document.querySelectorAll('.select-all-cb').forEach(cb => cb.checked = false);
        document.querySelectorAll('.manual-checkbox').forEach(cb => cb.checked = false);
        updateActionBarState();
    }

    function updateActionBarState() {
        if (selectedManuals.size > 0) {
            actionBar.classList.remove('hidden');
            selectedCountText.textContent = `${selectedManuals.size}개 매뉴얼 선택됨`;
        } else {
            actionBar.classList.add('hidden');
        }
        
        // Update individual table selection texts
        teamsData.forEach(team => {
            const el = document.getElementById(`selectionInfo-${team.id}`);
            if (el) {
                const count = [...selectedManuals].filter(k => k.startsWith(`${team.id}:`)).length;
                el.textContent = count > 0 ? `${count}개 매뉴얼 선택됨` : '선택된 항목 없음';
            }
        });
    }

    // 5. Trigger Sync & Delete Callbacks
    btnSyncSelected.addEventListener('click', async () => {
        if (selectedManuals.size === 0) return;
        
        const listToSync = [];
        selectedManuals.forEach(key => {
            const [tId, pId] = key.split(':');
            const team = teamsData.find(t => t.id === tId);
            if (team) {
                const item = team.manuals.find(m => m.id === pId);
                if (item) {
                    listToSync.push({
                        id: pId,
                        title: item.title,
                        team: tId
                    });
                }
            }
        });

        addLog(`선택한 ${listToSync.length}개 매뉴얼 동기화를 시작합니다...`, 'process');
        actionBar.classList.add('hidden');
        
        try {
            btnSyncSelected.disabled = true;
            const response = await fetch(ADMIN_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync_manuals',
                    pages: listToSync
                })
            });

            if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${await response.text()}`);
            const res = await response.json();
            
            addLog(`동기화 처리 완료: ${res.message || '성공'}`, 'success');
            clearSelections();
            await refreshAllState();
        } catch (e) {
            addLog(`동기화 오류 발생: ${e.message}`, 'error');
        } finally {
            btnSyncSelected.disabled = false;
        }
    });

    btnDeleteSelected.addEventListener('click', async () => {
        if (selectedManuals.size === 0) return;
        
        const listToDelete = [];
        selectedManuals.forEach(key => {
            const [tId, pId] = key.split(':');
            listToDelete.push({ id: pId, team: tId });
        });

        if (!confirm(`선택한 ${listToDelete.length}개 매뉴얼의 벡터 데이터를 완전히 제거하시겠습니까?`)) {
            return;
        }

        addLog(`선택한 ${listToDelete.length}개 매뉴얼 삭제 시작...`, 'process');
        actionBar.classList.add('hidden');

        try {
            btnDeleteSelected.disabled = true;
            const response = await fetch(ADMIN_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'delete_manuals',
                    pages: listToDelete
                })
            });

            if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${await response.text()}`);
            const res = await response.json();
            addLog(`삭제 처리 완료: ${res.message || '성공'}`, 'success');
            clearSelections();
            await refreshAllState();
        } catch (e) {
            addLog(`삭제 오류 발생: ${e.message}`, 'error');
        } finally {
            btnDeleteSelected.disabled = false;
        }
    });

    const saveConfigBtn = document.getElementById('saveConfigBtn');
    if (saveConfigBtn) {
        saveConfigBtn.addEventListener('click', async () => {
            if (!confirm('모든 챗봇 설정을 저장하시겠습니까?')) return;
            
            const newConfig = { teams: {} };
            teamsData.forEach(team => {
                const botName = document.getElementById(`config-botName-${team.id}`)?.value || '';
                const welcomeMessage = document.getElementById(`config-welcome-${team.id}`)?.value || '';
                const password = document.getElementById(`config-pwd-${team.id}`)?.value || '';
                
                newConfig.teams[team.id] = { botName, welcomeMessage, password };
            });

            addLog('챗봇 설정 저장을 시작합니다...', 'process');
            try {
                saveConfigBtn.disabled = true;
                const response = await fetch(ADMIN_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'save_config',
                        config: newConfig
                    })
                });

                if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${await response.text()}`);
                const res = await response.json();
                addLog(`설정 저장 완료: ${res.message || '성공'}`, 'success');
                await refreshAllState();
            } catch (e) {
                addLog(`설정 저장 오류 발생: ${e.message}`, 'error');
            } finally {
                saveConfigBtn.disabled = false;
            }
        });
    }

    // Helper
    function escapeHTML(str) {
        if (!str) return '';
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
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAdmin);
} else {
    startAdmin();
}
