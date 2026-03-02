import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// Log every request to this router (so we can confirm backend is hit)
router.use((req, _res, next) => {
  console.log(`[Backend] Evaluations request: ${req.method} ${req.originalUrl || req.url}`);
  next();
});

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Send a consistent error response */
function sendError(
  res: Response,
  status: number,
  error: string,
  details?: string,
  code?: string
) {
  const payload: { error: string; details?: string; code?: string } = {
    error,
  };
  if (details) payload.details = details;
  if (code) payload.code = code;
  return res.status(status).json(payload);
}

/** Safely get error message from unknown error */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred";
}

// GET /api/evaluations/application/:applicationId - Get evaluation for a specific application by current reviewer
router.get(
  "/application/:applicationId",
  async (req: Request, res: Response) => {
    try {
      // Log the request at the start
      console.log("=== Evaluation GET Request ===");
      console.log("URL:", req.url);
      console.log("Method:", req.method);
      console.log("Params:", req.params);
      console.log("Headers:", {
        "x-reviewer-id": req.headers["x-reviewer-id"],
      });

      const { applicationId } = req.params;

      // Validate applicationId
      if (
        !applicationId ||
        applicationId === "undefined" ||
        applicationId === "" ||
        !uuidRegex.test(applicationId)
      ) {
        console.error("Invalid applicationId:", applicationId);
        return sendError(res, 400, "Invalid application ID", "Application ID must be a valid UUID");
      }

      // Validate reviewerId from headers
      const reviewerIdHeader = req.headers["x-reviewer-id"];
      const reviewerId =
        typeof reviewerIdHeader === "string" ? reviewerIdHeader.trim() : null;

      if (
        !reviewerId ||
        reviewerId === "undefined" ||
        reviewerId === "" ||
        !uuidRegex.test(reviewerId)
      ) {
        console.error("Invalid reviewer ID:", reviewerIdHeader);
        return sendError(res, 401, "Reviewer ID is required", "x-reviewer-id header is missing or invalid");
      }

      console.log(
        "Validated IDs - Application:",
        applicationId,
        "Reviewer:",
        reviewerId
      );

      const { data: evaluation, error } = await supabase
        .from("application_evaluations")
        .select("*")
        .eq("application_id", applicationId)
        .eq("reviewer_id", reviewerId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // No evaluation found yet
          return res.json({ evaluation: null });
        }
        return sendError(res, 500, "Failed to fetch evaluation", error.message, error.code);
      }

      // Fetch reviewer information separately
      let reviewer = null;
      if (evaluation && evaluation.reviewer_id) {
        const { data: reviewerData } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .eq("id", evaluation.reviewer_id)
          .single();
        
        if (reviewerData) {
          reviewer = reviewerData;
        }
      }

      const data = evaluation ? { ...evaluation, reviewer } : null;

      return res.json({ evaluation: data });
    } catch (error: unknown) {
      console.error("Error fetching evaluation:", error);
      return sendError(res, 500, "Failed to fetch evaluation", getErrorMessage(error));
    }
  }
);

// GET /api/evaluations/application/:applicationId/all - Get all evaluations for an application (managers only)
router.get(
  "/application/:applicationId/all",
  async (req: Request, res: Response) => {
    try {
      const { applicationId } = req.params;

      // Validate applicationId
      if (
        !applicationId ||
        applicationId === "undefined" ||
        !uuidRegex.test(applicationId)
      ) {
        return sendError(res, 400, "Invalid application ID", "Application ID must be a valid UUID");
      }

      console.log("Fetching all evaluations for application:", applicationId);

      const { data: evaluations, error } = await supabase
        .from("application_evaluations")
        .select("*")
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Supabase error fetching evaluations:", error);
        return sendError(res, 500, "Failed to fetch evaluations", error.message, error.code);
      }

      // Fetch reviewer information for all evaluations
      let enrichedEvaluations = evaluations || [];
      if (enrichedEvaluations.length > 0) {
        const reviewerIds = [
          ...new Set(enrichedEvaluations.map((e: any) => e.reviewer_id)),
        ];

        const { data: reviewerData } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", reviewerIds);

        // Create a map of reviewer_id to reviewer info
        const reviewersMap: Record<string, { id: string; full_name: string | null }> = {};
        if (reviewerData) {
          reviewerData.forEach((reviewer) => {
            reviewersMap[reviewer.id] = {
              id: reviewer.id,
              full_name: reviewer.full_name,
            };
          });
        }

        // Enrich evaluations with reviewer information
        enrichedEvaluations = enrichedEvaluations.map((evaluation: any) => ({
          ...evaluation,
          reviewer: reviewersMap[evaluation.reviewer_id] || null,
        }));
      }

      console.log(`Found ${enrichedEvaluations.length} evaluations`);
      return res.json({ evaluations: enrichedEvaluations });
    } catch (error: unknown) {
      console.error("Error fetching evaluations:", error);
      return sendError(res, 500, "Failed to fetch evaluations", getErrorMessage(error));
    }
  }
);

