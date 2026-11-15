/**
 * QA Tracker - Client Application
 * SDET Portfolio: REST API Integration & Secure Dynamic State Management
 * 
 * [Refactored based on Code Review]
 * - XSS Prevention: Eliminated inline onclick handlers, implemented Event Delegation
 * - Defensive Programming: Validates API response data types (Array.isArray)
 * - Async Accuracy: Synchronized refresh notification with Promise resolution
 * - Dynamic Error Reporting: Displays actual HTTP status & error codes
 */

// ステータス遷移定義（バックエンドの状態遷移マトリクスと一致）
const ALLOWED_TRANSITIONS = {
  New: [
    { target: 'Active', label: '▶ 調査・改修開始', class: 'btn-to-active' }
  ],
  Active: [
    { target: 'Resolved', label: '✔ 改修完了 (QA待ち)', class: 'btn-to-resolved' }
  ],
  Resolved: [
    { target: 'Closed', label: '✔ クローズ (完了)', class: 'btn-to-closed' },
    { target: 'Active', label: '↩ 差し戻し', class: 'btn-to-active' }
  ],
  Closed: [
    { target: 'Active', label: '🔄 再オープン', class: 'btn-to-active' }
  ]
};

// アプリケーション状態
let state = {
  tickets: [],
  currentFilter: 'all'
};

// DOM要素
const ticketForm = document.getElementById('ticket-form');
const ticketsContainer = document.getElementById('tickets-container');
const btnRefresh = document.getElementById('btn-refresh');
const titleInput = document.getElementById('ticket-title');
const titleCounter = document.getElementById('title-counter');

// ==========================================
// 初期化 (Initialization)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadTickets();
});

function setupEventListeners() {
  // タイトル文字数カウンター
  titleInput.addEventListener('input', (e) => {
    const len = e.target.value.length;
    titleCounter.textContent = `${len} / 100`;
    titleCounter.style.color = len >= 100 ? '#ef4444' : '#94a3b8';
  });

  // チケット起票フォーム送信 (POST)
  ticketForm.addEventListener('submit', handleCreateTicket);

  // 【改善点②】一覧更新ボタン: await で完了を待ち、成功時のみ通知 & 二重打鍵防止
  btnRefresh.addEventListener('click', async () => {
    btnRefresh.disabled = true;
    btnRefresh.textContent = '更新中...';
    try {
      const ok = await loadTickets();
      if (ok) {
        showToast('チケット一覧を最新に更新しました', 'success');
      }
    } finally {
      btnRefresh.disabled = false;
      btnRefresh.textContent = '🔄 更新';
    }
  });

  // フィルタータブ切り替え
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.dataset.filter;
      renderTickets();
    });
  });

  // メトリクスバークリックによるフィルター連動
  document.querySelectorAll('.metric-card').forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      state.currentFilter = filter;
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      renderTickets();
    });
  });

  // 【改善点①】XSS対策: インラインonclickを廃止し、イベント委譲 (Event Delegation) で処理
  ticketsContainer.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;

    const action = actionBtn.dataset.action;
    const ticketId = actionBtn.dataset.id;

    if (action === 'update-status') {
      const nextStatus = actionBtn.dataset.target;
      if (ticketId && nextStatus) {
        updateTicketStatus(ticketId, nextStatus);
      }
    } else if (action === 'delete') {
      if (ticketId) {
        deleteTicket(ticketId);
      }
    }
  });
}

// ==========================================
// API 通信処理 (Fetch API)
// ==========================================

// 1. チケット一覧取得 (GET /api/tickets)
// 【改善点⑤】APIレスポンスの形式を厳密に検証 (Array.isArray)
async function loadTickets() {
  try {
    const res = await fetch('/api/tickets');
    const json = await res.json();

    if (!res.ok || !json.success) {
      const errCode = json.error?.code || `HTTP_${res.status}`;
      throw new Error(`[${errCode}] ${json.error?.message || 'チケットの取得に失敗しました'}`);
    }

    // データの形式検証
    if (!Array.isArray(json.data)) {
      throw new Error('サーバーから不正なデータ形式（非配列）が返却されました');
    }

    state.tickets = json.data;
    updateMetrics();
    renderTickets();
    return true;
  } catch (err) {
    console.error('API Error:', err);
    showToast(`取得エラー: ${err.message}`, 'error');
    ticketsContainer.innerHTML = `<div class="empty-state">⚠️ データの取得に失敗しました。サーバーが起動しているか確認してください。</div>`;
    return false;
  }
}

