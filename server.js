const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '15mb' })); 
app.use(express.urlencoded({ limit: '15mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= SISTEM DATABASE ANTI-HILANG =================
function loadData() {
  let data;
  if (!fs.existsSync(DATA_FILE)) {
    // Jika file tidak ada (misal habis restart di Railway), buat baru
    data = {
      users: [],
      teachers: [],
      santri: [],
      attendance: [],
      santri_attendance: [],
      proker: []
    };
  } else {
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      // Jika file rusak, buat ulang
      data = { users: [], teachers: [], santri: [], attendance: [], santri_attendance: [], proker: [] };
    }
  }

  // PAKSA SELALU ADA ADMIN (Jika lupa password, otomatis jadi admin123 saat restart)
  let admin = data.users.find(u => u.username === 'admin');
  if (!admin) {
    data.users.push({ id: 'u1', username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator', teacherId: null });
  } else {
    // Fitur Darurat: Reset password admin ke admin123 setiap server nyala
    admin.password = 'admin123';
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return data;
}
const saveData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));

const sessions = {};

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

/* ============ AUTH & PROFIL ============ */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = loadData();
  const user = data.users.find(u => u.username === username && u.password === password);
  
  if (!user) return res.status(401).json({ error: 'Username atau password salah' });
  
  const token = crypto.randomBytes(24).toString('hex');
  let teacherClass = null;
  if (user.teacherId) {
    const t = data.teachers.find(x => x.id === user.teacherId);
    if (t) teacherClass = t.class;
  }

  sessions[token] = { id: user.id, username: user.username, role: user.role, name: user.name, teacherId: user.teacherId, teacherClass };
  res.json({ token, user: sessions[token] });
});
app.post('/api/logout', auth, (req, res) => { delete sessions[req.headers['authorization']]; res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.user));

app.put('/api/admin/credentials', auth, adminOnly, (req, res) => {
  const { newUsername, newPassword } = req.body;
  const data = loadData();
  const user = data.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (newUsername && newUsername !== user.username) {
    if (data.users.find(u => u.username === newUsername)) return res.status(400).json({ error: 'Username sudah dipakai' });
    user.username = newUsername;
    req.user.username = newUsername;
  }
  if (newPassword) user.password = newPassword;
  saveData(data);
  res.json({ ok: true });
});

/* ============ GURU & MEMBER ============ */
app.get('/api/teachers', auth, (req, res) => res.json(loadData().teachers));
app.post('/api/teachers', auth, adminOnly, (req, res) => {
  const { name, class: cls, isWaliKelas } = req.body;
  const data = loadData();
  const t = { id: 't' + Date.now(), name, class: cls, isWaliKelas: !!isWaliKelas };
  data.teachers.push(t); saveData(data); res.json(t);
});
app.delete('/api/teachers/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.teachers = data.teachers.filter(t => t.id !== req.params.id);
  data.attendance = data.attendance.filter(a => a.teacherId !== req.params.id);
  data.users = data.users.filter(u => u.teacherId !== req.params.id);
  saveData(data); res.json({ ok: true });
});

app.get('/api/users', auth, adminOnly, (req, res) => {
  const data = loadData();
  res.json(data.users.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, teacherId: u.teacherId })));
});
app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, name, teacherId, role } = req.body;
  const data = loadData();
  if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username sudah dipakai' });
  const u = { id: 'u' + Date.now(), username, password, role: role || 'member', name, teacherId: teacherId || null };
  data.users.push(u); saveData(data); res.json(u);
});
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.users = data.users.filter(u => u.id !== req.params.id);
  saveData(data); res.json({ ok: true });
});

/* ============ PRESENSI GURU ============ */
app.get('/api/attendance', auth, (req, res) => {
  const data = loadData();
  if (req.user.role === 'member') {
    return res.json(data.attendance.filter(a => a.teacherId === req.user.teacherId));
  }
  res.json(data.attendance);
});