// POST /api/evaluations - Create a new evaluation
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Validate request body
    if (!body || typeof body !== "object") {
      return sendError(
        res,
        400,
        "Invalid request body",
        "Request body must be a JSON object"
      );
    }

    // Try multiple header formats (Express normalizes headers)
    const reviewerId =
      (req.headers["x-reviewer-id"] as string) ||
      (req.headers["X-Reviewer-Id"] as string) ||
      (req.headers["X-REVIEWER-ID"] as string);

    if (!reviewerId || reviewerId === "undefined") {
      return sendError(
        res,
        401,
        "Reviewer ID is required",
        "x-reviewer-id header is missing or invalid"
      );
    }

    if (!uuidRegex.test(reviewerId)) {
      return sendError(res, 401, "Invalid reviewer ID", "x-reviewer-id must be a valid UUID");
    }

    // Validate applicationId
    const applicationId = body.applicationId;
    if (!applicationId || !uuidRegex.test(applicationId)) {
      return sendError(
        res,
        400,
        "Invalid application ID",
        "applicationId must be a valid UUID"
      );
    }

    // Validate required fields
    const requiredFields = [
      "applicationId",
      "needScore",
      "noveltyScore",
      "feasibilityScalabilityScore",
      "marketPotentialScore",
      "impactScore",
    ];

    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null) {
        return sendError(res, 400, `Missing required field: ${field}`);
      }
      if (field !== "applicationId" && String(body[field]).trim() === "") {
        return sendError(res, 400, `Score field cannot be empty: ${field}`);
      }
    }

    // Validate scores are between 0 and 10 (allow decimals)
    const scores = [
      body.needScore,
      body.noveltyScore,
      body.feasibilityScalabilityScore,
      body.marketPotentialScore,
      body.impactScore,
    ];

    for (const score of scores) {
      const numScore = typeof score === "string" ? parseFloat(score) : Number(score);
      if (isNaN(numScore) || numScore < 0 || numScore > 10) {
        return sendError(res, 400, "All scores must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
      }
      const scoreStr = String(score);
      const decimalParts = scoreStr.split(".");
      if (decimalParts.length === 2 && decimalParts[1].length > 2) {
        return sendError(res, 400, "Scores can have at most 2 decimal places");
      }
    }

    // Check if reviewer is assigned to this application and has accepted
    const { data: assignment, error: assignmentError } = await supabase
      .from("application_reviewers")
      .select("id, invite_status")
      .eq("application_id", body.applicationId)
      .eq("reviewer_id", reviewerId)
      .maybeSingle();

    if (assignmentError) {
      console.error("Error checking reviewer assignment:", assignmentError);
      return sendError(
        res,
        500,
        "Failed to verify reviewer assignment",
        assignmentError.message,
        assignmentError.code
      );
    }

    if (!assignment) {
      return sendError(
        res,
        403,
        "You are not assigned to review this application"
      );
    }

    const inviteStatus = assignment.invite_status ?? "pending";
    if (inviteStatus !== "accepted") {
      return sendError(
        res,
        403,
        inviteStatus === "rejected"
          ? "You have declined this assignment"
          : "Please accept the reviewer assignment before submitting an evaluation"
      );
    }

    // Parse scores as decimals (no rounding). Use original string when possible so decimals (e.g. 9.44) are never lost.
    const parseScore = (score: string | number): number => {
      const num = typeof score === "string" ? parseFloat(score) : Number(score);
      return num;
    };
    const scoreForDb = (score: string | number): string => {
      if (typeof score === "string" && score.trim() !== "") {
        const n = parseFloat(score);
        if (!isNaN(n)) return score.trim();
      }
      const n = parseScore(score);
      return n % 1 === 0 ? `${n}.0` : String(n);
    };

    // Insert evaluation (scores as strings so Postgres stores decimals, not integers)
    const { data, error } = await supabase
      .from("application_evaluations")
      .insert({
        application_id: body.applicationId,
        reviewer_id: reviewerId,
        need_score: scoreForDb(body.needScore),
        novelty_score: scoreForDb(body.noveltyScore),
        feasibility_scalability_score: scoreForDb(
          body.feasibilityScalabilityScore
        ),
        market_potential_score: scoreForDb(body.marketPotentialScore),
        impact_score: scoreForDb(body.impactScore),
        need_comment: body.needComment ?? null,
        novelty_comment: body.noveltyComment ?? null,
        feasibility_scalability_comment:
          body.feasibilityScalabilityComment ?? null,
        market_potential_comment: body.marketPotentialComment ?? null,
        impact_comment: body.impactComment ?? null,
        overall_comment: body.overallComment ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating evaluation:", error);
      if (error.code === "23505") {
        return sendError(
          res,
          409,
          "Evaluation already exists for this application. Use PUT to update it."
        );
      }
      if (error.code === "23503") {
        const isApplicationFk =
          error.message?.includes("application_evaluations_application_id_fkey");
        return sendError(
          res,
          400,
          isApplicationFk
            ? "Application not found for evaluation"
            : "Invalid application or reviewer",
          isApplicationFk
            ? "Application ID does not exist in the applications table. If applications are stored in new_application, run migration 20240101000013."
            : "Application or reviewer may not exist"
        );
      }
      if (error.code === "22P02" || error.message?.includes("integer")) {
        return sendError(
          res,
          500,
          "Failed to create evaluation",
          "Database schema may not support decimal scores. Run migrations 20240101000012 and 20240101000015 so scores are stored as decimals (values are not rounded to integers)."
        );
      }
      return sendError(
        res,
        500,
        "Failed to create evaluation",
        error.message,
        error.code
      );
    }

    return res.status(201).json({
      message: "Evaluation created successfully",
      evaluation: data,
    });
  } catch (error: unknown) {
    console.error("Error creating evaluation:", error);
    return sendError(
      res,
      500,
      "Failed to create evaluation",
      getErrorMessage(error)
    );
  }
});

