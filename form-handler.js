function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({ name: file.name, type: file.type, base64: reader.result.split(",")[1] });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleBetaFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const submitBtn = form.querySelector('[type="submit"]');
  const errorEl = document.getElementById("form-error");

  if (errorEl) errorEl.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Envoi en cours…";

  try {
    // Validate pain points (1-2 max)
    const painPoints = Array.from(
      form.querySelectorAll('input[name="pain_points"]:checked')
    ).map((el) => el.value);

    if (painPoints.length === 0) {
      throw new Error("Veuillez sélectionner au moins une inquiétude.");
    }
    if (painPoints.length > 2) {
      throw new Error("Veuillez sélectionner maximum 2 inquiétudes.");
    }

    // Encode files to base64
    const fileInput = form.querySelector('input[name="documents"]');
    const documents =
      fileInput && fileInput.files.length > 0
        ? await Promise.all(Array.from(fileInput.files).map(fileToBase64))
        : [];

    const payload = {
      prenom: form.prenom?.value.trim(),
      nom: form.nom?.value.trim(),
      email: form.email?.value.trim(),
      telephone: form.telephone?.value.trim(),
      linkedin: form.linkedin?.value.trim(),
      statut_achat: form.statut_achat?.value,
      lien_annonce: form.lien_annonce?.value.trim(),
      motivation: form.motivation?.value.trim(),
      painPoints,
      acceptTestimonial: form.engagement_temoignage?.checked || false,
      acceptGoogleReview: form.engagement_avis?.checked || false,
      acceptVideo: form.engagement_video?.checked || false,
      documents,
    };

    const response = await fetch("/.netlify/functions/submit-beta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Une erreur est survenue.");

    // Success
    form.style.display = "none";
    const successEl = document.getElementById("successMessage");
    if (successEl) {
      successEl.classList.add("show");
      successEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (err) {
    console.error("Form submission error:", err);
    if (errorEl) {
      errorEl.textContent = err.message || "Une erreur est survenue. Veuillez réessayer.";
    } else {
      alert(err.message);
    }
    submitBtn.disabled = false;
    submitBtn.textContent = "Envoyer ma candidature";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("betaForm");
  if (form) form.addEventListener("submit", handleBetaFormSubmit);
});