// 2. チケット新規作成 (POST /api/tickets)
async function handleCreateTicket(e) {
  e.preventDefault();

  // 【改善点④】クライアント側での厳格な入力チェック
  const title = document.getElementById('ticket-title').value.trim();
  const reproductionSteps = document.getElementById('ticket-steps').value.trim();
  const expectedResult = document.getElementById('ticket-expected').value.trim();
  const actualResult = document.getElementById('ticket-actual').value.trim();

  if (!title || !reproductionSteps || !expectedResult || !actualResult) {
    showToast('空白のみの入力は許可されていません。すべての必須項目を入力してください。', 'error');
    return;
  }

  if (title.length > 100) {
    showToast('タイトルは100文字以内で入力してください。', 'error');
    return;
  }

  const payload = {
    title,
    priority: document.getElementById('ticket-priority').value,
    severity: document.getElementById('ticket-severity').value,
    reproductionSteps,
    expectedResult,
    actualResult
  };

  const submitBtn = document.getElementById('btn-submit');
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = '送信中...';

  try {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      // 【改善点③】動的なステータスコードとエラーコードの表示
      const code = json.error?.code || `HTTP_${res.status}`;
      throw new Error(`[${code}] ${json.error?.message || '起票に失敗しました'}`);
    }

    showToast(`チケット [${json.data.id}] を起票しました！ (201 Created)`, 'success');
    ticketForm.reset();
    titleCounter.textContent = '0 / 100';

    // 一覧に追加して再描画
    state.tickets.unshift(json.data);
    updateMetrics();
    renderTickets();
  } catch (err) {
    showToast(`起票エラー: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').textContent = 'チケットを起票する (POST /api/tickets)';
  }
}

// 3. ステータス更新 (PATCH /api/tickets/:id/status)
async function updateTicketStatus(id, nextStatus) {
  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      // 【改善点③】動的エラーコード表示
      const code = json.error?.code || `HTTP_${res.status}`;
      throw new Error(`[${code}] ${json.error?.message || '更新に失敗しました'}`);
    }

    showToast(`ステータスを '${nextStatus}' に更新しました (200 OK)`, 'success');

    // ローカル状態を更新
    const idx = state.tickets.findIndex(t => t.id === id);
    if (idx !== -1) {
      state.tickets[idx] = json.data;
      updateMetrics();
      renderTickets();
    }
  } catch (err) {
    showToast(`更新拒否: ${err.message}`, 'error');
  }
}

// 4. チケット削除 (DELETE /api/tickets/:id)
async function deleteTicket(id) {
  if (!confirm(`チケット [${id}] を削除しますか？`)) {
    return;
  }

  try {
    const res = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      const code = json.error?.code || `HTTP_${res.status}`;
      throw new Error(`[${code}] ${json.error?.message || '削除に失敗しました'}`);
    }

    showToast(`チケット [${id}] を削除しました`, 'success');
    state.tickets = state.tickets.filter(t => t.id !== id);
    updateMetrics();
    renderTickets();
  } catch (err) {
    showToast(`削除エラー: ${err.message}`, 'error');
  }
}

// ==========================================
// レンダリング (UI Rendering)
// ==========================================

function updateMetrics() {
  const total = state.tickets.length;
  const countNew = state.tickets.filter(t => t.status === 'New').length;
  const countActive = state.tickets.filter(t => t.status === 'Active').length;
  const countResolved = state.tickets.filter(t => t.status === 'Resolved').length;
  const countClosed = state.tickets.filter(t => t.status === 'Closed').length;

  document.getElementById('count-all').textContent = total;
  document.getElementById('count-new').textContent = countNew;
  document.getElementById('count-active').textContent = countActive;
  document.getElementById('count-resolved').textContent = countResolved;
  document.getElementById('count-closed').textContent = countClosed;
}

function renderTickets() {
  const filter = state.currentFilter;
  const filtered = filter === 'all' 
    ? state.tickets 
    : state.tickets.filter(t => t.status === filter);

  if (filtered.length === 0) {
    ticketsContainer.innerHTML = `
      <div class="empty-state">
        <p>該当するチケットはありません (${filter === 'all' ? '0件' : escapeHtml(filter)})</p>
      </div>
    `;
    return;
  }

  ticketsContainer.innerHTML = filtered.map(t => createTicketCardHtml(t)).join('');
}

// 【改善点①】インラインonclickを一切使わず、data属性を付与してイベント委譲で安全に処理
function createTicketCardHtml(ticket) {
  const safeId = escapeHtml(ticket.id);
  const safeStatus = escapeHtml(ticket.status);
  const safePriority = escapeHtml(ticket.priority);
  const safeSeverity = escapeHtml(ticket.severity);

  const actions = ALLOWED_TRANSITIONS[ticket.status] || [];
  const actionButtonsHtml = actions.map(act => `
    <button class="btn-action ${escapeHtml(act.class)}" 
            data-action="update-status" 
            data-id="${safeId}" 
            data-target="${escapeHtml(act.target)}">
      ${escapeHtml(act.label)}
    </button>
  `).join('');

  return `
    <div class="ticket-card" id="card-${safeId}">
      <div class="ticket-card-header">
        <div class="ticket-meta">
          <span class="ticket-id">${safeId}</span>
          <span class="badge badge-status-${safeStatus}">${safeStatus}</span>
          <span class="badge badge-priority-${safePriority}">優先度: ${safePriority}</span>
          <span class="badge badge-severity-${safeSeverity}">重大度: ${safeSeverity}</span>
        </div>
        <button class="btn-delete" data-action="delete" data-id="${safeId}" title="チケットを削除">🗑️ 削除</button>
      </div>

      <h3 class="ticket-title">${escapeHtml(ticket.title)}</h3>

      <div class="ticket-details">
        <div class="detail-item">
          <strong>再現手順:</strong>
          <pre>${escapeHtml(ticket.reproductionSteps)}</pre>
        </div>
        <div class="detail-item">
          <strong>期待される結果:</strong>
          <pre>${escapeHtml(ticket.expectedResult)}</pre>
        </div>
        <div class="detail-item">
          <strong>実際の結果:</strong>
          <pre>${escapeHtml(ticket.actualResult)}</pre>
        </div>
      </div>

      <div class="ticket-card-footer">
        <div class="action-buttons">
          <span style="font-size: 11px; color: #64748b; margin-right: 4px;">ステータス変更:</span>
          ${actionButtonsHtml.length > 0 ? actionButtonsHtml : '<span style="font-size: 12px; color: #94a3b8;">遷移可能なし</span>'}
        </div>
        <span style="font-size: 11px; color: #94a3b8;">起票: ${formatDate(ticket.createdAt)}</span>
      </div>
    </div>
  `;
}

// ==========================================
// ユーティリティ
// ==========================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '-';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}
