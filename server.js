const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= DATABASE ANTI-CRASH =================
function loadData() {
  let data;
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error("File data.json rusak, membuat ulang...");
  }

  if (!data) data = {};

  // Pastikan semua array ada (Mencegah error 'push of undefined')
  if (!data.users) data.users = [];
  if (!data.teachers) data.teachers = [];
  if (!data.santri) data.santri = [];
  if (!data.attendance) data.attendance = [];
  if (!data.santri_attendance) data.santri_attendance = [];
  if (!data.proker) data.proker = [];

  // Paksa selalu ada admin
  let admin = data.users.find(u => u.username === 'admin');
  if (!admin) {
    data.users.push({ id: 'u1', username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator', teacherId: null });
  } else {
    admin.password = 'admin123'; // Reset password ke admin123
  }

  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
  return data;
}
const saveData = d => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); } catch(e) {} };
const sessions = {};

// ================= MIDDLEWARE =================
const auth = (req, res, next) => {
  const t = req.headers['authorization'];
  if (!t || !sessions[t]) return res.status(401).json({ error: 'Sesi berakhir, silakan login ulang.' });
  req.user = sessions[t];
  next();
};
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang bisa mengakses' });
  next();
};

// ================= AUTH =================
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const data = loadData();
    const user = data.users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Username atau password salah!' });
    
    const token = crypto.randomBytes(24).toString('hex');
    let teacherClass = null;
    if (user.teacherId) {
      const t = data.teachers.find(x => x.id === user.teacherId);
      if (t) teacherClass = t.class;
    }
    sessions[token] = { id: user.id, username: user.username, role: user.role, name: user.name, teacherId: user.teacherId, teacherClass };
    res.json({ token, user: sessions[token] });
  } catch (err) { res.status(500).json({ error: 'Server Error saat login' }); }
});

app.post('/api/logout', auth, (req, res) => { delete sessions[req.headers['authorization']]; res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(req.user));

app.put('/api/admin/credentials', auth, adminOnly, (req, res) => {
  try {
    const { newUsername, newPassword } = req.body;
    const data = loadData();
    const user = data.users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    if (newUsername && newUsername !== user.username) {
      if (data.users.find(u => u.username === newUsername)) return res.status(400).json({ error: 'Username sudah dipakai' });
      user.username = newUsername; req.user.username = newUsername;
    }
    if (newPassword) user.password = newPassword;
    saveData(data); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Gagal ganti kredensial' }); }
});

// ================= GURU =================
app.get('/api/teachers', auth, (req, res) => {
  try { res.json(loadData().teachers); } catch (err) { res.status(500).json({ error: 'Gagal load guru' }); }
});
app.post('/api/teachers', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); 
    const t = { id: 't' + Date.now(), name: req.body.name, class: req.body.class, isWaliKelas: !!req.body.isWaliKelas };
    data.teachers.push(t); saveData(data); res.json(t);
  } catch (err) { res.status(500).json({ error: 'Gagal menyimpan guru baru' }); }
});
app.delete('/api/teachers/:id', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); 
    data.teachers = data.teachers.filter(t => t.id !== req.params.id);
    data.attendance = data.attendance.filter(a => a.teacherId !== req.params.id); 
    data.users = data.users.filter(u => u.teacherId !== req.params.id);
    saveData(data); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Gagal hapus guru' }); }
});

// ================= USERS =================
app.get('/api/users', auth, adminOnly, (req, res) => {
  try {
    res.json(loadData().users.map(u => ({ id: u.id, username: u.username, name: u.name, role: u.role, teacherId: u.teacherId })));
  } catch (err) { res.status(500).json({ error: 'Gagal load akun' }); }
});
app.post('/api/users', auth, adminOnly, (req, res) => {
  try {
    const { username, password, name, teacherId, role } = req.body;
    const data = loadData();
    if (data.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username sudah dipakai' });
    const u = { id: 'u' + Date.now(), username, password, role: role || 'member', name, teacherId: teacherId || null };
    data.users.push(u); saveData(data); res.json(u);
  } catch (err) { res.status(500).json({ error: 'Gagal buat akun' }); }
});
app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); data.users = data.users.filter(u => u.id !== req.params.id);
    saveData(data); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Gagal hapus akun' }); }
});

