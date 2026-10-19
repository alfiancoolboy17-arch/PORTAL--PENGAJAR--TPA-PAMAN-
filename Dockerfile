# Gunakan image Node.js LTS yang ringan
FROM node:lts-alpine

# Set direktori kerja
WORKDIR /app

# Salin file package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Instal dependensi
RUN npm install

# Salin sisa kode aplikasi
COPY . .

# Hugging Face Spaces mengharuskan aplikasi berjalan di port 7860
ENV PORT=7860
EXPOSE 7860

# Jalankan server
CMD ["node", "server.js"]
