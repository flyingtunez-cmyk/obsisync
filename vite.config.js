import { defineConfig } from 'vite'

// адрес API: локально это 127.0.0.1:3000, в docker-compose — http://api:3000
const API = process.env.API_PROXY || 'http://127.0.0.1:3000'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // ws: true — через прокси ходит и WebSocket-канал /api/ws
      '/api': { target: API, ws: true },
      '/health': API,
      '/uploads': API
    }
  }
})
