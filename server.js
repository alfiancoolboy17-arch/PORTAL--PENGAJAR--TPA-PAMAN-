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

function loadData() {
  let data;
  if (!fs.existsSync(DATA_FILE)) {
    data = { users: [], teachers: [], santri: [], attendance: [], santri_attendance: [], proker: [] };
  } else {
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } 
    catch (e) { data = { users: [], teachers: [], santri: [], attendance: [], santri_attendance: [], proker: [] }; }
  }
  // Paksa selalu ada admin
  let admin = data.users.find(u => u.username === 'admin');
  if (!admin) {
    data.users.push({ id: 'u1', username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator', teacherId: null });
  } else {
    admin.password = 'admin123'; // Reset password ke admin123
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  return data;
}

const saveData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
const sessions = {};

// LOGIN SEDERHANA
app.post('/api/login', (req, res) => {
  console.log("Menerima request login:", req.body);
  const { username, password } = req.body;
  const data = loadData();
  const user = data.users.find(u => u.username === username && u.password === password);
  
  if (!user) {
    return res.status(401).json({ error: 'Username atau password salah!' });
  }
  
  const token = crypto.randomBytes(24).toString('hex');
  sessions[token] = { id: user.id, username: user.username, role: user.role, name: user.name };
  res.json({ token, user: sessions[token] });
});

app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server jalan di port ${PORT}`));
