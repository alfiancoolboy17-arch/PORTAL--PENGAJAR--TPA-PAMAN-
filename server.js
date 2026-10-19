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
        { username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator' }
      ],
      teachers: [],
      attendance: [],
      proker: []
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

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = loadData().users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { username: user.username, role: user.role, name: user.name, teacherId: user.teacherId };
  res.json({ token, user: sessions[token] });
});

app.post('/api/logout', auth, (req, res) => {
  delete sessions[req.headers['authorization']];
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

// --- GURU & USER ---
app.get('/api/teachers', auth, (req, res) => {
  const data = loadData();
  if (req.user.role === 'member') {
    // Member hanya bisa melihat datanya sendiri
    return res.json(data.teachers.filter(t => t.id === req.user.teacherId));
  }
  res.json(data.teachers);
});

app.post('/api/teachers', auth, adminOnly, (req, res) => {
  const { name, class: cls, username, password } = req.body;
  if (!name || !cls || !username || !password) return res.status(400).json({ error: 'Semua kolom wajib diisi' });
  
  const data = loadData();
  if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username sudah dipakai' });

  const teacherId = 't' + Date.now();
  data.teachers.push({ id: teacherId, name, class: cls });
  // Otomatis buatkan akun login untuk guru tersebut
  data.users.push({ username, password, role: 'member', name, teacherId });
  
  saveData(data);
  res.json({ ok: true });
});

app.delete('/api/teachers/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  const teacher = data.teachers.find(t => t.id === req.params.id);
  data.teachers = data.teachers.filter(t => t.id !== req.params.id);
  data.attendance = data.attendance.filter(a => a.teacherId !== req.params.id);
  if (teacher) {
    data.users = data.users.filter(u => u.name !== teacher.name || u.role !== 'member');
  }
  saveData(data);
  res.json({ ok: true });
});

// --- PRESENSI ---
app.get('/api/attendance', auth, (req, res) => {
  const data = loadData();
  if (req.user.role === 'member') {
    return res.json(data.attendance.filter(a => a.teacherId === req.user.teacherId));
  }
  res.json(data.attendance);
});

app.post('/api/attendance', auth, (req, res) => {
  const { teacherId, date, status } = req.body;
  const data = loadData();
  
  // Logika Jam 17:45 WIB
  let finalStatus = status;
  if (req.user.role === 'member') {
    const wibTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const now = new Date(wibTime);
    const hours = now.getHours();
    const minutes = now.getMinutes();
    
    // Jika lewat jam 17:45, paksa jadi 'telat'
    if (hours > 17 || (hours === 17 && minutes > 45)) {
      finalStatus = 'telat';
    } else {
      finalStatus = 'tepat';
    }
  }

  const timeStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const ex = data.attendance.find(a => a.teacherId === teacherId && a.date === date);
  
  if (ex) { 
    ex.status = finalStatus; 
    ex.time = timeStr;
    ex.by = req.user.name; 
  } else {
    data.attendance.push({ id: 'a' + Date.now(), teacherId, date, status: finalStatus, time: timeStr, by: req.user.name });
  }
  saveData(data);
  res.json({ ok: true, status: finalStatus });
});

app.delete('/api/attendance/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.attendance = data.attendance.filter(a => a.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

app.get('/api/rekap', auth, (req, res) => {
  const month = req.query.month || '';
  const data = loadData();
  const filtered = data.attendance.filter(a => a.date.startsWith(month));
  let teachers = data.teachers;
  if (req.user.role === 'member') teachers = teachers.filter(t => t.id === req.user.teacherId);

  res.json(teachers.map(t => {
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

// --- PROKER ---
app.get('/api/proker', auth, (req, res) => res.json(loadData().proker));

app.post('/api/proker', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = { id: 'p' + Date.now(), name: req.body.name, day: req.body.day, date: req.body.date, status: req.body.status || 'tidak' };
  data.proker.push(p);
  saveData(data);
  res.json(p);
});

app.put('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = data.proker.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (req.body.name)   p.name   = req.body.name;
  if (req.body.day)    p.day    = req.body.day;
  if (req.body.date)   p.date   = req.body.date;
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

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Jalan di port ${PORT}`));
