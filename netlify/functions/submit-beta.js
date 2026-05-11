const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const BUCKET = "beta-documents";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const {
    prenom,
    nom,
    email,
    telephone,
    linkedin,
    statut_achat,
    lien_annonce,
    motivation,
    painPoints,
    acceptTestimonial,
    acceptGoogleReview,
    acceptVideo,
    documents,
  } = body;

  // Upload files to Supabase Storage, collect paths
  const uploadedPaths = [];
  if (Array.isArray(documents) && documents.length > 0) {
    for (const doc of documents) {
      const { name, type, base64 } = doc;
      const buffer = Buffer.from(base64, "base64");
      const timestamp = Date.now();
      const safeName = name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${email}/${timestamp}_${safeName}`;

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, buffer, { contentType: type, upsert: false });

      if (error) {
        console.error("Storage upload error:", error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: `Erreur upload fichier : ${name}` }),
        };
      }

      uploadedPaths.push(path);
    }
  }

  // Insert — matches table schema exactly
  const { data: candidate, error: dbError } = await supabase
    .from("beta_candidates")
    .insert({
      first_name: prenom,
      last_name: nom,
      email,
      phone: telephone || null,
      linkedin_url: linkedin || null,
      purchase_status: statut_achat,
      listing_url: lien_annonce || null,
      purchase_type: "non_renseigne",
      motivation,
      pain_points: painPoints || [],
      accept_testimonial: acceptTestimonial || false,
      accept_google_review: acceptGoogleReview || false,
      accept_call: false,
      accept_video: acceptVideo || false,
      uploaded_files: uploadedPaths,
    })
    .select()
    .single();

  if (dbError) {
    console.error("Database error:", dbError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Erreur lors de l'enregistrement" }),
    };
  }

  // Generate signed URLs (1h) for the notification email
  const signedLinks = await Promise.all(
    uploadedPaths.map(async (path) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);
      return { path, url: data?.signedUrl || null };
    })
  );

  // Build notification email
  const painPointsLabel =
    Array.isArray(painPoints) && painPoints.length > 0
      ? painPoints.join(", ")
      : "Aucun";

  const engagementsLabel =
    [
      acceptTestimonial && "Témoignage",
      acceptGoogleReview && "Avis Google",
      acceptVideo && "Vidéo",
    ]
      .filter(Boolean)
      .join(", ") || "Aucun";

  const filesHtml =
    signedLinks.length > 0
      ? signedLinks
          .map(
            ({ path, url }) =>
              `<li>${path.split("/").pop()}${url ? ` — <a href="${url}">Télécharger (1h)</a>` : ""}</li>`
          )
          .join("")
      : "<li>Aucun</li>";

  try {
    await resend.emails.send({
      from: "Navly Beta <no-reply@navly.fr>",
      to: process.env.NOTIFICATION_EMAIL,
      subject: `Nouvelle candidature beta — ${prenom} ${nom}`,
      html: `
        <h2>Nouvelle candidature beta Navly</h2>
        <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Nom</td><td style="padding:8px;border:1px solid #ddd;">${prenom} ${nom}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td><td style="padding:8px;border:1px solid #ddd;">${email}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Téléphone</td><td style="padding:8px;border:1px solid #ddd;">${telephone || "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">LinkedIn</td><td style="padding:8px;border:1px solid #ddd;">${linkedin || "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Statut d'achat</td><td style="padding:8px;border:1px solid #ddd;">${statut_achat || "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Annonce</td><td style="padding:8px;border:1px solid #ddd;">${lien_annonce || "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Motivation</td><td style="padding:8px;border:1px solid #ddd;">${motivation || "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Points de douleur</td><td style="padding:8px;border:1px solid #ddd;">${painPointsLabel}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Engagements</td><td style="padding:8px;border:1px solid #ddd;">${engagementsLabel}</td></tr>
        </table>
        <h3 style="margin-top:16px;">Documents (${signedLinks.length})</h3>
        <ul>${filesHtml}</ul>
        <p style="margin-top:16px;color:#666;font-size:12px;">Candidature ID : ${candidate.id} — ${new Date().toLocaleString("fr-FR")}</p>
      `,
    });
  } catch (emailError) {
    console.error("Email error:", emailError);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, id: candidate.id }),
  };
};
