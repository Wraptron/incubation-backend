import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

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
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (
        !applicationId ||
        applicationId === "undefined" ||
        applicationId === "" ||
        !uuidRegex.test(applicationId)
      ) {
        console.error("Invalid applicationId:", applicationId);
        return res.status(400).json({
          error: "Invalid application ID",
          details: "Application ID must be a valid UUID",
          received: applicationId,
        });
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
        return res.status(401).json({
          error: "Reviewer ID is required",
          details: "x-reviewer-id header is missing or invalid",
          received: reviewerIdHeader,
        });
      }

      console.log(
        "Validated IDs - Application:",
        applicationId,
        "Reviewer:",
        reviewerId
      );

      const { data, error } = await supabase
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
        return res.status(500).json({
          error: "Failed to fetch evaluation",
          details: error.message,
        });
      }

      return res.json({ evaluation: data });
    } catch (error) {
      console.error("Error fetching evaluation:", error);
      return res.status(500).json({
        error: "Failed to fetch evaluation",
      });
    }
  }
);

// GET /api/evaluations/application/:applicationId/all - Get all evaluations for an application (managers only)
router.get(
  "/application/:applicationId/all",
  async (req: Request, res: Response) => {
    try {
      const { applicationId } = req.params;

      const { data, error } = await supabase
        .from("application_evaluations")
        .select(
          `
        *,
        reviewer:user_profiles!application_evaluations_reviewer_id_fkey(
          id,
          full_name
        )
      `
        )
        .eq("application_id", applicationId)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(500).json({
          error: "Failed to fetch evaluations",
          details: error.message,
        });
      }

      return res.json({ evaluations: data || [] });
    } catch (error) {
      console.error("Error fetching evaluations:", error);
      return res.status(500).json({
        error: "Failed to fetch evaluations",
      });
    }
  }
);

// POST /api/evaluations - Create a new evaluation
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Try multiple header formats (Express normalizes headers)
    const reviewerId =
      (req.headers["x-reviewer-id"] as string) ||
      (req.headers["X-Reviewer-Id"] as string) ||
      (req.headers["X-REVIEWER-ID"] as string);

    if (!reviewerId || reviewerId === "undefined") {
      return res.status(401).json({
        error: "Reviewer ID is required",
        details: "x-reviewer-id header is missing or invalid",
      });
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
        return res.status(400).json({
          error: `Missing required field: ${field}`,
        });
      }
    }

    // Validate scores are between 0 and 10
    const scores = [
      body.needScore,
      body.noveltyScore,
      body.feasibilityScalabilityScore,
      body.marketPotentialScore,
      body.impactScore,
    ];

    for (const score of scores) {
      if (score < 0 || score > 10) {
        return res.status(400).json({
          error: "All scores must be between 0 and 10",
        });
      }
    }

    // Check if reviewer is assigned to this application
    const { data: assignment, error: assignmentError } = await supabase
      .from("application_reviewers")
      .select("id")
      .eq("application_id", body.applicationId)
      .eq("reviewer_id", reviewerId)
      .maybeSingle();

    if (assignmentError) {
      console.error("Error checking reviewer assignment:", assignmentError);
      return res.status(500).json({
        error: "Failed to verify reviewer assignment",
        details: assignmentError.message,
      });
    }

    if (!assignment) {
      return res.status(403).json({
        error: "You are not assigned to review this application",
      });
    }

    // Insert evaluation
    const { data, error } = await supabase
      .from("application_evaluations")
      .insert({
        application_id: body.applicationId,
        reviewer_id: reviewerId,
        need_score: parseInt(body.needScore),
        novelty_score: parseInt(body.noveltyScore),
        feasibility_scalability_score: parseInt(
          body.feasibilityScalabilityScore
        ),
        market_potential_score: parseInt(body.marketPotentialScore),
        impact_score: parseInt(body.impactScore),
        need_comment: body.needComment || null,
        novelty_comment: body.noveltyComment || null,
        feasibility_scalability_comment:
          body.feasibilityScalabilityComment || null,
        market_potential_comment: body.marketPotentialComment || null,
        impact_comment: body.impactComment || null,
        overall_comment: body.overallComment || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        // Unique constraint violation - evaluation already exists
        return res.status(409).json({
          error:
            "Evaluation already exists for this application. Use PUT to update it.",
        });
      }
      return res.status(500).json({
        error: "Failed to create evaluation",
        details: error.message,
      });
    }

    return res.status(201).json({
      message: "Evaluation created successfully",
      evaluation: data,
    });
  } catch (error: any) {
    console.error("Error creating evaluation:", error);
    return res.status(500).json({
      error: "Failed to create evaluation",
      details: error.message,
    });
  }
});

