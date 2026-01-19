import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import applicationsRouter from "./routes/applications";
import evaluationsRouter from "./routes/evaluations";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) ||5001;

// Middleware
// Restrict CORS to known frontend origins
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://65.1.107.13:5001/",
    ],
    credentials: true, // If you need to send cookies
  }),
);
// Increase body size limit to 50MB to handle file uploads (base64 encoded)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", message: "Backend server is running" });
});

// API routes
app.get("/api", (req: Request, res: Response) => {
  res.json({ message: "Welcome to the Incubation Screen API" });
});

// Applications routes
app.use("/api/applications", applicationsRouter);

// Evaluations routes
app.use("/api/evaluations", evaluationsRouter);

// Start server - BIND TO 0.0.0.0 to accept connections from any IP
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`🌐 Network access: http://13.126.35.2:${PORT}/health`);
  console.log(`📋 Applications API: http://localhost:${PORT}/api/applications`);
});
