require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('@neondatabase/serverless');

const app = express();
const PORT = process.env.PORT || 3000;

// ── 관리자 비밀번호 ──
const ADMIN_PASSWORD = 'ytg357900';

// ── PostgreSQL 연결 설정 ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ── 미들웨어 ──
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function initDatabase() {
  console.log('📡 데이터베이스 연결 시도 중...');
  const client = await pool.connect();
  console.log('✅ 데이터베이스 연결 성공!');
  try {
    // 테이블 생성
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id      SERIAL PRIMARY KEY,
        name    TEXT    NOT NULL UNIQUE,
        balance INTEGER NOT NULL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id    SERIAL PRIMARY KEY,
        name  TEXT    NOT NULL,
        price INTEGER NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL,
        type        TEXT    NOT NULL CHECK(type IN ('지급','사용')),
        amount      INTEGER NOT NULL,
        description TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL,
        item_id      INTEGER NOT NULL,
        item_name    TEXT    NOT NULL,
        item_price   INTEGER NOT NULL,
        purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        used_at      TIMESTAMP DEFAULT NULL,
        is_used      INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT fk_user_coupon FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_item_coupon FOREIGN KEY (item_id) REFERENCES items(id)
      )
    `);

    // ── Seed 데이터 ──
    const userRes = await client.query("SELECT COUNT(*) FROM users");
    if (parseInt(userRes.rows[0].count) === 0) {
      await client.query("INSERT INTO users (name, balance) VALUES ('관리자', 0)");
      await client.query("INSERT INTO users (name, balance) VALUES ('최병훈', 1000)");
      console.log('✅ 기본 유저 2명이 생성되었습니다.');
    }

    const itemRes = await client.query("SELECT COUNT(*) FROM items");
    if (parseInt(itemRes.rows[0].count) === 0) {
      await client.query("INSERT INTO items (name, price) VALUES ('원하는 라면 1개 먹기', 300)");
      await client.query("INSERT INTO items (name, price) VALUES ('원하는 과자 1봉지 먹기', 200)");
      await client.query("INSERT INTO items (name, price) VALUES ('원하는 음료 1병 먹기', 150)");
      await client.query("INSERT INTO items (name, price) VALUES ('마라탕 한그릇 먹기', 800)");
      await client.query("INSERT INTO items (name, price) VALUES ('원하는 음식 하나 먹기', 1200)");
      console.log('✅ 신규 상품 5개가 생성되었습니다.');
    }
  } catch (err) {
    console.error('❌ DB 초기화 중 오류 발생:', err);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════
//  API 라우트
// ═══════════════════════════════════════

// ── 관리자 비밀번호 검증 ──
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
  }
});

// 유저 목록 조회
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 상품 목록 조회
app.get('/api/items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 특정 유저 조회
app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [Number(req.params.id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 특정 유저의 거래 내역 조회
app.get('/api/users/:id/transactions', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT *, TO_CHAR(created_at, \'YYYY-MM-DD"T"HH24:MI:SS\') as created_at FROM transactions WHERE user_id = $1 ORDER BY id DESC',
      [Number(req.params.id)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 포인트 지급 (관리자) ──
app.post('/api/grant', async (req, res) => {
  const { user_id, amount, description } = req.body;

  if (!user_id || !amount || amount === 0) {
    return res.status(400).json({ error: '유효하지 않은 요청입니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user_id]);
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    }

    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);
    await client.query(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, '지급', $2, $3)",
      [user_id, amount, description || (amount > 0 ? '관리자 포인트 지급' : '관리자 포인트 차감')]
    );

    await client.query('COMMIT');

    const updatedUser = await client.query('SELECT * FROM users WHERE id = $1', [user_id]);
    res.json({ success: true, user: updatedUser.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── 상품 구매 → 쿠폰함에 쌓임 ──
app.post('/api/buy', async (req, res) => {
  const { user_id, item_id } = req.body;

  if (!user_id || !item_id) {
    return res.status(400).json({ error: '유효하지 않은 요청입니다.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user_id]);
    if (userRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    }
    const user = userRes.rows[0];

    const itemRes = await client.query('SELECT * FROM items WHERE id = $1', [item_id]);
    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
    }
    const item = itemRes.rows[0];

    if (user.balance < item.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `포인트가 부족합니다. (잔액: ${user.balance}P, 필요: ${item.price}P)`
      });
    }

    // 포인트 차감
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [item.price, user_id]);

    // 거래 내역 기록 (구매이므로 마이너스 금액)
    await client.query(
      "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, '사용', $2, $3)",
      [user_id, -item.price, `${item.name} 구매`]
    );

    // 쿠폰 발급
    await client.query(
      "INSERT INTO coupons (user_id, item_id, item_name, item_price) VALUES ($1, $2, $3, $4)",
      [user_id, item_id, item.name, item.price]
    );

    await client.query('COMMIT');

    const updatedUser = await client.query('SELECT * FROM users WHERE id = $1', [user_id]);
    res.json({ success: true, user: updatedUser.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── 내 쿠폰함 조회 (미사용 쿠폰만) ──
app.get('/api/users/:id/coupons', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT *, TO_CHAR(purchased_at, \'YYYY-MM-DD"T"HH24:MI:SS\') as purchased_at FROM coupons WHERE user_id = $1 AND is_used = 0 ORDER BY id DESC',
      [Number(req.params.id)]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 쿠폰 사용하기 ──
app.post('/api/coupons/:id/use', async (req, res) => {
  const couponId = Number(req.params.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query('SELECT * FROM coupons WHERE id = $1 AND is_used = 0 FOR UPDATE', [couponId]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '쿠폰을 찾을 수 없거나 이미 사용되었습니다.' });
    }
    const coupon = result.rows[0];

    // 쿠폰을 사용 처리
    await client.query(
      "UPDATE coupons SET is_used = 1, used_at = CURRENT_TIMESTAMP WHERE id = $1",
      [couponId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: `${coupon.item_name} 쿠폰이 사용되었습니다.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── 쿠폰 사용 로그 (관리자 전용) ──
app.get('/api/admin/coupon-logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.item_name, c.item_price, 
             TO_CHAR(c.purchased_at, 'YYYY-MM-DD"T"HH24:MI:SS') as purchased_at, 
             TO_CHAR(c.used_at, 'YYYY-MM-DD"T"HH24:MI:SS') as used_at, 
             u.name as user_name
      FROM coupons c
      JOIN users u ON c.user_id = u.id
      WHERE c.is_used = 1
      ORDER BY c.used_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 서버 시작 ──
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 포인트 시스템 서버 실행: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('❌ DB 초기화 실패:', err);
  process.exit(1);
});
