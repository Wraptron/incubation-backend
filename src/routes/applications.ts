import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// POST /api/applications - Submit a new startup application
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Validate required fields based on the actual form
    const requiredFields = [
      "companyName",
      "founderName",
      "email",
      "phone",
      "description",
      "problem",
      "solution",
      "targetMarket",
      "businessModel",
      "fundingStage",
      "whyIncubator",
    ];

    for (const field of requiredFields) {
      if (
        !body[field] ||
        (typeof body[field] === "string" && body[field].trim() === "")
      ) {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
        });
      }
    }

    // Map funding stage from frontend to database enum
    const fundingStageMap: Record<string, string> = {
      "pre-seed": "pre_seed",
      seed: "seed",
      "series-a": "series_a",
      "series-b": "series_b",
      "series-c+": "series_c_plus",
      bootstrapped: "bootstrapped",
    };

    // Insert application into database
    const { data, error } = await supabase
      .from("startup_applications")
      .insert({
        user_id: null, // Anonymous submission
        // Company Information
        company_name: body.companyName,
        website: body.website || null,
        description: body.description,
        // Founder Information
        founder_name: body.founderName,
        co_founders: body.coFounders || null,
        email: body.email,
        phone: body.phone,
        // Business Details
        problem: body.problem,
        solution: body.solution,
        target_market: body.targetMarket,
        business_model: body.businessModel,
        // Funding & Traction
        funding_stage: fundingStageMap[body.fundingStage] || null,
        funding_amount: body.fundingAmount || null,
        current_traction: body.currentTraction || null,
        // Application Details
        why_incubator: body.whyIncubator,
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        error: "Failed to save application",
        details: error.message,
        code: error.code,
        hint: error.hint,
      });
    }

    return res.status(201).json({
      message: "Application submitted successfully",
      data: {
        id: data.id,
        status: data.status,
      },
    });
  } catch (error: any) {
    console.error("Error processing application:", error);
    return res.status(500).json({
      error: "Failed to process application",
      details: error.message || "Unknown error occurred",
    });
  }
});

// GET /api/applications - List all applications (for admin/reviewers)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from("startup_applications")
      .select("*")
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        error: "Failed to fetch applications",
        details: error.message,
      });
    }

    // Fetch all reviewers for all applications from junction table
    const applicationIds = (data || []).map((app: any) => app.id);
    let applicationReviewers: Record<
      string,
      Array<{ id: string; full_name: string | null }>
    > = {};

    if (applicationIds.length > 0) {
      const { data: reviewerAssignments } = await supabase
        .from("application_reviewers")
        .select("application_id, reviewer_id")
        .in("application_id", applicationIds);

      if (reviewerAssignments && reviewerAssignments.length > 0) {
        const reviewerIds = [
          ...new Set(reviewerAssignments.map((ar: any) => ar.reviewer_id)),
        ];

        const { data: reviewerData } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", reviewerIds);

        if (reviewerData) {
          const reviewersMap: Record<
            string,
            { id: string; full_name: string | null }
          > = {};
          reviewerData.forEach((reviewer) => {
            reviewersMap[reviewer.id] = {
              id: reviewer.id,
              full_name: reviewer.full_name,
            };
          });

          // Group reviewers by application
          reviewerAssignments.forEach((ar: any) => {
            if (!applicationReviewers[ar.application_id]) {
              applicationReviewers[ar.application_id] = [];
            }
            if (reviewersMap[ar.reviewer_id]) {
              applicationReviewers[ar.application_id].push(
                reviewersMap[ar.reviewer_id]
              );
            }
          });
        }
      }
    }

    // Enrich applications with reviewer data
    const enrichedApplications = (data || []).map((app: any) => ({
      ...app,
      reviewers: applicationReviewers[app.id] || [],
    }));

    // Get total count
    let countQuery = supabase
      .from("startup_applications")
      .select("*", { count: "exact", head: true });

    if (status) {
      countQuery = countQuery.eq("status", status);
    }

    const { count } = await countQuery;

    return res.json({
      applications: enrichedApplications,
      pagination: {
        total: count || 0,
        limit: Number(limit),
        offset: Number(offset),
      },
    });
  } catch (error) {
    console.error("Error fetching applications:", error);
    return res.status(500).json({
      error: "Failed to fetch applications",
    });
  }
});

// GET /api/applications/:id - Get a single application
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("startup_applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          error: "Application not found",
        });
      }
      return res.status(500).json({
        error: "Failed to fetch application",
        details: error.message,
      });
    }

    // Fetch all reviewers assigned to this application
    const { data: reviewerAssignments } = await supabase
      .from("application_reviewers")
      .select("reviewer_id")
      .eq("application_id", id);

    let reviewers: Array<{ id: string; full_name: string | null }> = [];

    if (reviewerAssignments && reviewerAssignments.length > 0) {
      const reviewerIds = reviewerAssignments.map((ar: any) => ar.reviewer_id);
      const { data: reviewerData } = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", reviewerIds);

      if (reviewerData) {
        reviewers = reviewerData.map((reviewer) => ({
          id: reviewer.id,
          full_name: reviewer.full_name,
        }));
      }
    }

    return res.json({
      application: {
        ...data,
        reviewers,
      },
    });
  } catch (error) {
    console.error("Error fetching application:", error);
    return res.status(500).json({
      error: "Failed to fetch application",
    });
  }
});

