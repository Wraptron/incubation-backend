# Backend API Server

Node.js backend server for the Incubation Screen application.

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **TypeScript** - Type safety
- **CORS** - Cross-origin resource sharing
- **Supabase** - Database and backend services

## Prerequisites

- Node.js 18+ installed
- npm or yarn package manager

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```

   The server will start on `http://localhost:5000` (or the PORT specified in .env)

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server (requires build first)

## Project Structure

```
backend/
├── src/
│   ├── index.ts          # Main server file
│   ├── routes/
│   │   └── applications.ts  # Applications API routes
│   └── lib/
│       └── supabase.ts   # Supabase client configuration
├── dist/                 # Compiled JavaScript (generated)
├── .env.example          # Environment variables template
├── tsconfig.json         # TypeScript configuration
├── nodemon.json          # Nodemon configuration
└── package.json          # Dependencies and scripts
```

## API Endpoints

### General
- `GET /health` - Health check endpoint
- `GET /api` - API welcome message

### Applications
- `POST /api/applications` - Submit a new startup application
- `GET /api/applications` - List all applications (with optional query params: `status`, `limit`, `offset`)
- `GET /api/applications/:id` - Get a single application by ID

## Development

The server uses `nodemon` for automatic restart on file changes during development.

## Production

1. Build the project:
   ```bash
   npm run build
   ```

2. Start the server:
   ```bash
   npm start
   ```