// PUT /api/evaluations/:id - Update an existing evaluation
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const reviewerId = req.headers["x-reviewer-id"] as string;

    if (!reviewerId) {
      return res.status(401).json({
        error: "Reviewer ID is required",
      });
    }

    // Check if evaluation exists and belongs to this reviewer
    const { data: existingEvaluation, error: fetchError } = await supabase
      .from("application_evaluations")
      .select("*")
      .eq("id", id)
      .eq("reviewer_id", reviewerId)
      .single();

    if (fetchError || !existingEvaluation) {
      return res.status(404).json({
        error: "Evaluation not found or you don't have permission to update it",
      });
    }

    // Build update object
    const updateData: any = {};

    if (body.needScore !== undefined) {
      if (body.needScore < 0 || body.needScore > 10) {
        return res.status(400).json({
          error: "needScore must be between 0 and 10",
        });
      }
      updateData.need_score = parseInt(body.needScore);
    }

    if (body.noveltyScore !== undefined) {
      if (body.noveltyScore < 0 || body.noveltyScore > 10) {
        return res.status(400).json({
          error: "noveltyScore must be between 0 and 10",
        });
      }
      updateData.novelty_score = parseInt(body.noveltyScore);
    }

    if (body.feasibilityScalabilityScore !== undefined) {
      if (
        body.feasibilityScalabilityScore < 0 ||
        body.feasibilityScalabilityScore > 10
      ) {
        return res.status(400).json({
          error: "feasibilityScalabilityScore must be between 0 and 10",
        });
      }
      updateData.feasibility_scalability_score = parseInt(
        body.feasibilityScalabilityScore
      );
    }

    if (body.marketPotentialScore !== undefined) {
      if (body.marketPotentialScore < 0 || body.marketPotentialScore > 10) {
        return res.status(400).json({
          error: "marketPotentialScore must be between 0 and 10",
        });
      }
      updateData.market_potential_score = parseInt(body.marketPotentialScore);
    }

    if (body.impactScore !== undefined) {
      if (body.impactScore < 0 || body.impactScore > 10) {
        return res.status(400).json({
          error: "impactScore must be between 0 and 10",
        });
      }
      updateData.impact_score = parseInt(body.impactScore);
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
      return res.status(500).json({
        error: "Failed to update evaluation",
        details: error.message,
      });
    }

    return res.json({
      message: "Evaluation updated successfully",
      evaluation: data,
    });
  } catch (error: any) {
    console.error("Error updating evaluation:", error);
    return res.status(500).json({
      error: "Failed to update evaluation",
      details: error.message,
    });
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

      // UUID validation regex
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        console.error("Raw params.applicationId:", applicationId);
        console.error("Extracted applicationId:", extractedApplicationId);
        return res.status(400).json({
          error: "Invalid application ID",
          details: "Application ID must be a valid UUID",
          received: finalApplicationId,
          debug: {
            params: req.params,
            url: req.url,
            originalUrl: req.originalUrl,
          },
        });
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
        console.error("Request headers:", Object.keys(req.headers));
        console.error("x-reviewer-id value:", reviewerIdHeader);
        return res.status(401).json({
          error: "Reviewer ID is required",
          details: "x-reviewer-id header is missing or invalid",
          received: reviewerIdHeader,
        });
      }

      console.log(
        "Validated IDs - Application:",
        finalApplicationId,
        "Reviewer:",
        reviewerId
      );

      // Validate required fields
      const requiredFields = [
        "needScore",
        "noveltyScore",
        "feasibilityScalabilityScore",
        "marketPotentialScore",
        "impactScore",
      ];

      for (const field of requiredFields) {
        if (body[field] === undefined || body[field] === null) {
          return res.status(400).json({
            error: `Missing required field: ${field}`,
          });
        }
      }

      // Validate scores
      const scores = [
        body.needScore,
        body.noveltyScore,
        body.feasibilityScalabilityScore,
        body.marketPotentialScore,
        body.impactScore,
      ];

      for (const score of scores) {
        if (score < 0 || score > 10) {
          return res.status(400).json({
            error: "All scores must be between 0 and 10",
          });
        }
      }

      // Check if reviewer is assigned (reviewerId already validated above with UUID regex)
      console.log("Checking reviewer assignment...");
      const { data: assignment, error: assignmentError } = await supabase
        .from("application_reviewers")
        .select("id")
        .eq("application_id", finalApplicationId)
        .eq("reviewer_id", reviewerId)
        .maybeSingle();

      if (assignmentError) {
        console.error("Error checking reviewer assignment:", assignmentError);
        console.error("Reviewer ID used in query:", reviewerId);
        console.error("Application ID used in query:", finalApplicationId);
        console.error("Error code:", assignmentError.code);
        console.error("Error details:", assignmentError.details);
        return res.status(500).json({
          error: "Failed to verify reviewer assignment",
          details: assignmentError.message,
          code: assignmentError.code,
        });
      }

      if (!assignment) {
        console.log("Reviewer not assigned to application");
        return res.status(403).json({
          error: "You are not assigned to review this application",
          details: `Reviewer ${reviewerId} is not assigned to application ${finalApplicationId}`,
        });
      }

      console.log("Reviewer assignment verified:", assignment.id);

      // Check if evaluation exists
      console.log("Checking if evaluation exists...");
      const { data: existing, error: existingError } = await supabase
        .from("application_evaluations")
        .select("id")
        .eq("application_id", finalApplicationId)
        .eq("reviewer_id", reviewerId)
        .maybeSingle();

      if (existingError && existingError.code !== "PGRST116") {
        console.error("Error checking existing evaluation:", existingError);
        return res.status(500).json({
          error: "Failed to check existing evaluation",
          details: existingError.message,
        });
      }

      const evaluationData = {
        application_id: finalApplicationId,
        reviewer_id: reviewerId,
        need_score: parseInt(body.needScore),
        novelty_score: parseInt(body.noveltyScore),
        feasibility_scalability_score: parseInt(
          body.feasibilityScalabilityScore
        ),
        market_potential_score: parseInt(body.marketPotentialScore),
        impact_score: parseInt(body.impactScore),
        need_comment: body.needComment || null,
        novelty_comment: body.noveltyComment || null,
        feasibility_scalability_comment:
          body.feasibilityScalabilityComment || null,
        market_potential_comment: body.marketPotentialComment || null,
        impact_comment: body.impactComment || null,
        overall_comment: body.overallComment || null,
      };

      let data, error;

      if (existing) {
        // Update existing
        console.log("Updating existing evaluation:", existing.id);
        const result = await supabase
          .from("application_evaluations")
          .update(evaluationData)
          .eq("id", existing.id)
          .select()
          .single();
        data = result.data;
        error = result.error;
      } else {
        // Insert new
        console.log("Creating new evaluation");
        const result = await supabase
          .from("application_evaluations")
          .insert(evaluationData)
          .select()
          .single();
        data = result.data;
        error = result.error;
      }

      if (error) {
        console.error("Error saving evaluation:", error);
        console.error("Error code:", error.code);
        console.error("Error details:", error.details);
        return res.status(500).json({
          error: existing
            ? "Failed to update evaluation"
            : "Failed to create evaluation",
          details: error.message,
          code: error.code,
        });
      }

      console.log("Evaluation saved successfully:", data?.id);
      return res.json({
        message: existing
          ? "Evaluation updated successfully"
          : "Evaluation created successfully",
        evaluation: data,
      });
    } catch (error: any) {
      console.error("=== Error in PUT /application/:applicationId ===");
      console.error("Error:", error);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      return res.status(500).json({
        error: "Failed to save evaluation",
        details: error.message || "An unexpected error occurred",
      });
    }
  }
);

export default router;