// PUT /api/applications/:id - Update an application (status, etc.)
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body;

    const updateData: any = {};

    // Only allow status updates for now (managers/reviewers)
    if (body.status) {
      const validStatuses = [
        "pending",
        "under_review",
        "approved",
        "rejected",
        "withdrawn",
      ];
      if (!validStatuses.includes(body.status)) {
        return res.status(400).json({
          error: "Invalid status",
        });
      }
      updateData.status = body.status;
    }

    // Handle multiple reviewer assignments (up to 5)
    if (body.reviewerIds !== undefined) {
      if (Array.isArray(body.reviewerIds)) {
        // Validate maximum 5 reviewers
        if (body.reviewerIds.length > 5) {
          return res.status(400).json({
            error: "Maximum of 5 reviewers allowed per application",
          });
        }

        // Remove all existing reviewer assignments
        await supabase
          .from("application_reviewers")
          .delete()
          .eq("application_id", id);

        // Add new reviewer assignments
        if (body.reviewerIds.length > 0) {
          const assignments = body.reviewerIds
            .filter(
              (reviewerId: string) => reviewerId && reviewerId.trim() !== ""
            )
            .map((reviewerId: string) => ({
              application_id: id,
              reviewer_id: reviewerId,
              assigned_by: body.assignedBy || null,
            }));

          if (assignments.length > 0) {
            const { error: assignError } = await supabase
              .from("application_reviewers")
              .insert(assignments);

            if (assignError) {
              return res.status(500).json({
                error: "Failed to assign reviewers",
                details: assignError.message,
              });
            }
          }
        }
      }
    }

    // Legacy support: Handle single reviewerId for backward compatibility
    if (body.reviewerId !== undefined) {
      if (body.reviewerId) {
        // Remove all existing assignments
        await supabase
          .from("application_reviewers")
          .delete()
          .eq("application_id", id);

        // Add single reviewer
        const { error: assignError } = await supabase
          .from("application_reviewers")
          .insert({
            application_id: id,
            reviewer_id: body.reviewerId,
            assigned_by: body.assignedBy || null,
          });

        if (assignError) {
          return res.status(500).json({
            error: "Failed to assign reviewer",
            details: assignError.message,
          });
        }
      } else {
        // Remove all reviewers if reviewerId is null/empty
        await supabase
          .from("application_reviewers")
          .delete()
          .eq("application_id", id);
      }
    }

    // Allow updates to form fields
    const fieldMappings: Record<string, string> = {
      companyName: "company_name",
      website: "website",
      description: "description",
      founderName: "founder_name",
      coFounders: "co_founders",
      email: "email",
      phone: "phone",
      problem: "problem",
      solution: "solution",
      targetMarket: "target_market",
      businessModel: "business_model",
      fundingStage: "funding_stage",
      fundingAmount: "funding_amount",
      currentTraction: "current_traction",
      whyIncubator: "why_incubator",
    };

    const fundingStageMap: Record<string, string> = {
      "pre-seed": "pre_seed",
      seed: "seed",
      "series-a": "series_a",
      "series-b": "series_b",
      "series-c+": "series_c_plus",
      bootstrapped: "bootstrapped",
    };

    Object.entries(fieldMappings).forEach(([frontendField, dbField]) => {
      if (body[frontendField] !== undefined) {
        if (frontendField === "fundingStage") {
          updateData[dbField] = fundingStageMap[body[frontendField]] || null;
        } else {
          updateData[dbField] = body[frontendField];
        }
      }
    });

    const { data, error } = await supabase
      .from("startup_applications")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          error: "Application not found",
        });
      }
      return res.status(500).json({
        error: "Failed to update application",
        details: error.message,
      });
    }

    // Fetch updated reviewers list
    const { data: reviewerAssignments } = await supabase
      .from("application_reviewers")
      .select("reviewer_id")
      .eq("application_id", id);

    let reviewers: Array<{ id: string; full_name: string | null }> = [];

    if (reviewerAssignments && reviewerAssignments.length > 0) {
      const reviewerIds = reviewerAssignments.map((ar: any) => ar.reviewer_id);
      const { data: reviewerData } = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", reviewerIds);

      if (reviewerData) {
        reviewers = reviewerData.map((reviewer) => ({
          id: reviewer.id,
          full_name: reviewer.full_name,
        }));
      }
    }

    return res.json({
      application: {
        ...data,
        reviewers,
      },
    });
  } catch (error) {
    console.error("Error updating application:", error);
    return res.status(500).json({
      error: "Failed to update application",
    });
  }
});

export default router;
