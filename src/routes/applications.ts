import { Router, Request, Response } from "express";
import nodemailer from "nodemailer";
import { supabase } from "../lib/supabase";

const router = Router();

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Number of days after which a pending reviewer invite is auto-rejected */
const REVIEWER_INVITE_EXPIRE_DAYS = 2;

/**
 * Auto-reject reviewer invites that have been pending for more than REVIEWER_INVITE_EXPIRE_DAYS.
 * Run periodically (e.g. hourly) from the server.
 */
export async function expirePendingReviewerInvites(): Promise<{
  updated: number;
  error?: string;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - REVIEWER_INVITE_EXPIRE_DAYS);
  const cutoffIso = cutoff.toISOString();

  const { data: pendingRows, error: selectError } = await supabase
    .from("application_reviewers")
    .select("id")
    .eq("invite_status", "pending")
    .lt("invited_at", cutoffIso);

  if (selectError) {
    console.error("expirePendingReviewerInvites select error:", selectError);
    return { updated: 0, error: selectError.message };
  }

  if (!pendingRows?.length) {
    return { updated: 0 };
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("application_reviewers")
    .update({
      invite_status: "rejected",
      responded_at: now,
    })
    .eq("invite_status", "pending")
    .lt("invited_at", cutoffIso)
    .select("id, application_id, reviewer_id");

  if (updateError) {
    console.error("expirePendingReviewerInvites update error:", updateError);
    return { updated: 0, error: updateError.message };
  }

  const count = updated?.length ?? 0;
  if (count > 0) {
    console.log(`[cron] Auto-rejected ${count} pending reviewer invite(s) (older than ${REVIEWER_INVITE_EXPIRE_DAYS} days).`);
    // Notify managers for each auto-rejected invite
    for (const row of updated ?? []) {
      const { application_id, reviewer_id } = row as { application_id: string; reviewer_id: string };
      if (!application_id || !reviewer_id) continue;
      const { data: app } = await supabase
        .from("new_application")
        .select("team_name")
        .eq("id", application_id)
        .single();
      const { data: reviewer } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", reviewer_id)
        .single();
      const { data: managers } = await supabase
        .from("user_profiles")
        .select("email_address")
        .eq("role", "manager")
        .not("email_address", "is", null);
      const emails = (managers ?? []).map((m) => m.email_address).filter(Boolean) as string[];
      if (emails.length) {
        await sendManagerReviewerResponseEmail(
          emails,
          reviewer?.full_name ?? "Reviewer",
          app?.team_name ?? "Startup",
          application_id,
          false,
          true
        );
      }
    }
  }
  return { updated: count };
}