app.post('/api/attendance', auth, (req, res) => {
  const { teacherId, date, status, image } = req.body;
  const data = loadData();
  
  if (req.user.role === 'member' && req.user.teacherId !== teacherId) {
    return res.status(403).json({ error: 'Hanya bisa absen untuk diri sendiri' });
  }

  let finalStatus = status;
  if (req.user.role === 'member' && status === 'tepat') {
    const now = new Date();
    const wibTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
    if (wibTime.getHours() > 18 || (wibTime.getHours() === 18 && wibTime.getMinutes() > 0)) {
      finalStatus = 'telat';
    }
  }

  const ex = data.attendance.find(a => a.teacherId === teacherId && a.date === date);
  if (ex) { 
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang bisa mengedit data yang sudah ada' });
    ex.status = finalStatus; ex.by = req.user.name; 
    if (image) ex.image = image;
  } else {
    data.attendance.push({ id: 'a' + Date.now(), teacherId, date, status: finalStatus, image: image || null, by: req.user.name });
  }
  saveData(data); res.json({ ok: true, status: finalStatus });
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
      telat: recs.filter(r => r.status === 'telat').length,
      ijin: recs.filter(r => r.status === 'ijin').length,
      sakit: recs.filter(r => r.status === 'sakit').length,
      tidakHadir: recs.filter(r => r.status === 'tidak').length,
      total: recs.length
    };
  }));
});

/* ============ SANTRI ============ */
app.get('/api/santri', auth, (req, res) => {
  const data = loadData();
  if (req.user.role === 'admin') {
    res.json(data.santri);
  } else {
    const teacher = data.teachers.find(t => t.id === req.user.teacherId);
    if (!teacher) return res.json([]);
    res.json(data.santri.filter(s => s.class === teacher.class));
  }
});

app.post('/api/santri', auth, adminOnly, (req, res) => {
  const { name, class: cls } = req.body;
  const data = loadData();
  const s = { id: 's' + Date.now(), name, class: cls };
  data.santri.push(s); saveData(data); res.json(s);
});

app.delete('/api/santri/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.santri = data.santri.filter(s => s.id !== req.params.id);
  data.santri_attendance = data.santri_attendance.filter(a => a.santriId !== req.params.id);
  saveData(data); res.json({ ok: true });
});

app.get('/api/santri_attendance', auth, (req, res) => {
  const data = loadData();
  if (req.user.role === 'admin') return res.json(data.santri_attendance);
  const teacher = data.teachers.find(t => t.id === req.user.teacherId);
  if (!teacher) return res.json([]);
  const mySantriIds = data.santri.filter(s => s.class === teacher.class).map(s => s.id);
  res.json(data.santri_attendance.filter(a => mySantriIds.includes(a.santriId)));
});

app.post('/api/santri_attendance/bulk', auth, (req, res) => {
  const { date, records } = req.body; 
  const data = loadData();
  
  for (let rec of records) {
    const exIndex = data.santri_attendance.findIndex(a => a.santriId === rec.santriId && a.date === date);
    if (exIndex !== -1) {
      data.santri_attendance[exIndex].status = rec.status;
      data.santri_attendance[exIndex].note = rec.note || null;
      data.santri_attendance[exIndex].by = req.user.name;
    } else {
      data.santri_attendance.push({ 
        id: 'sa' + Date.now() + Math.random().toString(36).substr(2, 5), 
        santriId: rec.santriId, date, status: rec.status, note: rec.note || null, by: req.user.name 
      });
    }
  }
  saveData(data); res.json({ ok: true });
});

app.get('/api/rekap_santri', auth, (req, res) => {
  const month = req.query.month || '';
  const data = loadData();
  const filtered = data.santri_attendance.filter(a => a.date.startsWith(month));
  let santriList = data.santri;
  if (req.user.role === 'member') {
    const teacher = data.teachers.find(t => t.id === req.user.teacherId);
    if (teacher) santriList = santriList.filter(s => s.class === teacher.class);
    else santriList = [];
  }
  res.json(santriList.map(s => {
    const recs = filtered.filter(a => a.santriId === s.id);
    return {
      id: s.id, name: s.name, class: s.class,
      hadir: recs.filter(r => r.status === 'hadir').length,
      sakit: recs.filter(r => r.status === 'sakit').length,
      ijin: recs.filter(r => r.status === 'ijin').length,
      absen: recs.filter(r => r.status === 'absen').length,
      total: recs.length
    };
  }));
});

/* ============ PROKER ============ */
app.get('/api/proker', auth, (req, res) => res.json(loadData().proker));
app.post('/api/proker', auth, (req, res) => {
  const data = loadData();
  const p = { id: 'p' + Date.now(), name: req.body.name, status: req.body.status || 'tidak', day: req.body.day, date: req.body.date, creator: req.user.name };
  data.proker.push(p); saveData(data); res.json(p);
});
app.put('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  const p = data.proker.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (req.body.status) p.status = req.body.status;
  saveData(data); res.json(p);
});
app.delete('/api/proker/:id', auth, adminOnly, (req, res) => {
  const data = loadData();
  data.proker = data.proker.filter(p => p.id !== req.params.id);
  saveData(data); res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Portal TPA PAMAN jalan di port ${PORT}`));
