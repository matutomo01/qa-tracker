const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'tickets.json');

// ==========================================
// ミドルウェア設定 (Middleware)
// ==========================================
// 1. JSONボディのパース
app.use(express.json());

// 2. 静的ファイルの配信 (public/ 内のHTML/CSS/JS)
app.use(express.static(path.join(__dirname, '../public')));

// ==========================================
// データアクセス用ヘルパー関数
// ==========================================

// 【改善点②】ファイル読み込み: エラーを隠蔽せず、ファイル破損時に空配列で上書きしない
function loadTickets() {
  if (!fs.existsSync(DATA_FILE)) {
    // 初回のみ空配列ファイルを作成
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
    return [];
  }
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(data || '[]');

  if (!Array.isArray(parsed)) {
    throw new Error('Data format corrupted: tickets.json must contain an array.');
  }
  return parsed;
}

// 【改善点①】ファイル書き込み: 失敗判定を呼び出し元で検知できるようにする
function saveTickets(tickets) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save tickets file:', error);
    return false;
  }
}

// 共通エラーレスポンス生成
function sendError(res, statusCode, code, message, field = null) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      field
    }
  });
}

// ==========================================
// 業務ロジック定義（Azure Boardsの思想を反映）
// ==========================================
const ALLOWED_TRANSITIONS = {
  New: ['Active'],
  Active: ['Resolved'],
  Resolved: ['Closed', 'Active'],
  Closed: ['Active']
};

const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const VALID_SEVERITIES = ['Minor', 'Major', 'Critical', 'Blocker'];

// ==========================================
// RESTful API エンドポイント
// ==========================================

/**
 * 1. チケット一覧取得 (GET /api/tickets)
 */
app.get('/api/tickets', (req, res) => {
  try {
    const tickets = loadTickets();
    const { status } = req.query;

    if (status) {
      const filtered = tickets.filter(t => t.status === status);
      return res.status(200).json({ success: true, count: filtered.length, data: filtered });
    }

    res.status(200).json({ success: true, count: tickets.length, data: tickets });
  } catch (err) {
    console.error('GET /api/tickets error:', err);
    return sendError(res, 500, 'DATABASE_READ_ERROR', 'Failed to retrieve tickets from data store.');
  }
});

/**
 * 2. チケット詳細取得 (GET /api/tickets/:id)
 */
app.get('/api/tickets/:id', (req, res) => {
  try {
    const tickets = loadTickets();
    const ticket = tickets.find(t => t.id === req.params.id);

    if (!ticket) {
      return sendError(res, 404, 'TICKET_NOT_FOUND', `Ticket with id '${req.params.id}' was not found.`);
    }

    res.status(200).json({ success: true, data: ticket });
  } catch (err) {
    console.error('GET /api/tickets/:id error:', err);
    return sendError(res, 500, 'DATABASE_READ_ERROR', 'Failed to retrieve ticket details.');
  }
});

/**
 * 3. チケット新規作成 (POST /api/tickets)
 */
