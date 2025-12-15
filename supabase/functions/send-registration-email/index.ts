import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RegistrationEmailRequest {
  name: string;
  email: string;
  registrationId: string;
  verificationToken: string;
}

// Simple input validation
function validateInput(data: RegistrationEmailRequest): string | null {
  if (!data.name || typeof data.name !== 'string' || data.name.length > 200) {
    return "Invalid name";
  }
  if (!data.email || typeof data.email !== 'string' || data.email.length > 254) {
    return "Invalid email";
  }
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(data.email)) {
    return "Invalid email format";
  }
  if (!data.registrationId || typeof data.registrationId !== 'string') {
    return "Invalid registration ID";
  }
  if (!data.verificationToken || typeof data.verificationToken !== 'string') {
    return "Invalid verification token";
  }
  return null;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestData: RegistrationEmailRequest = await req.json();

    // Validate input
    const validationError = validateInput(requestData);
    if (validationError) {
      console.error("Validation error:", validationError);
      return new Response(
        JSON.stringify({ error: validationError }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { name, email, registrationId, verificationToken } = requestData;

    // Initialize Supabase client to verify registration exists
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the registration exists and matches the provided data
    const { data: registration, error: regError } = await supabase
      .from("registrations")
      .select("id, email, full_name, verified, verification_token, created_at")
      .eq("id", registrationId)
      .maybeSingle();

    if (regError) {
      console.error("Database error:", regError);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!registration) {
      console.error("Registration not found:", registrationId);
      return new Response(
        JSON.stringify({ error: "Registration not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify the email and token match the registration
    if (registration.email !== email || registration.verification_token !== verificationToken) {
      console.error("Email or token mismatch for registration:", registrationId);
      return new Response(
        JSON.stringify({ error: "Invalid request" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if already verified
    if (registration.verified) {
      console.log("Registration already verified:", registrationId);
      return new Response(
        JSON.stringify({ error: "Email already verified" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Rate limiting: Check if registration was created within last 60 seconds (prevents rapid resends)
    const createdAt = new Date(registration.created_at);
    const now = new Date();
    const secondsSinceCreation = (now.getTime() - createdAt.getTime()) / 1000;
    
    // Only apply rate limit if this is not the initial email (created more than 5 seconds ago)
    // This allows the initial registration email to go through
    if (secondsSinceCreation > 5 && secondsSinceCreation < 60) {
      console.log("Rate limited - too soon to resend:", registrationId);
      return new Response(
        JSON.stringify({ error: "Please wait before requesting another email" }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Sending verification email to: ${email}`);

    // Get the app URL from environment or use default
    const appUrl = Deno.env.get("APP_URL") || "https://register.uslaccafrica.org";
    const verificationLink = `${appUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;

    const client = new SMTPClient({
      connection: {
        hostname: "smtp-relay.brevo.com",
        port: 587,
        tls: true,
        auth: {
          username: Deno.env.get("BREVO_SMTP_LOGIN") || "",
          password: Deno.env.get("BREVO_SMTP_PASSWORD") || "",
        },
      },
    });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <tr>
      <td>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #22c55e 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">📧 Verify Your Email</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 20px; font-size: 18px; color: #1f2937;">
                Dear <strong>${name.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</strong>,
              </p>
              
              <p style="margin: 0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6;">
                Thank you for registering for the <strong>Digital Skills Mastery Course</strong>! Please verify your email address to complete your registration.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationLink}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #22c55e 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 18px; font-weight: 600;">
                  Verify Email Address
                </a>
              </div>
              
              <p style="margin: 20px 0; font-size: 14px; color: #6b7280; text-align: center;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 30px; font-size: 12px; color: #3b82f6; word-break: break-all; text-align: center;">
                ${verificationLink}
              </p>
              
              <div style="background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h2 style="margin: 0 0 15px; font-size: 18px; color: #1e40af;">📅 Training Dates</h2>
                <p style="margin: 0; font-size: 20px; font-weight: 600; color: #1f2937;">December 1 - December 26, 2025</p>
              </div>
              
              <h3 style="margin: 25px 0 15px; font-size: 18px; color: #1f2937;">📚 Your Course Bundle Includes:</h3>
              
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="font-size: 20px;">🌐</span>
                    <span style="margin-left: 12px; font-size: 15px; color: #374151;">Introduction to WordPress Website Development</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
                    <span style="font-size: 20px;">📱</span>
                    <span style="margin-left: 12px; font-size: 15px; color: #374151;">Introduction to Digital Marketing</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0;">
                    <span style="font-size: 20px;">🤖</span>
                    <span style="margin-left: 12px; font-size: 15px; color: #374151;">Introduction to AI Automation for Businesses</span>
                  </td>
                </tr>
              </table>
              
              <div style="background-color: #fef3c7; border: 1px solid #f59e0b; padding: 15px; margin: 25px 0; border-radius: 8px;">
                <p style="margin: 0; font-size: 14px; color: #92400e;">
                  ⚠️ This verification link will expire in 24 hours. If you did not register for this course, please ignore this email.
                </p>
              </div>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 10px; font-size: 16px; font-weight: 600; color: #1f2937;">Dependify LLC</p>
              <p style="margin: 0; font-size: 14px; color: #6b7280;">In partnership with USLACC</p>
              <p style="margin: 15px 0 0; font-size: 12px; color: #9ca3af;">
                © 2025 Dependify LLC. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    await client.send({
      from: "Digital Skills Training <noreply@dependify.com>",
      to: email,
      subject: "📧 Verify Your Email - Digital Skills Mastery Course",
      content: "auto",
      html: htmlContent,
    });

    await client.close();

    console.log("Verification email sent successfully to:", email);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending registration email:", error);
    return new Response(
      JSON.stringify({ error: "Failed to send email" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
