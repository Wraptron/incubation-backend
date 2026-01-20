import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

/* =========================
   POST /api/applications
========================= */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

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
      if (!body[field] || String(body[field]).trim() === "") {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
        });
      }
    }

    const fundingStageMap: Record<string, string> = {
      "pre-seed": "pre_seed",
      seed: "seed",
      "series-a": "series_a",
      "series-b": "series_b",
      "series-c+": "series_c_plus",
      bootstrapped: "bootstrapped",
    };

    const { data, error } = await supabase
      .from("startup_applications")
      .insert({
        user_id: null,
        company_name: body.companyName,
        website: body.website || null,
        description: body.description,
        founder_name: body.founderName,
        co_founders: body.coFounders || null,
        email: body.email,
        phone: body.phone,
        problem: body.problem,
        solution: body.solution,
        target_market: body.targetMarket,
        business_model: body.businessModel,
        funding_stage: fundingStageMap[body.fundingStage] || null,
        funding_amount: body.fundingAmount || null,
        current_traction: body.currentTraction || null,
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
    console.error("POST error:", error);
    return res.status(500).json({
      error: "Failed to process application",
    });
  }
});

/* =========================
   GET /api/applications
========================= */
router.get("/", async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    let query = supabase
      .from("startup_applications")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch applications" });
    }

    const applicationIds = data.map((app: any) => app.id);
    let reviewersMap: Record<string, any[]> = {};

    if (applicationIds.length) {
      const { data: reviewerAssignments } = await supabase
        .from("application_reviewers")
        .select("application_id, reviewer_id")
        .in("application_id", applicationIds);

      if (reviewerAssignments?.length) {
        const reviewerIds = [
          ...new Set(reviewerAssignments.map(r => r.reviewer_id)),
        ];

        const { data: reviewers } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", reviewerIds);

        const reviewerLookup = Object.fromEntries(
          (reviewers || []).map(r => [r.id, r])
        );

        reviewerAssignments.forEach((ra: any) => {
          reviewersMap[ra.application_id] ??= [];
          if (reviewerLookup[ra.reviewer_id]) {
            reviewersMap[ra.application_id].push(reviewerLookup[ra.reviewer_id]);
          }
        });
      }
    }

    const enriched = data.map(app => ({
      ...app,
      reviewers: reviewersMap[app.id] || [],
    }));

    const { count } = await supabase
      .from("startup_applications")
      .select("*", { count: "exact", head: true });

    return res.json({
      applications: enriched,
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    console.error("GET error:", error);
    return res.status(500).json({ error: "Failed to fetch applications" });
  }
});

/* =========================
   GET /api/applications/:id
========================= */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("startup_applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({ error: "Application not found" });
    }

    return res.json({ application: data });
  } catch (error) {
    console.error("GET by ID error:", error);
    return res.status(500).json({ error: "Failed to fetch application" });
  }
});

export default router;
