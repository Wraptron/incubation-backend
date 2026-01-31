import { Router, Request, Response } from "express";
import crypto from "crypto";
import { supabase } from "../lib/supabase";

const router = Router();

router.use((req, _res, next) => {
  console.log("[Backend] Applications request:", req.method, req.path || req.url);
  next();
});

const RESUME_TOKEN_BYTES = 32;
const RESUME_TOKEN_EXPIRY_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function buildDraftPayload(body: Record<string, unknown>) {
  let facultyInvolved = body.facultyInvolved;
  if (typeof facultyInvolved === "string") {
    try {
      facultyInvolved = JSON.parse(facultyInvolved);
    } catch {
      facultyInvolved = "NA";
    }
  }
  if (Array.isArray(facultyInvolved) && facultyInvolved.length === 0) facultyInvolved = "NA";
  if (!facultyInvolved) facultyInvolved = "NA";

  let teamMembers = body.teamMembers;
  if (typeof teamMembers === "string") {
    try {
      teamMembers = JSON.parse(teamMembers);
    } catch {
      teamMembers = [];
    }
  }
  if (!Array.isArray(teamMembers)) teamMembers = [];

  let otherIndustries = body.otherIndustries ?? [];
  if (typeof otherIndustries === "string") {
    try {
      otherIndustries = JSON.parse(otherIndustries);
    } catch {
      otherIndustries = [];
    }
  }
  if (!Array.isArray(otherIndustries)) otherIndustries = [];

  let technologiesUtilized = body.technologiesUtilized ?? [];
  if (typeof technologiesUtilized === "string") {
    try {
      technologiesUtilized = JSON.parse(technologiesUtilized);
    } catch {
      technologiesUtilized = [];
    }
  }
  if (!Array.isArray(technologiesUtilized)) technologiesUtilized = [];

  let externalFundingRaw = body.externalFunding ?? [];
  if (typeof externalFundingRaw === "string") {
    try {
      const parsed = JSON.parse(externalFundingRaw);
      externalFundingRaw = Array.isArray(parsed) ? parsed : [];
    } catch {
      externalFundingRaw = [];
    }
  }
  const externalFunding: unknown[] | null = Array.isArray(externalFundingRaw) && externalFundingRaw.length === 0
    ? null
    : Array.isArray(externalFundingRaw)
      ? externalFundingRaw
      : [];

  // Normalize Yes/No fields for check constraints (valid_has_*, valid_*, etc.)
  const yesNo = (v: unknown) => (v === "Yes" ? "Yes" : "No");

  return {
    email: body.email ?? "",
    team_name: body.teamName ?? "",
    your_name: body.yourName ?? "",
    is_iitm: yesNo(body.isIITM),
    roll_number: body.rollNumber ?? "",
    college_name: body.collegeName ?? null,
    current_occupation: body.currentOccupation ?? null,
    phone_number: body.phoneNumber ?? "",
    channel: body.channel ?? "",
    channel_other: body.channelOther ?? null,
    co_founders_count: Math.max(0, parseInt(String(body.coFoundersCount ?? "0"), 10) || 0),
    faculty_involved: facultyInvolved,
    prior_entrepreneurship_experience: yesNo(body.priorEntrepreneurshipExperience),
    team_prior_entrepreneurship_experience: yesNo(body.teamPriorEntrepreneurshipExperience),
    prior_experience_details: body.priorExperienceDetails ?? null,
    mca_registered: yesNo(body.mcaRegistered),
    external_funding: externalFunding,
    currently_incubated: body.currentlyIncubated ?? null,
    team_members: teamMembers,
    nirmaan_can_help: body.nirmaanCanHelp ?? "",
    pre_incubation_reason: body.preIncubationReason ?? "",
    heard_about_startups: body.heardAboutStartups ?? "",
    heard_about_nirmaan: body.heardAboutNirmaan ?? "",
    problem_solving: body.problemSolving ?? "",
    your_solution: body.yourSolution ?? "",
    solution_type: body.solutionType ?? "",
    solution_type_other: body.solutionTypeOther ?? null,
    target_industry: body.targetIndustry ?? "",
    other_industries: otherIndustries,
    industry_other: body.industryOther ?? null,
    other_industries_other: body.otherIndustriesOther ?? null,
    technologies_utilized: technologiesUtilized,
    other_technology_details: body.otherTechnologyDetails ?? null,
    startup_stage: body.startupStage ?? "",
    has_intellectual_property: yesNo(body.hasIntellectualProperty),
    has_potential_intellectual_property: yesNo(body.hasPotentialIntellectualProperty),
    ip_file_link: body.ipFileLink ?? null,
    potential_ip_file_link: body.potentialIpFileLink ?? null,
    nirmaan_presentation_link: body.nirmaanPresentationLink ?? "",
    has_proof_of_concept: yesNo(body.hasProofOfConcept),
    proof_of_concept_details: body.proofOfConceptDetails ?? null,
    has_patents_or_papers: yesNo(body.hasPatentsOrPapers),
    patents_or_papers_details: body.patentsOrPapersDetails ?? null,
    seed_fund_utilization_plan: body.seedFundUtilizationPlan ?? "",
    pitch_video_link: body.pitchVideoLink ?? "",
    document1_link: body.document1Link ?? null,
    document2_link: body.document2Link ?? null,
    status: "draft",
  };
}

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
      // Special handling for array fields
      if (field === 'teamMembers') {
        let teamMembersValue = body[field];
        if (typeof teamMembersValue === 'string') {
          try {
            teamMembersValue = JSON.parse(teamMembersValue);
          } catch {
            teamMembersValue = [];
          }
        }
        if (!Array.isArray(teamMembersValue) || teamMembersValue.length === 0) {
          return res.status(400).json({
            error: `Missing required field: ${field}. At least one team member is required.`,
          });
        }
      } else if (!body[field] || String(body[field]).trim() === "") {
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

    let facultyInvolved = body.facultyInvolved;
    if (typeof facultyInvolved === 'string') {
      try {
        facultyInvolved = JSON.parse(facultyInvolved);
        // If empty array, set to "NA" string as per requirement
        if (Array.isArray(facultyInvolved) && facultyInvolved.length === 0) {
          facultyInvolved = "NA";
        }
      } catch {
        facultyInvolved = "NA";
      }
    }
    // If it's already an array but empty, set to "NA"
    if (Array.isArray(facultyInvolved) && facultyInvolved.length === 0) {
      facultyInvolved = "NA";
    }
    // If undefined or null, set to "NA"
    if (!facultyInvolved) {
      facultyInvolved = "NA";
    }

    let teamMembers = body.teamMembers;
    if (typeof teamMembers === 'string') {
      try {
        teamMembers = JSON.parse(teamMembers);
      } catch {
        teamMembers = [];
      }
    }
    // Ensure it's an array
    if (!Array.isArray(teamMembers)) {
      teamMembers = [];
    }

    let externalFunding = body.externalFunding;
    if (typeof externalFunding === 'string') {
      try {
        externalFunding = JSON.parse(externalFunding);
      } catch {
        externalFunding = [];
      }
    }
    // Ensure it's an array
    if (!Array.isArray(externalFunding)) {
      externalFunding = [];
    }
    // If empty array, set to null
    if (Array.isArray(externalFunding) && externalFunding.length === 0) {
      externalFunding = null;
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
        college_name: body.collegeName || null,
        current_occupation: body.currentOccupation || null,
        phone_number: body.phoneNumber,
        channel: body.channel,
        channel_other: body.channelOther || null,
        co_founders_count: parseInt(body.coFoundersCount),
        faculty_involved: facultyInvolved || "NA",

        // Entrepreneurship Experience
        prior_entrepreneurship_experience: body.priorEntrepreneurshipExperience,
        team_prior_entrepreneurship_experience: body.teamPriorEntrepreneurshipExperience,
        prior_experience_details: body.priorExperienceDetails || null,

        // Startup Registration & Funding
        mca_registered: body.mcaRegistered,
        dpiit_details: body.dpiitDetails || null,
        external_funding: externalFunding || null,
        currently_incubated: body.currentlyIncubated || null,

        // Team Members
        team_members: teamMembers,

        // About Nirmaan Program
        nirmaan_can_help: body.nirmaanCanHelp,
        pre_incubation_reason: body.preIncubationReason,
        heard_about_startups: body.heardAboutStartups,
        heard_about_nirmaan: body.heardAboutNirmaan,

        // Problem & Solution
        problem_solving: body.problemSolving,
        your_solution: body.yourSolution,
        solution_type: body.solutionType,
        solution_type_other: body.solutionTypeOther || null,

        // Industry & Technologies
        target_industry: body.targetIndustry,
        other_industries: otherIndustries,
        industry_other: body.industryOther || null,
        other_industries_other: body.otherIndustriesOther || null,
        technologies_utilized: technologiesUtilized,
        other_technology_details: body.otherTechnologyDetails || null,

        // Startup Stage & IP (valid_has_ip constraint requires Yes/No)
        startup_stage: body.startupStage,
        has_intellectual_property: body.hasIntellectualProperty === "Yes" ? "Yes" : "No",
        has_potential_intellectual_property: body.hasPotentialIntellectualProperty === "Yes" ? "Yes" : "No",
        ip_file_link: body.ipFileLink || null,
        potential_ip_file_link: body.potentialIpFileLink || null,

        // Presentation & Proof
        nirmaan_presentation_link: body.nirmaanPresentationLink,
        has_proof_of_concept: body.hasProofOfConcept,
        proof_of_concept_details: body.proofOfConceptDetails || null,
        has_patents_or_papers: body.hasPatentsOrPapers === "Yes" ? "Yes" : "No",
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
   GET /api/applications/resume?token=xxx
   Resume draft by secure token (no auth required).
========================= */
router.get("/resume", async (req: Request, res: Response) => {
  try {
    console.log("[Backend] Draft resume GET received");
    const token = (req.query.token as string)?.trim();
    if (!token) {
      console.log("[Backend] Draft resume: missing token");
      return res.status(400).json({ error: "Missing token", details: "Resume link token is required." });
    }
    const tokenHash = hashToken(token);
    const { data: draft, error } = await supabase
      .from("new_application")
      .select("*")
      .eq("resume_token_hash", tokenHash)
      .eq("status", "draft")
      .single();

    if (error || !draft) {
      console.log("[Backend] Draft resume: not found or error", error?.message ?? "no draft");
      return res.status(404).json({ error: "Draft not found", details: "Invalid or expired resume link." });
    }
    if (draft.resume_token_expiry && new Date(draft.resume_token_expiry) < new Date()) {
      console.log("[Backend] Draft resume: link expired");
      return res.status(410).json({ error: "Link expired", details: "This resume link has expired." });
    }
    console.log("[Backend] Draft resume: success, draft id", draft.id);
    const { resume_token_hash, resume_token_expiry, ...safe } = draft;
    return res.json({ draft: safe });
  } catch (err) {
    console.error("[Backend] Draft resume error:", err);
    return res.status(500).json({ error: "Failed to load draft" });
  }
});

/* =========================
   POST /api/applications/draft
   Save draft (create or update). On first create: generate resume token, store hash+expiry, return token for email.
========================= */
router.post("/draft", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const applicationId = body.applicationId as string | undefined;
    const applicantId = (body.applicantId as string)?.trim() || null;
    const email = (body.email as string)?.trim() || "";
    console.log("[Backend] Draft POST received", {
      applicationId: applicationId ?? "(new)",
      applicantId: applicantId ?? "(none)",
      email: email ? `${email.slice(0, 3)}***` : "(empty)",
    });

    const payload = buildDraftPayload(body);

    if (applicationId) {
      console.log("[Backend] Draft POST: updating existing draft", applicationId);
      const { data, error } = await supabase
        .from("new_application")
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)
        .eq("status", "draft")
        .select()
        .single();

      if (error) {
        console.error("[Backend] Draft update error:", error);
        return res.status(500).json({ error: "Failed to save draft", details: error.message });
      }
      console.log("[Backend] Draft POST: update success", data.id);
      return res.json({ id: data.id, resumeToken: null, isNew: false });
    }

    console.log("[Backend] Draft POST: creating new draft");
    const resumeToken = crypto.randomBytes(RESUME_TOKEN_BYTES).toString("hex");
    const resumeTokenHash = hashToken(resumeToken);
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + RESUME_TOKEN_EXPIRY_DAYS);

    const { data, error } = await supabase
      .from("new_application")
      .insert({
        ...payload,
        resume_token_hash: resumeTokenHash,
        resume_token_expiry: expiry.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[Backend] Draft create error:", error);
      return res.status(500).json({ error: "Failed to save draft", details: error.message });
    }
    console.log("[Backend] Draft POST: create success", data.id, "resumeToken length", resumeToken.length);
    return res.json({
      id: data.id,
      resumeToken,
      resumeTokenExpiry: expiry.toISOString(),
      isNew: true,
    });
  } catch (err) {
    console.error("[Backend] Draft save error:", err);
    return res.status(500).json({ error: "Failed to save draft" });
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