app.post('/api/tickets', (req, res) => {
  console.log('\n========================================');
  console.log('★ [POST /api/tickets] 画面から届いたデータ:');
  console.log(req.body);
  console.log('========================================\n');

  // リクエストボディのオブジェクト検証
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return sendError(res, 400, 'INVALID_BODY', 'Request body must be a valid JSON object.');
  }

  const { title, reproductionSteps, expectedResult, actualResult, priority, severity } = req.body;

  // バリデーション
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Title is required and must not be empty.', 'title');
  }
  if (title.length > 100) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Title must be 100 characters or less.', 'title');
  }
  if (!reproductionSteps || typeof reproductionSteps !== 'string' || reproductionSteps.trim() === '') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Reproduction steps are required and must be text.', 'reproductionSteps');
  }
  if (reproductionSteps.length > 2000) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Reproduction steps must be 2000 characters or less.', 'reproductionSteps');
  }
  if (!expectedResult || typeof expectedResult !== 'string' || expectedResult.trim() === '') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Expected result is required and must be text.', 'expectedResult');
  }
  if (expectedResult.length > 1000) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Expected result must be 1000 characters or less.', 'expectedResult');
  }
  if (!actualResult || typeof actualResult !== 'string' || actualResult.trim() === '') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Actual result is required and must be text.', 'actualResult');
  }
  if (actualResult.length > 1000) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Actual result must be 1000 characters or less.', 'actualResult');
  }

  const selectedPriority = priority || 'Medium';
  if (!VALID_PRIORITIES.includes(selectedPriority)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`, 'priority');
  }

  const selectedSeverity = severity || 'Major';
  if (!VALID_SEVERITIES.includes(selectedSeverity)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `Invalid severity. Must be one of: ${VALID_SEVERITIES.join(', ')}`, 'severity');
  }

  try {
    const tickets = loadTickets();
    const now = new Date().toISOString();
    const newTicket = {
      id: `t-${Date.now()}`,
      title: title.trim(),
      reproductionSteps: reproductionSteps.trim(),
      expectedResult: expectedResult.trim(),
      actualResult: actualResult.trim(),
      priority: selectedPriority,
      severity: selectedSeverity,
      status: 'New', // 初期ステータスは必ず New
      createdAt: now,
      updatedAt: now
    };

    tickets.unshift(newTicket);

    // 【改善点①】保存成否の厳格チェック
    if (!saveTickets(tickets)) {
      return sendError(res, 500, 'STORAGE_ERROR', 'Failed to persist ticket data to disk.');
    }

    res.status(201).json({ success: true, data: newTicket });
  } catch (err) {
    console.error('POST /api/tickets error:', err);
    return sendError(res, 500, 'DATABASE_WRITE_ERROR', 'Failed to process ticket creation.');
  }
});

/**
 * 4. チケットのステータス更新 (PATCH /api/tickets/:id/status)
 */
app.patch('/api/tickets/:id/status', (req, res) => {
  const { status: nextStatus } = req.body;

  if (!nextStatus || typeof nextStatus !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Status field is required and must be a string.', 'status');
  }

  try {
    const tickets = loadTickets();
    const ticketIndex = tickets.findIndex(t => t.id === req.params.id);

    if (ticketIndex === -1) {
      return sendError(res, 404, 'TICKET_NOT_FOUND', `Ticket with id '${req.params.id}' was not found.`);
    }

    const currentTicket = tickets[ticketIndex];
    const allowed = ALLOWED_TRANSITIONS[currentTicket.status] || [];

    // ステータス遷移ルールの検証
    if (!allowed.includes(nextStatus)) {
      return sendError(
        res,
        400,
        'INVALID_STATUS_TRANSITION',
        `Cannot transition status from '${currentTicket.status}' to '${nextStatus}'. Allowed: [${allowed.join(', ')}]`,
        'status'
      );
    }

    currentTicket.status = nextStatus;
    currentTicket.updatedAt = new Date().toISOString();
    tickets[ticketIndex] = currentTicket;

    // 【改善点①】保存成否の厳格チェック
    if (!saveTickets(tickets)) {
      return sendError(res, 500, 'STORAGE_ERROR', 'Failed to persist status update to disk.');
    }

    res.status(200).json({ success: true, data: currentTicket });
  } catch (err) {
    console.error('PATCH /api/tickets/:id/status error:', err);
    return sendError(res, 500, 'DATABASE_WRITE_ERROR', 'Failed to update ticket status.');
  }
});

/**
 * 5. チケット削除 (DELETE /api/tickets/:id)
 */
app.delete('/api/tickets/:id', (req, res) => {
  try {
    const tickets = loadTickets();
    const targetIndex = tickets.findIndex(t => t.id === req.params.id);

    if (targetIndex === -1) {
      return sendError(res, 404, 'TICKET_NOT_FOUND', `Ticket with id '${req.params.id}' was not found.`);
    }

    const deleted = tickets.splice(targetIndex, 1)[0];

    // 【改善点①】保存成否の厳格チェック
    if (!saveTickets(tickets)) {
      return sendError(res, 500, 'STORAGE_ERROR', 'Failed to persist ticket deletion to disk.');
    }

    res.status(200).json({ success: true, message: 'Ticket deleted successfully', data: deleted });
  } catch (err) {
    console.error('DELETE /api/tickets/:id error:', err);
    return sendError(res, 500, 'DATABASE_WRITE_ERROR', 'Failed to delete ticket.');
  }
});

// ==========================================
// サーバー起動
// ==========================================
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` QA Tracker API Server is running!`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` API Endpoint: http://localhost:${PORT}/api/tickets`);
  console.log(`=========================================`);
});
