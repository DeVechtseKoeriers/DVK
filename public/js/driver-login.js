const msg = document.getElementById("msg");
const btn = document.getElementById("btnLogin");

function show(text) {
  msg.textContent = text;
}

async function ensureClient() {
  if (!window.supabaseClient) {
    show("Supabase client niet geladen. Controleer supabase-config.js pad.");
    throw new Error("supabaseClient missing");
  }
  return window.supabaseClient;
}

btn.addEventListener("click", async () => {
  try {
    show("Bezig met inloggen...");
    const supabaseClient = await ensureClient();

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
      show("Vul email en wachtwoord in.");
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      show("Login mislukt: " + error.message);
      return;
    }

    show("Ingelogd!");
    window.location.href = "/DVK/driver/dashboard.html";
  } catch (e) {
    console.error(e);
  }
});

// Als je al ingelogd bent: direct door
(async () => {
  try {
    const supabaseClient = await ensureClient();
    const { data } = await supabaseClient.auth.getSession();
    if (data?.session) window.location.href = "/DVK/driver/dashboard.html";
  } catch (e) {
    console.error(e);
  }
})();
