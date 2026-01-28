import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

/* =========================
   POST /api/applications
========================= */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Validate required fields based on database schema
    const requiredFields = [
      "email",
      "teamName",
      "yourName",
      "isIITM",
      "rollNumber",
      "phoneNumber",
      "channel",
      "coFoundersCount",
      "priorEntrepreneurshipExperience",
      "teamPriorEntrepreneurshipExperience",
      "mcaRegistered",
      "teamMembers",
      "nirmaanCanHelp",
      "preIncubationReason",
      "heardAboutStartups",
      "heardAboutNirmaan",
      "problemSolving",
      "yourSolution",
      "solutionType",
      "targetIndustry",
      "startupStage",
      "hasIntellectualProperty",
      "hasPotentialIntellectualProperty",
      "nirmaanPresentationLink",
      "hasProofOfConcept",
      "hasPatentsOrPapers",
      "seedFundUtilizationPlan",
      "pitchVideoLink",
    ];

    for (const field of requiredFields) {
      if (!body[field] || String(body[field]).trim() === "") {
        return res.status(400).json({
          error: `Missing required field: ${field}`,
        });
      }
    }

    // Parse JSONB fields if needed
    let otherIndustries = body.otherIndustries || [];
    if (typeof otherIndustries === 'string') {
      try {
        otherIndustries = JSON.parse(otherIndustries);
      } catch {
        otherIndustries = [];
      }
    }
    
    let technologiesUtilized = body.technologiesUtilized || [];
    if (typeof technologiesUtilized === 'string') {
      try {
        technologiesUtilized = JSON.parse(technologiesUtilized);
      } catch {
        technologiesUtilized = [];
      }
    }

    const { data, error } = await supabase
      .from("new_application")
      .insert({
        // Basic Information
        email: body.email,
        team_name: body.teamName,
        your_name: body.yourName,
        is_iitm: body.isIITM,
        roll_number: body.rollNumber,
        roll_number_other: body.rollNumberOther || null,
        college_name: body.collegeName || null,
        current_occupation: body.currentOccupation || null,
        phone_number: body.phoneNumber,
        channel: body.channel,
        channel_other: body.channelOther || null,
        co_founders_count: parseInt(body.coFoundersCount),
        faculty_involved: body.facultyInvolved || null,

        // Entrepreneurship Experience
        prior_entrepreneurship_experience: body.priorEntrepreneurshipExperience,
        team_prior_entrepreneurship_experience: body.teamPriorEntrepreneurshipExperience,
        prior_experience_details: body.priorExperienceDetails || null,

        // Startup Registration & Funding
        mca_registered: body.mcaRegistered,
        dpiit_registered: body.dpiitRegistered || null,
        dpiit_details: body.dpiitDetails || null,
        external_funding: body.externalFunding || null,
        currently_incubated: body.currentlyIncubated || null,

        // Team Members
        team_members: body.teamMembers,

        // About Nirmaan Program
        nirmaan_can_help: body.nirmaanCanHelp,
        pre_incubation_reason: body.preIncubationReason,
        heard_about_startups: body.heardAboutStartups,
        heard_about_nirmaan: body.heardAboutNirmaan,

        // Problem & Solution
        problem_solving: body.problemSolving,
        your_solution: body.yourSolution,
        solution_type: body.solutionType,

        // Industry & Technologies
        target_industry: body.targetIndustry,
        other_industries: otherIndustries,
        industry_other: body.industryOther || null,
        other_industries_other: body.otherIndustriesOther || null,
        technologies_utilized: technologiesUtilized,
        other_technology_details: body.otherTechnologyDetails || null,

        // Startup Stage & IP
        startup_stage: body.startupStage,
        has_intellectual_property: body.hasIntellectualProperty,
        has_potential_intellectual_property: body.hasPotentialIntellectualProperty,

        // Presentation & Proof
        nirmaan_presentation_link: body.nirmaanPresentationLink,
        has_proof_of_concept: body.hasProofOfConcept,
        proof_of_concept_details: body.proofOfConceptDetails || null,
        has_patents_or_papers: body.hasPatentsOrPapers,
        patents_or_papers_details: body.patentsOrPapersDetails || null,

        // Seed Fund & Pitch
        seed_fund_utilization_plan: body.seedFundUtilizationPlan,
        pitch_video_link: body.pitchVideoLink,
        document1_link: body.document1Link || null,
        document2_link: body.document2Link || null,

        // Status
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
      .from("new_application")
      .select("*")
      .order("submitted_at", { ascending: false })
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

    // Map new_application fields to old field names for frontend compatibility
    const enriched = data.map(app => ({
      ...app,
      company_name: app.team_name || app.company_name,
      founder_name: app.your_name || app.founder_name,
      phone: app.phone_number || app.phone,
      problem: app.problem_solving || app.problem,
      solution: app.your_solution || app.solution,
      created_at: app.submitted_at || app.created_at,
      reviewers: reviewersMap[app.id] || [],
    }));

    const { count } = await supabase
      .from("new_application")
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
      .from("new_application")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({ error: "Application not found" });
    }

    // Map new_application fields to old field names for frontend compatibility
    const mappedApplication = {
      ...data,
      // Basic mappings
      company_name: data.team_name || data.company_name,
      founder_name: data.your_name || data.founder_name,
      phone: data.phone_number || data.phone,
      created_at: data.submitted_at || data.created_at,
      
      // Content mappings
      problem: data.problem_solving || data.problem,
      solution: data.your_solution || data.solution,
      description: data.your_solution || data.problem_solving || data.description,
      
      // Business mappings
      target_market: data.target_industry || data.target_market,
      business_model: data.solution_type || data.business_model,
      current_traction: data.proof_of_concept_details || data.current_traction,
      why_incubator: data.nirmaan_can_help || data.pre_incubation_reason || data.why_incubator,
      funding_amount: data.external_funding || data.funding_amount,
      
      // Additional fields with fallbacks
      website: data.website || null,
      co_founders: data.faculty_involved || data.co_founders || null,
      funding_stage: data.funding_stage || null,
    };

    return res.json({ application: mappedApplication });
  } catch (error) {
    console.error("GET by ID error:", error);
    return res.status(500).json({ error: "Failed to fetch application" });
  }
});

export default router;
