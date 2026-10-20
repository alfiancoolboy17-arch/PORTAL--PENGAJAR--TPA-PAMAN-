const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      users: [
        // Admin tidak terikat ke guru tertentu (teacherId: null)
        { id: 'u1', username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator', teacherId: null },
        { id: 'u2', username: 'guru', password: 'guru123', role: 'member', name: 'Guru TPA', teacherId: 't1' }
      ],
      teachers: [
        { id: 't1', name: 'Ustadz Ahmad Fauzi', class: 'A' },
        { id: 't2', name: 'Ustadzah Fatimah', class: 'B' },
        { id: 't3', name: 'Ustadz Yusuf Habibi', class: 'C' }
      ],
      attendance: [],
      proker: [
        { id: 'p1', name: 'Kajian Rutin Mingguan', status: 'terlaksana', day: 'Minggu', date: '2026-10-25' }
      ]
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
const saveData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));

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
  sessions[token] = { id: user.id, username: user.username, role: user.role, name: user.name, teacherId: user.teacherId };
  res.json({ token, user: sessions[token] });
});
app.post('/api/logout', auth, (req, res) => { delete sessions[req.headers['authorization']]; res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.user));

/* ============ GURU ============ */
app.get('/api/teachers', auth, (req, res) => res.json(loadData().teachers));
app.post('/api/teachers', auth, adminOnly, (req, res) => {
  const { name, class: cls } = req.body;
  const data = loadData();
  const t = { id: 't' + Date.now(), name, class: cls };
  data.teachers.push(t); saveData(data); res.json(t);
});
app.delete('/api/teachers/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.teachers = data.teachers.filter(t => t.id !== req.params.id);
  data.attendance = data.attendance.filter(a => a.teacherId !== req.params.id);
  data.users = data.users.filter(u => u.teacherId !== req.params.id);
  saveData(data); res.json({ ok: true });
});

/* ============ USERS / MEMBERS ============ */
app.get('/api/users', auth, adminOnly, (req, res) => {
  const data = loadData();
  res.json(data.users.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, teacherId: u.teacherId })));
});
app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, name, teacherId } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Data tidak lengkap' });
  const data = loadData();
  if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username sudah dipakai' });
  const u = { id: 'u' + Date.now(), username, password, role: 'member', name, teacherId: teacherId || null };
  data.users.push(u); saveData(data); res.json(u);
});
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.users = data.users.filter(u => u.id !== req.params.id);
  saveData(data); res.json({ ok: true });
});

/* ============ PRESENSI ============ */
app.get('/api/attendance', auth, (req, res) => {
  const data = loadData();
  // Jika member, hanya kembalikan presensi miliknya sendiri
  if (req.user.role === 'member') {
    return res.json(data.attendance.filter(a => a.teacherId === req.user.teacherId));
  }
  res.json(data.attendance);
});

app.post('/api/attendance', auth, (req, res) => {
  const { teacherId, date } = req.body;
  const data = loadData();
  
  // Cek Otorisasi: Member hanya bisa absen untuk dirinya sendiri
  if (req.user.role === 'member' && req.user.teacherId !== teacherId) {
    return res.status(403).json({ error: 'Anda hanya bisa absen untuk diri sendiri' });
  }

  // Logika Waktu: Tepat waktu maksimal jam 17:45 WIB
  const now = new Date();
  const wibTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
  const hours = wibTime.getHours();
  const minutes = wibTime.getMinutes();
  let status = req.body.status;

  // Jika admin yang input manual, ikuti pilihan admin. Jika member yang absen, cek waktu.
  if (req.user.role === 'member' && status === 'tepat') {
    if (hours > 17 || (hours === 17 && minutes > 45)) {
      status = 'telat';
    }
  }

  const ex = data.attendance.find(a => a.teacherId === teacherId && a.date === date);
  if (ex) { 
    // Hanya admin yang bisa mengedit data yang sudah ada
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang bisa mengedit' });
    ex.status = status; ex.by = req.user.name; 
  } else {
    data.attendance.push({ id: 'a' + Date.now(), teacherId, date, status, by: req.user.name });
  }
  saveData(data); res.json({ ok: true, status });
});

/* ============ REKAP BULANAN ============ */
app.get('/api/rekap', auth, (req, res) => {
  const month = req.query.month || '';
  const data = loadData();
  const filtered = data.attendance.filter(a => a.date.startsWith(month));
  
  let teachers = data.teachers;
  if (req.user.role === 'member') {
    teachers = teachers.filter(t => t.id === req.user.teacherId);
  }

  res.json(teachers.map(t => {
    const recs = filtered.filter(a => a.teacherId === t.id);
    return {
      id: t.id, name: t.name, class: t.class,
      tepatWaktu: recs.filter(r => r.status === 'tepat').length,
      telat: recs.filter(r => r.status === 'telat').length,
      tidakHadir: recs.filter(r => r.status === 'tidak').length,
      total: recs.length
    };
  }));
});

/* ============ PROKER ============ */
app.get('/api/proker', auth, (req, res) => res.json(loadData().proker));
app.post('/api/proker', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = { id: 'p' + Date.now(), name: req.body.name, status: req.body.status || 'tidak', day: req.body.day, date: req.body.date };
  data.proker.push(p); saveData(data); res.json(p);
});
app.put('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = data.proker.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (req.body.name) p.name = req.body.name;
  if (req.body.status) p.status = req.body.status;
  if (req.body.day) p.day = req.body.day;
  if (req.body.date) p.date = req.body.date;
  saveData(data); res.json(p);
});
app.delete('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.proker = data.proker.filter(p => p.id !== req.params.id);
  saveData(data); res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Portal TPA PAMAN jalan di port ${PORT}`));
