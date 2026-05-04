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
    await client.query('BEGIN');
    
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
      CREATE TABLE IF NOT EXISTS missions (
        id          SERIAL PRIMARY KEY,
        name        TEXT    NOT NULL,
        goal        TEXT    NOT NULL,
        points      INTEGER NOT NULL,
        description TEXT,
        icon        TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id           SERIAL PRIMARY KEY,
        name         TEXT    NOT NULL UNIQUE,
        description  TEXT    NOT NULL,
        bonus_points INTEGER NOT NULL DEFAULT 0,
        icon         TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        user_id        INTEGER NOT NULL REFERENCES users(id),
        achievement_id INTEGER NOT NULL REFERENCES achievements(id),
        earned_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, achievement_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        mission_id  INTEGER REFERENCES missions(id),
        type        TEXT    NOT NULL CHECK(type IN ('지급','사용','쿠폰사용','업적보상')),
        amount      INTEGER NOT NULL,
        description TEXT,
        created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 기존 제약 조건 업데이트 및 컬럼 추가 (이미 존재할 경우 대비)
    try {
      await client.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id)");
      await client.query("ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check");
      await client.query("ALTER TABLE transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('지급', '사용', '쿠폰사용', '업적보상'))");
    } catch (e) {
      console.log("⚠️ Migration Notice:", e.message);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS coupons (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id),
        item_id      INTEGER NOT NULL REFERENCES items(id),
        item_name    TEXT    NOT NULL,
        item_price   INTEGER NOT NULL,
        purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        used_at      TIMESTAMP DEFAULT NULL,
        is_used      INTEGER NOT NULL DEFAULT 0
      )
    `);

    // ── Seed 데이터 ──
    const userRes = await client.query("SELECT COUNT(*) FROM users");
    if (parseInt(userRes.rows[0].count) === 0) {
      await client.query("INSERT INTO users (name, balance) VALUES ('관리자', 0)");
      await client.query("INSERT INTO users (name, balance) VALUES ('최병훈', 1000)");
    }

    const itemRes = await client.query("SELECT COUNT(*) FROM items");
    if (parseInt(itemRes.rows[0].count) === 0) {
      const items = [
        ['원하는 라면 1개 먹기', 300],
        ['원하는 과자 1봉지 먹기', 200],
        ['원하는 음료 1병 먹기', 150],
        ['마라탕 한그릇 먹기', 800],
        ['원하는 음식 하나 먹기', 1200]
      ];
      for (const [n, p] of items) await client.query("INSERT INTO items (name, price) VALUES ($1, $2)", [n, p]);
    }

    const missionRes = await client.query("SELECT COUNT(*) FROM missions");
    if (parseInt(missionRes.rows[0].count) === 0) {
      const missions = [
        ['[하체] 스쿼트', '30번', 50, '튼튼한 하체를 위한 필수 운동', 'activity'],
        ['[하체] 사이드 스텝', '30번', 50, '하체와 심폐지구력을 동시에!', 'move-horizontal'],
        ['[하체] 슬로우 버피', '15번', 30, '층간소음 걱정 없는 전신 운동', 'activity'],
        ['[상체/코어] 힙 브릿지', '30번', 50, '코어와 둔근 강화', 'dumbbell'],
        ['[상체/코어] 레그 레이즈', '30번', 60, '강력한 하복부 만들기', 'activity'],
        ['[유산소] 자전거', '10km당', 30, '시원한 바람을 가르며 라이딩', 'bike'],
        ['[유산소] 걷기', '30분당', 30, '가볍게 걸으며 건강 챙기기', 'footprints']
      ];
      for (const [n, g, p, d, i] of missions) 
        await client.query("INSERT INTO missions (name, goal, points, description, icon) VALUES ($1, $2, $3, $4, $5)", [n, g, p, d, i]);
    }

    const achiRes = await client.query("SELECT COUNT(*) FROM achievements");
    if (parseInt(achiRes.rows[0].count) === 0) {
      const achis = [
        ['첫 걸음', '생애 첫 미션을 완료했습니다.', 50, 'award'],
        ['미션왕', '등록된 모든 종류의 미션을 1회 이상 완료했습니다.', 500, 'trophy'],
        ['버피 테스트의 최고봉', '버피 테스트 미션을 10회 완료했습니다.', 300, 'mountain'],
        ['꾸준함의 상징', '미션을 누적 30회 완료했습니다.', 1000, 'calendar'],
        ['포인트 부자', '보유 포인트 5,000P를 달성했습니다.', 500, 'coins'],
        ['쇼핑 중독', '쿠폰을 10회 구매했습니다.', 200, 'shopping-cart'],
        ['새벽의 운동가', '오전 5시~9시 사이에 미션을 완료했습니다.', 150, 'sunrise'],
        ['강철 체력', '하루에 미션 5회를 완료했습니다.', 400, 'shield'],
        ['쿠폰 매니아', '쿠폰을 5회 사용했습니다.', 200, 'ticket']
      ];
      for (const [n, d, p, i] of achis)
        await client.query("INSERT INTO achievements (name, description, bonus_points, icon) VALUES ($1, $2, $3, $4)", [n, d, p, i]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ DB 초기화 중 오류 발생:', err);
  } finally {
    client.release();
  }
}

// ── 업적 체크 로직 ──
async function checkAchievements(client, userId) {
  const achis = await client.query("SELECT * FROM achievements");
  const earnedRes = await client.query("SELECT achievement_id FROM user_achievements WHERE user_id = $1", [userId]);
  const earnedIds = new Set(earnedRes.rows.map(r => r.achievement_id));

  // 통계 데이터 가져오기
  const user = (await client.query("SELECT balance FROM users WHERE id = $1", [userId])).rows[0];
  const txs = (await client.query("SELECT * FROM transactions WHERE user_id = $1", [userId])).rows;
  const couponsPurchased = (await client.query("SELECT COUNT(*) FROM coupons WHERE user_id = $1", [userId])).rows[0].count;
  const couponsUsed = (await client.query("SELECT COUNT(*) FROM coupons WHERE user_id = $1 AND is_used = 1", [userId])).rows[0].count;
  const missionTxs = txs.filter(t => t.mission_id !== null);
  const missionCount = missionTxs.length;
  
  const missionIdsRes = await client.query("SELECT id FROM missions");
  const allMissionIds = missionIdsRes.rows.map(r => r.id);
  const uniqueMissionsDone = new Set(missionTxs.map(t => t.mission_id));

  for (const achi of achis.rows) {
    if (earnedIds.has(achi.id)) continue;

    let earned = false;
    switch (achi.name) {
      case '첫 걸음': if (missionCount >= 1) earned = true; break;
      case '미션왕': if (allMissionIds.every(id => uniqueMissionsDone.has(id))) earned = true; break;
      case '버피 테스트의 최고봉': 
        const burpeeMission = (await client.query("SELECT id FROM missions WHERE name LIKE '%버피%'")).rows[0];
        if (burpeeMission && missionTxs.filter(t => t.mission_id === burpeeMission.id).length >= 10) earned = true;
        break;
      case '꾸준함의 상징': if (missionCount >= 30) earned = true; break;
      case '포인트 부자': if (user.balance >= 5000) earned = true; break;
      case '쇼핑 중독': if (parseInt(couponsPurchased) >= 10) earned = true; break;
      case '새벽의 운동가': 
        if (missionTxs.some(t => {
          const hour = new Date(t.created_at).getHours();
          return hour >= 5 && hour < 9;
        })) earned = true;
        break;
      case '강철 체력':
        const dates = missionTxs.map(t => new Date(t.created_at).toDateString());
        const dateCounts = {};
        dates.forEach(d => dateCounts[d] = (dateCounts[d] || 0) + 1);
        if (Object.values(dateCounts).some(c => c >= 5)) earned = true;
        break;
      case '쿠폰 매니아': if (parseInt(couponsUsed) >= 5) earned = true; break;
    }

    if (earned) {
      await client.query("INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1, $2)", [userId, achi.id]);
      if (achi.bonus_points > 0) {
        await client.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [achi.bonus_points, userId]);
        await client.query(
          "INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, '업적보상', $2, $3)",
          [userId, achi.bonus_points, `업적 달성 보상: ${achi.name}`]
        );
      }
    }
  }
}

// ── API 라우트 ──

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) res.json({ success: true });
  else res.status(401).json({ success: false, error: '비밀번호 오류' });
});

app.get('/api/users', async (req, res) => {
  const result = await pool.query('SELECT * FROM users ORDER BY id');
  res.json(result.rows);
});

app.get('/api/users/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [Number(req.params.id)]);
  res.json(result.rows[0]);
});

app.get('/api/items', async (req, res) => {
  const result = await pool.query('SELECT * FROM items ORDER BY id');
  res.json(result.rows);
});

app.get('/api/missions', async (req, res) => {
  const result = await pool.query('SELECT * FROM missions ORDER BY id');
  res.json(result.rows);
});

app.post('/api/admin/missions', async (req, res) => {
  const { name, goal, points, description, icon } = req.body;
  await pool.query("INSERT INTO missions (name, goal, points, description, icon) VALUES ($1, $2, $3, $4, $5)", [name, goal, points, description, icon]);
  res.json({ success: true });
});

app.delete('/api/admin/missions/:id', async (req, res) => {
  await pool.query("DELETE FROM missions WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.get('/api/achievements', async (req, res) => {
  const result = await pool.query('SELECT * FROM achievements ORDER BY id');
  res.json(result.rows);
});

app.get('/api/users/:id/achievements', async (req, res) => {
  const result = await pool.query(`
    SELECT a.*, (ua.user_id IS NOT NULL) as earned 
    FROM achievements a
    LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = $1
    ORDER BY a.id
  `, [req.params.id]);
  res.json(result.rows);
});

app.get('/api/users/:id/transactions', async (req, res) => {
  const result = await pool.query(
    'SELECT *, TO_CHAR(created_at, \'YYYY-MM-DD"T"HH24:MI:SS\') as created_at FROM transactions WHERE user_id = $1 ORDER BY id DESC',
    [req.params.id]
  );
  res.json(result.rows);
});

app.post('/api/grant', async (req, res) => {
  const { user_id, amount, description, mission_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amount, user_id]);
    await client.query(
      "INSERT INTO transactions (user_id, mission_id, type, amount, description) VALUES ($1, $2, '지급', $3, $4)",
      [user_id, mission_id || null, amount, description]
    );
    await checkAchievements(client, user_id);
    await client.query('COMMIT');
    const user = (await client.query('SELECT * FROM users WHERE id = $1', [user_id])).rows[0];
    res.json({ success: true, user });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/buy', async (req, res) => {
  const { user_id, item_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = (await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [user_id])).rows[0];
    const item = (await client.query('SELECT * FROM items WHERE id = $1', [item_id])).rows[0];
    if (user.balance < item.price) throw new Error('포인트 부족');
    await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [item.price, user_id]);
    await client.query("INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, '사용', $2, $3)", [user_id, -item.price, `${item.name} 구매`]);
    await client.query("INSERT INTO coupons (user_id, item_id, item_name, item_price) VALUES ($1, $2, $3, $4)", [user_id, item_id, item.name, item.price]);
    await checkAchievements(client, user_id);
    await client.query('COMMIT');
    const updated = (await client.query('SELECT * FROM users WHERE id = $1', [user_id])).rows[0];
    res.json({ success: true, user: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.get('/api/users/:id/coupons', async (req, res) => {
  const result = await pool.query('SELECT *, TO_CHAR(purchased_at, \'YYYY-MM-DD"T"HH24:MI:SS\') as purchased_at FROM coupons WHERE user_id = $1 AND is_used = 0 ORDER BY id DESC', [req.params.id]);
  res.json(result.rows);
});

app.post('/api/coupons/:id/use', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const coupon = (await client.query('SELECT * FROM coupons WHERE id = $1 AND is_used = 0 FOR UPDATE', [req.params.id])).rows[0];
    if (!coupon) throw new Error('쿠폰 없음');
    await client.query("UPDATE coupons SET is_used = 1, used_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    await client.query("INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, '쿠폰사용', 0, $2)", [coupon.user_id, `쿠폰 사용: ${coupon.item_name}`]);
    await checkAchievements(client, coupon.user_id);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

app.get('/api/admin/coupon-logs', async (req, res) => {
  const result = await pool.query(`
    SELECT c.*, u.name as user_name, TO_CHAR(c.purchased_at, 'YYYY-MM-DD"T"HH24:MI:SS') as purchased_at, TO_CHAR(c.used_at, 'YYYY-MM-DD"T"HH24:MI:SS') as used_at
    FROM coupons c JOIN users u ON c.user_id = u.id WHERE c.is_used = 1 ORDER BY c.used_at DESC
  `);
  res.json(result.rows);
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const userCount = (await pool.query("SELECT COUNT(*) FROM users")).rows[0].count;
    const totalBalance = (await pool.query("SELECT SUM(balance) FROM users")).rows[0].sum || 0;
    const totalIssued = (await pool.query("SELECT SUM(amount) FROM transactions WHERE amount > 0")).rows[0].sum || 0;
    const totalUsed = (await pool.query("SELECT ABS(SUM(amount)) FROM transactions WHERE amount < 0")).rows[0].sum || 0;
    
    // 최근 7일 추이
    const trends = await pool.query(`
      SELECT TO_CHAR(created_at, 'MM-DD') as date, 
             SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as issued,
             ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) as used
      FROM transactions
      WHERE created_at > CURRENT_DATE - INTERVAL '7 days'
      GROUP BY date ORDER BY date
    `);

    res.json({ userCount, totalBalance, totalIssued, totalUsed, trends: trends.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

initDatabase().then(() => {
  app.listen(PORT, () => console.log(`🚀 서버 실행: http://localhost:${PORT}`));
});
