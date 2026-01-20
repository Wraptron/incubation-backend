import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import applicationsRouter from "./routes/applications";
import evaluationsRouter from "./routes/evaluations";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5001;
app.use(
  cors({
    origin: ["http://13.126.35.2:3000", "http://localhost:3000"],
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
  console.log(`📝 Health check: http://13.126.35.2:${PORT}/health`);
  console.log(`📋 Applications API: http://13.126.35.2:${PORT}/api/applications`);
});