import { Router, Request, Response } from "express";
import { supabase } from "../lib/supabase";
import crypto from "crypto";
import nodemailer from "nodemailer";

const router = Router();

/**
 * Generate a random password
 */
function generateRandomPassword(length = 12): string {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*";
  const allChars = uppercase + lowercase + numbers + symbols;

  let password = "";
  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += symbols[Math.floor(Math.random() * symbols.length)];

  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle the password
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

/**
 * Send welcome email with credentials
 * Using Gmail SMTP via Nodemailer
 */
async function sendWelcomeEmail(
  email: string,
  password: string,
  fullName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Log credentials to console for backup
    console.log(`
      =====================================
      NEW USER CREATED
      =====================================
      Name: ${fullName}
      Email: ${email}
      Password: ${password}
      
      Login URL: ${process.env.APP_URL || "http://localhost:3000"}/login
      =====================================
    `);

    // Configure email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER || "wraptron@gmail.com",
        pass: process.env.GMAIL_APP_PASSWORD, // App-specific password
      },
    });

    // Email template based on the provided format
    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #fff; }
          .footer { padding: 20px; text-align: center; color: #666; font-size: 12px; }
          .credentials { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #4CAF50; margin: 20px 0; }
          .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Registration for New Users</h2>
          </div>
          <div class="content">
            <h3>Welcome to Nirmaan Pre-Incubation Program</h3>
            
            <p>Dear ${fullName},</p>
            
            <p>You have been onboarded as a user on the platform for <strong>Nirmaan Pre-Incubation Program</strong>!</p>
            
            <p>Please click the button below to manage your account:</p>
            
            <p style="text-align: center;">
              <a href="${process.env.APP_URL || "http://localhost:3000"}/login" class="button">Login to Your Account</a>
            </p>
            
            <div class="credentials">
              <p><strong>Your Login Credentials:</strong></p>
              <p><strong>Email ID (Login ID):</strong> ${email}</p>
              <p><strong>Default Password:</strong> ${password}</p>
            </div>
            
            <p><strong>Important:</strong> Please change your password after your first login for security purposes.</p>
            
            <p>Thanks,<br>
            Team Nirmaan</p>
          </div>
          <div class="footer">
            <p>This is an automated message. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailText = `
Registration for New Users

Welcome to Nirmaan Pre-Incubation Program

Dear ${fullName},

You have been onboarded as a user on the platform for Nirmaan Pre-Incubation Program!

Please visit ${process.env.APP_URL || "http://localhost:3000"}/login to manage your account.

Your email ID is your login ID and your default password is ${password}.

Please change your password after your first login for security purposes.

Thanks,
Team Nirmaan
    `;

    // Send email
    const info = await transporter.sendMail({
      from: `"Nirmaan Pre-Incubation" <${process.env.GMAIL_USER || "wraptron@gmail.com"}>`,
      to: email,
      subject: "Welcome to Nirmaan Pre-Incubation Program",
      text: emailText,
      html: emailHTML,
    });

    console.log(`✅ Email sent successfully to ${email} - Message ID: ${info.messageId}`);
    return { success: true };
  } catch (error: any) {
    console.error("❌ Error sending email:", error);
    return { success: false, error: error.message };
  }
}

/* =========================
   POST /api/users
   Create a new user
========================= */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { email, fullName, role } = req.body;

    // Validate required fields
    if (!email || !fullName || !role) {
      return res.status(400).json({
        error: "Missing required fields: email, fullName, and role are required",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "Invalid email format",
      });
    }

    // Validate role
    const validRoles = ["manager", "reviewer"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: "Invalid role. Must be 'manager' or 'reviewer'",
      });
    }

    // Generate random password
    const password = generateRandomPassword(12);

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: fullName,
        role,
      },
    });

    if (authError) {
      console.error("Auth error:", authError);
      return res.status(500).json({
        error: "Failed to create user account",
        details: authError.message,
      });
    }

    if (!authData.user) {
      return res.status(500).json({
        error: "Failed to create user account - no user data returned",
      });
    }

    // Create or update user profile in database (using upsert in case trigger already created it)
    const { data: profileData, error: profileError } = await supabase
      .from("user_profiles")
      .upsert({
        id: authData.user.id,
        email_address: email,
        full_name: fullName,
        role,
      }, {
        onConflict: 'id'
      })
      .select()
      .single();

    if (profileError) {
      console.error("Profile creation error:", profileError);
      
      // If profile creation fails, delete the auth user to maintain consistency
      await supabase.auth.admin.deleteUser(authData.user.id);
      
      return res.status(500).json({
        error: "Failed to create user profile",
        details: profileError.message,
      });
    }

    // Send welcome email with credentials
    const emailResult = await sendWelcomeEmail(email, password, fullName);
    
    if (!emailResult.success) {
      console.warn("Email sending failed, but user was created:", emailResult.error);
    }

    return res.status(201).json({
      message: "User created successfully",
      data: {
        id: profileData.id,
        email: profileData.email_address || email,
        fullName: profileData.full_name,
        role: profileData.role,
        password, // Return password in response so manager can manually share if email fails
        emailSent: emailResult.success,
      },
    });
  } catch (error: any) {
    console.error("POST /api/users error:", error);
    return res.status(500).json({
      error: "Failed to create user",
      details: error.message,
    });
  }
});

/* =========================
   GET /api/users
   Get all users
========================= */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Fetch users error:", error);
      return res.status(500).json({
        error: "Failed to fetch users",
        details: error.message,
      });
    }

    return res.json({
      users: data || [],
    });
  } catch (error: any) {
    console.error("GET /api/users error:", error);
    return res.status(500).json({
      error: "Failed to fetch users",
      details: error.message,
    });
  }
});

/* =========================
   PUT /api/users/change-password
   Change user password
========================= */
router.put("/change-password", async (req: Request, res: Response) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    // Validate required fields
    if (!userId || !newPassword) {
      return res.status(400).json({
        error: "Missing required fields: userId and newPassword are required",
      });
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    // Update password in Supabase Auth
    const { data, error } = await supabase.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (error) {
      console.error("Password update error:", error);
      return res.status(500).json({
        error: "Failed to update password",
        details: error.message,
      });
    }

    console.log(`✅ Password updated successfully for user: ${userId}`);

    return res.json({
      message: "Password updated successfully",
    });
  } catch (error: any) {
    console.error("PUT /api/users/change-password error:", error);
    return res.status(500).json({
      error: "Failed to change password",
      details: error.message,
    });
  }
});

/* =========================
   DELETE /api/users/:id
   Delete a user
========================= */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Delete from auth
    const { error: authError } = await supabase.auth.admin.deleteUser(id);

    if (authError) {
      console.error("Auth delete error:", authError);
      return res.status(500).json({
        error: "Failed to delete user from auth",
        details: authError.message,
      });
    }

    // Delete from user_profiles (should cascade automatically if FK is set up)
    const { error: profileError } = await supabase
      .from("user_profiles")
      .delete()
      .eq("id", id);

    if (profileError) {
      console.error("Profile delete error:", profileError);
      return res.status(500).json({
        error: "Failed to delete user profile",
        details: profileError.message,
      });
    }

    return res.json({
      message: "User deleted successfully",
    });
  } catch (error: any) {
    console.error("DELETE /api/users/:id error:", error);
    return res.status(500).json({
      error: "Failed to delete user",
      details: error.message,
    });
  }
});

export default router;
