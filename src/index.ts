import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import applicationsRouter from "./routes/applications";
import evaluationsRouter from "./routes/evaluations";
import usersRouter from "./routes/users";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5001;

// CORS: allow local + prod frontend. Set FRONTEND_URL or CORS_ORIGINS in prod.
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, "http://localhost:3000"]
    : ["http://13.126.35.2:3000", "http://localhost:3000", "http://65.1.107.13:3000"];
app.use(cors({ origin: corsOrigins }));

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
  console.log(`📝 Health check: http://13.126.35.2:${PORT}/health`);
  console.log(`📋 Applications API: http://13.126.35.2:${PORT}/api/applications`);
  console.log(`👥 Users API: http://13.126.35.2:${PORT}/api/users`);
});