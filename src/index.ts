import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import applicationsRouter, { expirePendingReviewerInvites } from "./routes/applications";
import evaluationsRouter from "./routes/evaluations";
import usersRouter from "./routes/users";

// Load environment-specific .env file
const env = process.env.NODE_ENV || "development";
const envFile = `.env.${env}`;
const envPath = path.resolve(process.cwd(), envFile);

// Try to load environment-specific file, fallback to .env
dotenv.config({ path: envPath });
dotenv.config(); // Fallback to .env if env-specific file doesn't exist

console.log(`🌍 Environment: ${env}`);
console.log(`📄 Loading env from: ${envPath}`);

const app = express();
const PORT = Number(process.env.PORT) || 5001;
// CORS configuration based on environment
const allowedOrigins =
  env === "production"
    ? [process.env.FRONTEND_URL || "http://13.126.35.2:3000"]
    : env === "staging"
    ? [
        process.env.FRONTEND_URL || "http://your-staging-frontend-url:3000",
        "http://localhost:3000",
      ]
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

app.use(
  cors({
    origin: allowedOrigins,
  })
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "Backend server is running" });
});

app.get("/api", (req: Request, res: Response) => {
  res.json({ message: "Welcome to the Incubation Screen API" });
});

app.use("/api/applications", applicationsRouter);
app.use("/api/evaluations", evaluationsRouter);
app.use("/api/users", usersRouter);

const host = env === "production" ? "0.0.0.0" : "0.0.0.0";
const baseUrl =
  env === "production"
    ? process.env.BACKEND_URL || `http://13.126.35.2:${PORT}`
    : env === "staging"
    ? process.env.BACKEND_URL || `http://your-staging-backend-url:${PORT}`
    : `http://localhost:${PORT}`;

// Run reviewer invite expiry on startup and every hour (pending invites older than 2 days → auto-rejected)
const REVIEWER_INVITE_EXPIRE_INTERVAL_MS = 60 * 60 * 1000;
expirePendingReviewerInvites().catch((err) =>
  console.warn("Startup reviewer invite expiry check failed:", err)
);
setInterval(() => {
  expirePendingReviewerInvites().catch((err) =>
    console.warn("Scheduled reviewer invite expiry failed:", err)
  );
}, REVIEWER_INVITE_EXPIRE_INTERVAL_MS);

app.listen(PORT, host, () => {
  console.log(`🚀 Server is running on http://${host}:${PORT}`);
  console.log(`🌍 Environment: ${env}`);
  console.log(`📝 Health check: ${baseUrl}/health`);
  console.log(`📋 Applications API: ${baseUrl}/api/applications`);
  console.log(`👥 Users API: ${baseUrl}/api/users`);
});