async function sendReviewerInviteEmail(
  toEmail: string,
  reviewerName: string,
  startupName: string,
  applicationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
      console.warn(
        "GMAIL_USER or GMAIL_APP_PASSWORD not set – reviewer invite email skipped. Set both in .env to send emails."
      );
      return { success: false, error: "Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD)" };
    }

    const appUrl = process.env.APP_URL || "https://traktor.sieiitm.org";
    const loginLink = `${appUrl}/login`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #fff; }
          .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Reviewer Assignment – Nirmaan Pre-Incubation</h2>
          </div>
          <div class="content">
            <p>Dear ${reviewerName},</p>
            <p>You have been assigned to review the following startup application:</p>
            <p><strong>Startup: ${startupName}</strong></p>
            <p>Please log in to accept or decline this assignment and submit your evaluation.</p>
            <p>
              <a href="${loginLink}" class="button">Login</a>
            </p>
            <p>Thanks,<br>Team Nirmaan</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"Nirmaan Pre-Incubation" <${gmailUser}>`,
      to: toEmail,
      subject: `You have been assigned to review: ${startupName}`,
      html: emailHTML,
      text: `Dear ${reviewerName},\n\nYou have been assigned to review the startup: ${startupName}.\n\nLog in here: ${loginLink}\n\nThanks,\nTeam Nirmaan`,
    });

    return { success: true };
  } catch (error: any) {
    console.error("❌ Error sending reviewer invite email:", error);
    return { success: false, error: error.message };
  }
}

/** Send email to managers when a reviewer accepts/rejects or invite is auto-rejected */
async function sendManagerReviewerResponseEmail(
  managerEmails: string[],
  reviewerName: string,
  startupName: string,
  applicationId: string,
  accepted: boolean,
  autoRejected?: boolean
): Promise<{ success: boolean; error?: string }> {
  if (!managerEmails.length) return { success: true };
  try {
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (!gmailUser || !gmailPass) {
      console.warn(
        "GMAIL_USER or GMAIL_APP_PASSWORD not set – manager notification email skipped."
      );
      return { success: false, error: "Email not configured" };
    }

    const appUrl = process.env.APP_URL || "https://traktor.sieiitm.org";
    const applicationLink = `${appUrl}/dashboard/applications/${applicationId}`;

    let subject: string;
    let message: string;
    if (autoRejected) {
      subject = `Reviewer invite auto-expired: ${reviewerName} – ${startupName}`;
      message = `The evaluation request for <strong>${reviewerName}</strong> for the startup <strong>${startupName}</strong> was automatically rejected after ${REVIEWER_INVITE_EXPIRE_DAYS} days (no response). Please assign a new reviewer if needed.`;
    } else {
      subject = accepted
        ? `Reviewer accepted: ${reviewerName} – ${startupName}`
        : `Reviewer declined: ${reviewerName} – ${startupName}`;
      message = accepted
        ? `The reviewer <strong>${reviewerName}</strong> has <strong>accepted</strong> the evaluation request for the startup <strong>${startupName}</strong>.`
        : `The reviewer <strong>${reviewerName}</strong> has <strong>declined</strong> the evaluation request for the startup <strong>${startupName}</strong>. Please assign another reviewer if needed.`;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #fff; }
          .button { display: inline-block; padding: 10px 20px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Evaluation Request Update – Nirmaan Pre-Incubation</h2>
          </div>
          <div class="content">
            <p>${message}</p>
            <p><a href="${applicationLink}" class="button">View application</a></p>
            <p>Thanks,<br>Team Nirmaan</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const toList = managerEmails.filter(Boolean).join(", ");
    await transporter.sendMail({
      from: `"Nirmaan Pre-Incubation" <${gmailUser}>`,
      to: toList,
      subject,
      html: emailHTML,
      text: message.replace(/<[^>]*>/g, "") + `\nView application: ${applicationLink}`,
    });

    return { success: true };
  } catch (error: any) {
    console.error("❌ Error sending manager reviewer-response email:", error);
    return { success: false, error: error.message };
  }
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
        dpiit_registered: body.dpiitRegistered || null,
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

        // Startup Stage & IP
        startup_stage: body.startupStage,
        has_intellectual_property: body.hasIntellectualProperty,
        has_potential_intellectual_property: body.hasPotentialIntellectualProperty,
        ip_file_link: body.ipFileLink || null,
        potential_ip_file_link: body.potentialIpFileLink || null,

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
   POST /api/applications/:id/invite-reviewer
   Manager invites one reviewer; sends email and creates assignment (pending).
========================= */
router.post("/:id/invite-reviewer", async (req: Request, res: Response) => {
  try {
    const { id: applicationId } = req.params;
    const { reviewerId } = req.body;

    if (
      !applicationId ||
      !uuidRegex.test(applicationId) ||
      !reviewerId ||
      !uuidRegex.test(reviewerId)
    ) {
      return res.status(400).json({
        error: "Valid application ID and reviewer ID are required",
      });
    }

    const { data: application, error: appError } = await supabase
      .from("new_application")
      .select("id, status, team_name")
      .eq("id", applicationId)
      .single();

    if (appError || !application) {
      return res.status(404).json({ error: "Application not found" });
    }

    if (application.status !== "pending") {
      return res.status(400).json({
        error: "Reviewer can only be invited for applications in pending status",
      });
    }

    const { data: reviewer, error: reviewerError } = await supabase
      .from("user_profiles")
      .select("id, full_name, email_address")
      .eq("id", reviewerId)
      .eq("role", "reviewer")
      .single();

    if (reviewerError || !reviewer) {
      return res.status(400).json({
        error: "Reviewer not found or not a reviewer",
      });
    }

    const { data: existing } = await supabase
      .from("application_reviewers")
      .select("id")
      .eq("application_id", applicationId)
      .eq("reviewer_id", reviewerId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: "This reviewer is already assigned to this application",
      });
    }

    const invitedAt = new Date().toISOString();
    const { error: insertError } = await supabase
      .from("application_reviewers")
      .insert({
        application_id: applicationId,
        reviewer_id: reviewerId,
        invite_status: "pending",
        invited_at: invitedAt,
      });

    if (insertError) {
      console.error("Insert application_reviewers error:", insertError);
      const hint = insertError.message?.includes("invite_status") ||
        insertError.message?.includes("invited_at")
        ? " Run the migration: supabase_application_reviewers_invite.sql (add invite_status, invited_at, responded_at to application_reviewers)."
        : "";
      return res.status(500).json({
        error: "Failed to assign reviewer",
        details: (insertError.message || String(insertError)) + hint,
      });
    }

    const emailResult = await sendReviewerInviteEmail(
      reviewer.email_address || "",
      reviewer.full_name || "Reviewer",
      application.team_name || "Startup",
      applicationId
    );

    if (!emailResult.success) {
      console.warn("Invite email failed but assignment created:", emailResult.error);
    }

    // Keep status as pending until at least 2 reviewers have accepted (handled in reviewer-respond)

    return res.status(201).json({
      message: "Reviewer invited successfully",
      emailSent: emailResult.success,
    });
  } catch (error: any) {
    console.error("POST invite-reviewer error:", error);
    return res.status(500).json({
      error: "Failed to invite reviewer",
      details: error?.message || String(error),
    });
  }
});

/* =========================
   POST /api/applications/:id/reviewer-respond
   Reviewer accepts or rejects the assignment. Sends manager notification email.
========================= */
router.post("/:id/reviewer-respond", async (req: Request, res: Response) => {
  try {
    const { id: applicationId } = req.params;
    const accept = req.body.accept === true;

    if (!applicationId || !uuidRegex.test(applicationId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }

    const authHeader = req.headers.authorization;
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return res.status(401).json({
        error: "Authorization required (Bearer token)",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({
        error: "Invalid or expired token",
      });
    }

    const reviewerId = user.id;

    const { error: updateError } = await supabase
      .from("application_reviewers")
      .update({
        invite_status: accept ? "accepted" : "rejected",
        responded_at: new Date().toISOString(),
      })
      .eq("application_id", applicationId)
      .eq("reviewer_id", reviewerId);

    if (updateError) {
      return res.status(500).json({
        error: "Failed to update response",
        details: updateError.message,
      });
    }

    if (accept) {
      const { data: acceptedRows } = await supabase
        .from("application_reviewers")
        .select("id")
        .eq("application_id", applicationId)
        .eq("invite_status", "accepted");

      if (acceptedRows && acceptedRows.length >= 2) {
        await supabase
          .from("new_application")
          .update({ status: "under_review" })
          .eq("id", applicationId);
      }
    }

    // Notify managers
    const { data: application } = await supabase
      .from("new_application")
      .select("team_name")
      .eq("id", applicationId)
      .single();
    const { data: reviewer } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", reviewerId)
      .single();
    const { data: managers } = await supabase
      .from("user_profiles")
      .select("email_address")
      .eq("role", "manager")
      .not("email_address", "is", null);
    const managerEmails = (managers ?? []).map((m) => m.email_address).filter(Boolean) as string[];
    if (managerEmails.length) {
      await sendManagerReviewerResponseEmail(
        managerEmails,
        reviewer?.full_name ?? "Reviewer",
        application?.team_name ?? "Startup",
        applicationId,
        accept,
        false
      );
    }

    return res.status(200).json({
      message: accept
        ? "You have accepted the assignment"
        : "You have declined the assignment",
      accepted: accept,
    });
  } catch (error: any) {
    console.error("POST reviewer-respond error:", error);
    return res.status(500).json({
      error: "Failed to update response",
      details: error?.message || String(error),
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