// ================= PRESENSI GURU =================
app.get('/api/attendance', auth, (req, res) => {
  try {
    const data = loadData();
    if (req.user.role === 'member') return res.json(data.attendance.filter(a => a.teacherId === req.user.teacherId));
    res.json(data.attendance);
  } catch (err) { res.status(500).json({ error: 'Gagal load presensi' }); }
});
app.post('/api/attendance', auth, (req, res) => {
  try {
    const { teacherId, date, status, image } = req.body;
    const data = loadData();
    if (req.user.role === 'member' && req.user.teacherId !== teacherId) return res.status(403).json({ error: 'Hanya bisa absen sendiri' });
    
    let finalStatus = status;
    if (req.user.role === 'member' && status === 'tepat') {
      const wib = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
      if (wib.getHours() > 18 || (wib.getHours() === 18 && wib.getMinutes() > 0)) finalStatus = 'telat';
    }
    const ex = data.attendance.find(a => a.teacherId === teacherId && a.date === date);
    if (ex) { 
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin bisa edit' });
      ex.status = finalStatus; ex.by = req.user.name; if (image) ex.image = image;
    } else {
      data.attendance.push({ id: 'a' + Date.now(), teacherId, date, status: finalStatus, image: image || null, by: req.user.name });
    }
    saveData(data); res.json({ ok: true, status: finalStatus });
  } catch (err) { res.status(500).json({ error: 'Gagal simpan presensi' }); }
});
app.get('/api/rekap', auth, (req, res) => {
  try {
    const data = loadData(); const filtered = data.attendance.filter(a => a.date.startsWith(req.query.month || ''));
    let teachers = data.teachers;
    if (req.user.role === 'member') teachers = teachers.filter(t => t.id === req.user.teacherId);
    res.json(teachers.map(t => {
      const recs = filtered.filter(a => a.teacherId === t.id);
      return { id: t.id, name: t.name, class: t.class, tepatWaktu: recs.filter(r => r.status === 'tepat').length, telat: recs.filter(r => r.status === 'telat').length, ijin: recs.filter(r => r.status === 'ijin').length, sakit: recs.filter(r => r.status === 'sakit').length, tidakHadir: recs.filter(r => r.status === 'tidak').length, total: recs.length };
    }));
  } catch (err) { res.status(500).json({ error: 'Gagal load rekap guru' }); }
});

// ================= SANTRI =================
app.get('/api/santri', auth, (req, res) => {
  try {
    const data = loadData();
    if (req.user.role === 'admin') res.json(data.santri);
    else {
      const t = data.teachers.find(x => x.id === req.user.teacherId);
      res.json(t ? data.santri.filter(s => s.class === t.class) : []);
    }
  } catch (err) { res.status(500).json({ error: 'Gagal load santri' }); }
});
app.post('/api/santri', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); const s = { id: 's' + Date.now(), name: req.body.name, class: req.body.class };
    data.santri.push(s); saveData(data); res.json(s);
  } catch (err) { res.status(500).json({ error: 'Gagal simpan santri' }); }
});
app.delete('/api/santri/:id', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); data.santri = data.santri.filter(s => s.id !== req.params.id);
    data.santri_attendance = data.santri_attendance.filter(a => a.santriId !== req.params.id);
    saveData(data); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Gagal hapus santri' }); }
});
app.get('/api/santri_attendance', auth, (req, res) => {
  try {
    const data = loadData();
    if (req.user.role === 'admin') return res.json(data.santri_attendance);
    const t = data.teachers.find(x => x.id === req.user.teacherId);
    if (!t) return res.json([]);
    const ids = data.santri.filter(s => s.class === t.class).map(s => s.id);
    res.json(data.santri_attendance.filter(a => ids.includes(a.santriId)));
  } catch (err) { res.status(500).json({ error: 'Gagal load presensi santri' }); }
});
app.post('/api/santri_attendance/bulk', auth, (req, res) => {
  try {
    const { date, records } = req.body; const data = loadData();
    for (let rec of records) {
      const ex = data.santri_attendance.findIndex(a => a.santriId === rec.santriId && a.date === date);
      if (ex !== -1) {
        data.santri_attendance[ex].status = rec.status; data.santri_attendance[ex].note = rec.note || null; data.santri_attendance[ex].by = req.user.name;
      } else {
        data.santri_attendance.push({ id: 'sa' + Date.now() + Math.random().toString(36).substr(2, 5), santriId: rec.santriId, date, status: rec.status, note: rec.note || null, by: req.user.name });
      }
    }
    saveData(data); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Gagal simpan massal santri' }); }
});
app.get('/api/rekap_santri', auth, (req, res) => {
  try {
    const data = loadData(); const filtered = data.santri_attendance.filter(a => a.date.startsWith(req.query.month || ''));
    let list = data.santri;
    if (req.user.role === 'member') {
      const t = data.teachers.find(x => x.id === req.user.teacherId);
      if (t) list = list.filter(s => s.class === t.class); else list = [];
    }
    res.json(list.map(s => {
      const recs = filtered.filter(a => a.santriId === s.id);
      return { id: s.id, name: s.name, class: s.class, hadir: recs.filter(r => r.status === 'hadir').length, sakit: recs.filter(r => r.status === 'sakit').length, ijin: recs.filter(r => r.status === 'ijin').length, absen: recs.filter(r => r.status === 'absen').length, total: recs.length };
    }));
  } catch (err) { res.status(500).json({ error: 'Gagal load rekap santri' }); }
});

// ================= PROKER =================
app.get('/api/proker', auth, (req, res) => {
  try { res.json(loadData().proker); } catch (err) { res.status(500).json({ error: 'Gagal load proker' }); }
});
app.post('/api/proker', auth, (req, res) => {
  try {
    const data = loadData(); const p = { id: 'p' + Date.now(), name: req.body.name, status: req.body.status || 'tidak', day: req.body.day, date: req.body.date, creator: req.user.name };
    data.proker.push(p); saveData(data); res.json(p);
  } catch (err) { res.status(500).json({ error: 'Gagal simpan proker' }); }
});
app.put('/api/proker/:id', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); const p = data.proker.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (req.body.status) p.status = req.body.status; saveData(data); res.json(p);
  } catch (err) { res.status(500).json({ error: 'Gagal update proker' }); }
});
app.delete('/api/proker/:id', auth, adminOnly, (req, res) => {
  try {
    const data = loadData(); data.proker = data.proker.filter(p => p.id !== req.params.id); saveData(data); res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Gagal hapus proker' }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server jalan di port ${PORT}`));
