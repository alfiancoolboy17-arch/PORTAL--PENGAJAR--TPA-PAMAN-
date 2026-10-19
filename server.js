const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

/* ============ DATA STORE ============ */
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      users: [
        { username: 'admin', password: 'admin123', role: 'admin',  name: 'Administrator' },
        { username: 'guru',  password: 'guru123',  role: 'member', name: 'Guru TPA' }
      ],
      teachers: [
        { id: 't1', name: 'Ustadz Ahmad Fauzi',  class: 'A' },
        { id: 't2', name: 'Ustadzah Fatimah',    class: 'B' },
        { id: 't3', name: 'Ustadz Yusuf Habibi', class: 'C' }
      ],
      attendance: [],
      proker: [
        { id: 'p1', name: 'Kajian Rutin Mingguan',  status: 'terlaksana' },
        { id: 'p2', name: 'Lomba Tahfidz Ramadhan', status: 'terlaksana' },
        { id: 'p3', name: 'Bakti Sosial Santri',    status: 'tidak' }
      ]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
const saveData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));

/* ============ APP SETUP ============ */
const sessions = {};
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  const t = req.headers['authorization'];
  if (!t || !sessions[t]) return res.status(401).json({ error: 'Unauthorized' });
  req.user = sessions[t];
  next();
};
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang bisa' });
  next();
};

/* ============ AUTH ============ */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = loadData().users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { username: user.username, role: user.role, name: user.name };
  res.json({ token, user: sessions[token] });
});

app.post('/api/logout', auth, (req, res) => {
  delete sessions[req.headers['authorization']];
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

/* ============ GURU ============ */
app.get('/api/teachers', auth, (req, res) => res.json(loadData().teachers));

app.post('/api/teachers', auth, adminOnly, (req, res) => {
  const { name, class: cls } = req.body;
  if (!name || !cls) return res.status(400).json({ error: 'Nama & kelas wajib diisi' });
  const data = loadData();
  const t = { id: 't' + Date.now(), name, class: cls };
  data.teachers.push(t);
  saveData(data);
  res.json(t);
});

app.delete('/api/teachers/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.teachers = data.teachers.filter(t => t.id !== req.params.id);
  data.attendance = data.attendance.filter(a => a.teacherId !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

/* ============ PRESENSI ============ */
app.get('/api/attendance', auth, (req, res) => res.json(loadData().attendance));

app.post('/api/attendance', auth, (req, res) => {
  const { teacherId, date, status } = req.body;
  const data = loadData();
  const ex = data.attendance.find(a => a.teacherId === teacherId && a.date === date);
  if (ex) { ex.status = status; ex.by = req.user.name; }
  else data.attendance.push({ id: 'a' + Date.now(), teacherId, date, status, by: req.user.name });
  saveData(data);
  res.json({ ok: true });
});

/* ============ REKAP BULANAN ============ */
app.get('/api/rekap', auth, (req, res) => {
  const month = req.query.month || '';
  const data = loadData();
  const filtered = data.attendance.filter(a => a.date.startsWith(month));
  res.json(data.teachers.map(t => {
    const recs = filtered.filter(a => a.teacherId === t.id);
    return {
      id: t.id, name: t.name, class: t.class,
      tepatWaktu: recs.filter(r => r.status === 'tepat').length,
      telat:      recs.filter(r => r.status === 'telat').length,
      tidakHadir: recs.filter(r => r.status === 'tidak').length,
      total:      recs.length
    };
  }));
});

/* ============ PROKER ============ */
app.get('/api/proker', auth, (req, res) => res.json(loadData().proker));

app.post('/api/proker', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = { id: 'p' + Date.now(), name: req.body.name, status: req.body.status || 'tidak' };
  data.proker.push(p);
  saveData(data);
  res.json(p);
});

app.put('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = data.proker.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (req.body.name)   p.name   = req.body.name;
  if (req.body.status) p.status = req.body.status;
  saveData(data);
  res.json(p);
});

app.delete('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.proker = data.proker.filter(p => p.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

/* ============ HEALTH ============ */
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () =>
  console.log(`✅ Portal TPA PAMAN jalan di http://localhost:${PORT}`)
);
