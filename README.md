# 💬 Live Chat Bot

A real-time live chat application with WebSockets, REST APIs, and MongoDB.

## Features
- 🔐 User Authentication (Register/Login with JWT)
- 💬 Real-time messaging via WebSockets (Socket.IO)
- 🌙 Dark Mode with animated toggle
- ➕ Start New Chat (multiple conversations)
- 📜 Message History stored in MongoDB
- 🖥️ Operator Console (reply from backend terminal)

## Tech Stack
- **Frontend:** React.js, Socket.IO Client, Axios
- **Backend:** Node.js, Express, Socket.IO
- **Database:** MongoDB + Mongoose
- **Auth:** JWT + bcrypt

## Setup Instructions

### Prerequisites
- Node.js installed
- MongoDB installed and running

### Backend Setup
cd backend
npm install
# Create .env file with:
# MONGODB_URI=mongodb://127.0.0.1:27017/livechatbot
# JWT_SECRET=your_secret_key
# PORT=5000
npm run dev


### Frontend Setup
cd frontend
npm install
npm start


### Usage
1. Open http://localhost:3000
2. Register an account
3. Start chatting
4. Reply from backend terminal using: @username your message