// PUT /api/evaluations/:id - Update an existing evaluation
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const reviewerIdHeader = req.headers["x-reviewer-id"];
    const reviewerId =
      typeof reviewerIdHeader === "string" ? reviewerIdHeader.trim() : null;

    if (
      !reviewerId ||
      reviewerId === "undefined" ||
      reviewerId === "" ||
      !uuidRegex.test(reviewerId)
    ) {
      return sendError(
        res,
        401,
        "Reviewer ID is required",
        "x-reviewer-id header is missing or invalid"
      );
    }

    if (!id || !uuidRegex.test(id)) {
      return sendError(res, 400, "Invalid evaluation ID", "Evaluation ID must be a valid UUID");
    }

    // Check if evaluation exists and belongs to this reviewer
    const { data: existingEvaluation, error: fetchError } = await supabase
      .from("application_evaluations")
      .select("*")
      .eq("id", id)
      .eq("reviewer_id", reviewerId)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return sendError(
          res,
          404,
          "Evaluation not found",
          "Evaluation not found or you don't have permission to update it"
        );
      }
      return sendError(
        res,
        500,
        "Failed to fetch evaluation",
        fetchError.message,
        fetchError.code
      );
    }

    if (!existingEvaluation) {
      return sendError(
        res,
        404,
        "Evaluation not found",
        "Evaluation not found or you don't have permission to update it"
      );
    }

    // Parse scores as decimals (no rounding). Use original string when possible so decimals (e.g. 9.44) are never lost.
    const parseScore = (score: string | number): number => {
      const num = typeof score === "string" ? parseFloat(score) : Number(score);
      return num;
    };
    const scoreForDb = (score: string | number): string => {
      if (typeof score === "string" && score.trim() !== "") {
        const n = parseFloat(score);
        if (!isNaN(n)) return score.trim();
      }
      const n = parseScore(score);
      return n % 1 === 0 ? `${n}.0` : String(n);
    };
    const validateScore = (score: string | number, _fieldName: string): number | null => {
      const numScore = typeof score === "string" ? parseFloat(score) : Number(score);
      if (isNaN(numScore) || numScore < 0 || numScore > 10) {
        return null;
      }
      const scoreStr = String(score);
      const decimalParts = scoreStr.split(".");
      if (decimalParts.length === 2 && decimalParts[1].length > 2) {
        return null;
      }
      return parseScore(score);
    };

    // Build update object (scores as strings so Postgres stores decimals)
    const updateData: any = {};

    if (body.needScore !== undefined) {
      if (validateScore(body.needScore, "needScore") === null) {
        return sendError(res, 400, "Invalid score", "needScore must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
      }
      updateData.need_score = scoreForDb(body.needScore);
    }
    if (body.noveltyScore !== undefined) {
      if (validateScore(body.noveltyScore, "noveltyScore") === null) {
        return sendError(res, 400, "Invalid score", "noveltyScore must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
      }
      updateData.novelty_score = scoreForDb(body.noveltyScore);
    }
    if (body.feasibilityScalabilityScore !== undefined) {
      if (validateScore(body.feasibilityScalabilityScore, "feasibilityScalabilityScore") === null) {
        return sendError(res, 400, "Invalid score", "feasibilityScalabilityScore must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
      }
      updateData.feasibility_scalability_score = scoreForDb(body.feasibilityScalabilityScore);
    }
    if (body.marketPotentialScore !== undefined) {
      if (validateScore(body.marketPotentialScore, "marketPotentialScore") === null) {
        return sendError(res, 400, "Invalid score", "marketPotentialScore must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
      }
      updateData.market_potential_score = scoreForDb(body.marketPotentialScore);
    }
    if (body.impactScore !== undefined) {
      if (validateScore(body.impactScore, "impactScore") === null) {
        return sendError(res, 400, "Invalid score", "impactScore must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
      }
      updateData.impact_score = scoreForDb(body.impactScore);
    }

    if (body.needComment !== undefined)
      updateData.need_comment = body.needComment;
    if (body.noveltyComment !== undefined)
      updateData.novelty_comment = body.noveltyComment;
    if (body.feasibilityScalabilityComment !== undefined)
      updateData.feasibility_scalability_comment =
        body.feasibilityScalabilityComment;
    if (body.marketPotentialComment !== undefined)
      updateData.market_potential_comment = body.marketPotentialComment;
    if (body.impactComment !== undefined)
      updateData.impact_comment = body.impactComment;
    if (body.overallComment !== undefined)
      updateData.overall_comment = body.overallComment;

    const { data, error } = await supabase
      .from("application_evaluations")
      .update(updateData)
      .eq("id", id)
      .eq("reviewer_id", reviewerId)
      .select()
      .single();

    if (error) {
      console.error("Error updating evaluation:", error);
      if (error.code === "23503") {
        return sendError(
          res,
          400,
          "Invalid reference",
          "Related application or reviewer may not exist"
        );
      }
      if (error.code === "22P02" || error.message?.includes("integer")) {
        return sendError(
          res,
          500,
          "Failed to update evaluation",
          "Database schema may not support decimal scores. Run migrations 20240101000012 and 20240101000015 so scores are stored as decimals (values are not rounded to integers)."
        );
      }
      return sendError(
        res,
        500,
        "Failed to update evaluation",
        error.message,
        error.code
      );
    }

    return res.json({
      message: "Evaluation updated successfully",
      evaluation: data,
    });
  } catch (error: unknown) {
    console.error("Error updating evaluation:", error);
    return sendError(res, 500, "Failed to update evaluation", getErrorMessage(error));
  }
});

// PUT /api/evaluations/application/:applicationId - Upsert evaluation (create or update)
router.put(
  "/application/:applicationId",
  async (req: Request, res: Response) => {
    try {
      // Log the request at the start
      console.log("=== Evaluation PUT Request ===");
      console.log("URL:", req.url);
      console.log("Original URL:", req.originalUrl);
      console.log("Base URL:", req.baseUrl);
      console.log("Path:", req.path);
      console.log("Method:", req.method);
      console.log("Params:", req.params);
      console.log("Params keys:", Object.keys(req.params));
      console.log("Headers:", {
        "x-reviewer-id": req.headers["x-reviewer-id"],
        "content-type": req.headers["content-type"],
      });

      const { applicationId } = req.params;
      const body = req.body;

      // Validate request body
      if (!body || typeof body !== "object") {
        return sendError(
          res,
          400,
          "Invalid request body",
          "Request body must be a JSON object"
        );
      }

      // Also try to extract from URL if params is empty
      let extractedApplicationId = applicationId;
      if (!extractedApplicationId && req.url) {
        const urlMatch = req.url.match(/\/application\/([a-f0-9-]+)/i);
        if (urlMatch && urlMatch[1]) {
          extractedApplicationId = urlMatch[1];
          console.log(
            "Extracted applicationId from URL:",
            extractedApplicationId
          );
        }
      }

      // Use extracted ID if params didn't work
      const finalApplicationId = extractedApplicationId || applicationId;

      // Validate applicationId at the start
      if (
        !finalApplicationId ||
        finalApplicationId === "undefined" ||
        finalApplicationId === "" ||
        !uuidRegex.test(finalApplicationId)
      ) {
        console.error("Invalid applicationId:", finalApplicationId);
        return sendError(
          res,
          400,
          "Invalid application ID",
          "Application ID must be a valid UUID"
        );
      }

      // Validate reviewerId from headers
      const reviewerIdHeader = req.headers["x-reviewer-id"];
      const reviewerId =
        typeof reviewerIdHeader === "string" ? reviewerIdHeader.trim() : null;

      if (
        !reviewerId ||
        reviewerId === "undefined" ||
        reviewerId === "" ||
        !uuidRegex.test(reviewerId)
      ) {
        console.error("Invalid reviewer ID:", reviewerIdHeader);
        return sendError(
          res,
          401,
          "Reviewer ID is required",
          "x-reviewer-id header is missing or invalid"
        );
      }

      

      // Validate required fields
      const requiredFields = [
        "needScore",
        "noveltyScore",
        "feasibilityScalabilityScore",
        "marketPotentialScore",
        "impactScore",
      ];

      for (const field of requiredFields) {
        const val = body[field];
        if (val === undefined || val === null) {
          return sendError(res, 400, `Missing required field: ${field}`);
        }
        if (String(val).trim() === "") {
          return sendError(res, 400, `Score cannot be empty: ${field}`);
        }
      }

      // Validate scores (allow string or number, 0-10 with optional 1 decimal)
      const scoreKeys = [
        "needScore",
        "noveltyScore",
        "feasibilityScalabilityScore",
        "marketPotentialScore",
        "impactScore",
      ] as const;

      for (const key of scoreKeys) {
        const raw = body[key];
        const num =
          typeof raw === "string" ? parseFloat(raw) : Number(raw);
        if (raw === undefined || raw === null || String(raw).trim() === "") {
          return sendError(res, 400, `Missing required field: ${key}`);
        }
        if (isNaN(num) || num < 0 || num > 10) {
          return sendError(res, 400, "All scores must be between 0 and 10 (inclusive). Values less than 0 or greater than 10 are not allowed.");
        }
        const scoreStr = String(raw);
        const decimalParts = scoreStr.split(".");
        if (decimalParts.length === 2 && decimalParts[1].length > 2) {
          return sendError(res, 400, "Scores can have at most 2 decimal places");
        }
      }

      // Check if reviewer is assigned and has accepted (reviewerId already validated above with UUID regex)
      console.log("Checking reviewer assignment...");
      const { data: assignment, error: assignmentError } = await supabase
        .from("application_reviewers")
        .select("id, invite_status")
        .eq("application_id", finalApplicationId)
        .eq("reviewer_id", reviewerId)
        .maybeSingle();

      if (assignmentError) {
        console.error("Error checking reviewer assignment:", assignmentError);
        return sendError(
          res,
          500,
          "Failed to verify reviewer assignment",
          assignmentError.message,
          assignmentError.code
        );
      }

      if (!assignment) {
        console.log("Reviewer not assigned to application");
        return sendError(
          res,
          403,
          "You are not assigned to review this application",
          "Reviewer is not assigned to this application"
        );
      }

      const inviteStatus = assignment.invite_status ?? "pending";
      if (inviteStatus !== "accepted") {
        return sendError(
          res,
          403,
          inviteStatus === "rejected"
            ? "You have declined this assignment"
            : "Please accept the reviewer assignment before submitting an evaluation"
        );
      }

      

      // Check if evaluation exists
      const { data: existing, error: existingError } = await supabase
        .from("application_evaluations")
        .select("id")
        .eq("application_id", finalApplicationId)
        .eq("reviewer_id", reviewerId)
        .maybeSingle();

      if (existingError && existingError.code !== "PGRST116") {
        console.error("Error checking existing evaluation:", existingError);
        return sendError(
          res,
          500,
          "Failed to check existing evaluation",
          existingError.message,
          existingError.code
        );
      }

      // Parse scores as decimals (no rounding). Use original string when possible so decimals (e.g. 9.44) are never lost.
      const parseScore = (score: string | number): number => {
        const num = typeof score === "string" ? parseFloat(score) : Number(score);
        return num;
      };
      const scoreForDb = (score: string | number): string => {
        if (typeof score === "string" && score.trim() !== "") {
          const n = parseFloat(score);
          if (!isNaN(n)) return score.trim();
        }
        const n = parseScore(score);
        return n % 1 === 0 ? `${n}.0` : String(n);
      };

      const buildEvaluationData = () => ({
        application_id: finalApplicationId,
        reviewer_id: reviewerId,
        need_score: scoreForDb(body.needScore),
        novelty_score: scoreForDb(body.noveltyScore),
        feasibility_scalability_score: scoreForDb(body.feasibilityScalabilityScore),
        market_potential_score: scoreForDb(body.marketPotentialScore),
        impact_score: scoreForDb(body.impactScore),
        need_comment: body.needComment || null,
        novelty_comment: body.noveltyComment || null,
        feasibility_scalability_comment:
          body.feasibilityScalabilityComment || null,
        market_potential_comment: body.marketPotentialComment || null,
        impact_comment: body.impactComment || null,
        overall_comment: body.overallComment || null,
      });

      const evaluationData = buildEvaluationData();
      let data: { id?: string; [key: string]: unknown } | null = null;
      let error: { message: string; code?: string; details?: unknown } | null =
        null;

      const runUpsert = async (payload: ReturnType<typeof buildEvaluationData>) => {
        if (existing) {
          return supabase
            .from("application_evaluations")
            .update(payload)
            .eq("id", existing.id)
            .select()
            .single();
        }
        return supabase
          .from("application_evaluations")
          .insert(payload)
          .select()
          .single();
      };

      const result = await runUpsert(evaluationData);
      data = result.data;
      error = result.error;

      if (error) {
        console.error("Error saving evaluation:", error);
        const operation = existing ? "update" : "create";
        if (error.code === "23505") {
          return sendError(
            res,
            409,
            "Evaluation conflict",
            "Evaluation already exists for this application"
          );
        }
        if (error.code === "23503") {
          const isApplicationFk =
            error.message?.includes("application_evaluations_application_id_fkey");
          return sendError(
            res,
            400,
            isApplicationFk
              ? "Application not found for evaluation"
              : "Invalid reference",
            isApplicationFk
              ? "Application ID does not exist in the applications table. If applications are stored in new_application, run migration 20240101000013."
              : "Application or reviewer may not exist"
          );
        }
        if (error.code === "22P02" || error.message?.includes("integer")) {
          return sendError(
            res,
            500,
            `Failed to ${operation} evaluation`,
            "Database schema may not support decimal scores. Run migrations 20240101000012 and 20240101000015 so scores are stored as decimals (values are not rounded to integers)."
          );
        }
        return sendError(
          res,
          500,
          existing ? "Failed to update evaluation" : "Failed to create evaluation",
          error.message,
          error.code
        );
      }


      // If all assigned accepted reviewers have submitted, set application status to "evaluated"
      const { data: acceptedAssignments, error: acceptedError } = await supabase
        .from("application_reviewers")
        .select("reviewer_id")
        .eq("application_id", finalApplicationId)
        .eq("invite_status", "accepted");
      
      if (acceptedError) {
        console.error("Error fetching accepted reviewers:", acceptedError);
      } else {
        const acceptedCount = acceptedAssignments?.length ?? 0;

        const { data: evalsForApp, error: evalsError } = await supabase
          .from("application_evaluations")
          .select("reviewer_id")
          .eq("application_id", finalApplicationId);
        
        if (evalsError) {
          console.error("Error fetching evaluations:", evalsError);
        } else {
          // Count unique reviewers who have submitted evaluations
          const uniqueReviewerIds = new Set(evalsForApp?.map((e: any) => e.reviewer_id) ?? []);
          const evalCount = uniqueReviewerIds.size;
          

          if (acceptedCount > 0 && evalCount >= acceptedCount) {
            const { error: updateError } = await supabase
              .from("new_application")
              .update({ status: "evaluated" })
              .eq("id", finalApplicationId);
            
            if (updateError) {
              console.error("Error updating application status to evaluated:", updateError);
            }
          } else {
              console.log(`Not all evaluations complete yet: ${evalCount}/${acceptedCount}`);
          }
        }
      }

      return res.json({
        message: existing
          ? "Evaluation updated successfully"
          : "Evaluation created successfully",
        evaluation: data,
      });
    } catch (error: unknown) {
      console.error("=== Error in PUT /application/:applicationId ===");
      console.error("Error:", error);
      return sendError(
        res,
        500,
        "Failed to save evaluation",
        getErrorMessage(error)
      );
    }
  }
);

export default router;
