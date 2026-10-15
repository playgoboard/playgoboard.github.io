// Player accounts: sign up, log in, forgotten password, profile, log out, delete account.
// Adds an account button to the top bar and a pop-up window, on every page that loads it.
// Other files can use window.GoAccounts to see who is logged in.
(function () {
  const config = window.GOBOARD_SUPABASE || {};
  const ready = Boolean(config.url && config.anonKey && window.supabase);
  const client = ready ? window.supabase.createClient(config.url, config.anonKey) : null;
  const USERNAME_RULE = /^[A-Za-z0-9_]{3,16}$/;
  const MIN_PASSWORD = 8;

  let session = null;
  let profile = null;
  let badge = 0;          // e.g. friend requests waiting; shown on the account button
  const listeners = [];
  const viewHooks = {};   // other files can fill in a view of the window (friends.js does)

  // ---- The button in the top bar and the pop-up window ----

  const accountButton = document.createElement("button");
  accountButton.className = "account-button";
  accountButton.type = "button";
  const soundButton = document.getElementById("btn-sound");
  soundButton.parentNode.insertBefore(accountButton, soundButton);

  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="dialog-close-row"><button class="dialog-close" aria-label="Close">✕</button></form>
    <div class="account-view" data-view="login">
      <h2>Log in</h2>
      <label>Email <input type="email" name="email" autocomplete="email" required></label>
      <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" data-action="login">Log in</button>
      <p class="account-links">
        <button class="link-button" data-go="signup">Create an account</button> ·
        <button class="link-button" data-go="forgot">Forgot password?</button>
      </p>
    </div>
    <div class="account-view" data-view="signup">
      <h2>Create an account</h2>
      <label>Username <input type="text" name="username" autocomplete="username" maxlength="16" placeholder="3–16 letters, numbers or _"></label>
      <label>Email <input type="email" name="email" autocomplete="email"></label>
      <label>Password <input type="password" name="password" autocomplete="new-password" placeholder="At least ${MIN_PASSWORD} characters"></label>
      <button class="btn btn-primary" data-action="signup">Create account</button>
      <p class="account-links"><button class="link-button" data-go="login">I already have an account</button></p>
    </div>
    <div class="account-view" data-view="forgot">
      <h2>Forgot your password?</h2>
      <p>We'll email you a link to choose a new one.</p>
      <label>Email <input type="email" name="email" autocomplete="email"></label>
      <button class="btn btn-primary" data-action="forgot">Send the link</button>
      <p class="account-links"><button class="link-button" data-go="login">Back to log in</button></p>
    </div>
    <div class="account-view" data-view="new-password">
      <h2>Choose a new password</h2>
      <label>New password <input type="password" name="password" autocomplete="new-password" placeholder="At least ${MIN_PASSWORD} characters"></label>
      <button class="btn btn-primary" data-action="new-password">Save password</button>
    </div>
    <div class="account-view" data-view="profile">
      <h2 class="profile-name"></h2>
      <div class="profile-stats"></div>
      <button class="btn btn-primary" data-go="friends">Friends <span class="friends-badge"></span></button>
      <a class="btn my-games" href="leaderboard.html">My games</a>
      <button class="btn" data-action="logout">Log out</button>
      <p class="account-links"><button class="link-button danger" data-go="delete">Delete my account</button></p>
    </div>
    <div class="account-view" data-view="friends"></div>
    <div class="account-view" data-view="delete">
      <h2>Delete your account?</h2>
      <p>This removes your account, username and rating for good. It can't be undone.
        Type your username to confirm.</p>
      <label>Username <input type="text" name="confirm" autocomplete="off"></label>
      <button class="btn btn-danger" data-action="delete">Delete my account</button>
      <p class="account-links"><button class="link-button" data-go="profile">Keep my account</button></p>
    </div>
    <p class="account-message" aria-live="polite"></p>
    <p class="account-footer"><a href="privacy.html">Privacy: what we store</a></p>`;
  document.body.append(dialog);

  const message = dialog.querySelector(".account-message");
  const field = (view, name) => dialog.querySelector(`[data-view="${view}"] [name="${name}"]`);

  function showView(view, note = "") {
    for (const el of dialog.querySelectorAll(".account-view")) el.hidden = el.dataset.view !== view;
    message.textContent = note;
    message.classList.remove("error");
    if (view === "profile") drawProfile();
    if (viewHooks[view]) viewHooks[view](dialog.querySelector(`[data-view="${view}"]`));
    if (!dialog.open) dialog.showModal();
  }

  function showError(text) {
    message.textContent = text;
    message.classList.add("error");
  }

  function busy(button, on) {
    button.disabled = on;
    if (on) button.dataset.label = button.textContent;
    button.textContent = on ? "Please wait…" : button.dataset.label || button.textContent;
  }

  function drawButton() {
    if (!ready) {
      accountButton.hidden = true;
      return;
    }
    accountButton.hidden = false;
    const label = profile ? `${profile.username} · ${profile.rating}` : session ? "My account" : "Log in";
    accountButton.textContent = badge && session ? `${label} 🔔${badge}` : label;
    accountButton.title = !session ? "Log in or create an account"
      : badge ? "You have friend requests waiting" : "Your profile";
    dialog.querySelector(".friends-badge").textContent = badge ? `(${badge} new)` : "";
  }

  function drawProfile() {
    const box = dialog.querySelector(".profile-stats");
    dialog.querySelector(".profile-name").textContent = profile ? profile.username : "Your account";
    if (!profile) {
      box.textContent = "Loading your profile…";
      return;
    }
    dialog.querySelector(".my-games").href = `leaderboard.html?player=${encodeURIComponent(profile.username)}`;
    const since = new Date(profile.created_at).toLocaleDateString();
    box.innerHTML = "";
    for (const [label, value] of [
      ["Rating", profile.rating], ["Rated games", profile.games],
      ["Wins", profile.wins], ["Losses", profile.losses], ["Member since", since],
    ]) {
      const row = document.createElement("div");
      const name = document.createElement("span");
      const number = document.createElement("b");
      name.textContent = label;
      number.textContent = value;
      row.append(name, number);
      box.append(row);
    }
  }

  // Supabase's error messages are technical; these are friendlier.
  function friendly(error) {
    const text = (error && error.message) || String(error);
    if (/invalid login credentials/i.test(text)) return "Wrong email or password.";
    if (/email not confirmed/i.test(text)) return "Please confirm your email first. Check your inbox (and spam folder) for our email.";
    if (/already registered|already been registered/i.test(text)) return "There's already an account with that email. Try logging in.";
    if (/rate limit|too many/i.test(text)) return "Too many tries. Please wait a few minutes and try again.";
    if (/password/i.test(text) && /least|short|weak/i.test(text)) return `Please use a longer password (at least ${MIN_PASSWORD} characters).`;
    if (/failed to fetch|network/i.test(text)) return "Can't reach the server. Check your internet connection.";
    return `Something went wrong: ${text}`;
  }

  const homeAddress = () => window.location.origin + window.location.pathname;

  // ---- Actions ----

  const actions = {
    async login(button) {
      const email = field("login", "email").value.trim(), password = field("login", "password").value;
      if (!email || !password) return showError("Please fill in your email and password.");
      busy(button, true);
      const { error } = await client.auth.signInWithPassword({ email, password });
      busy(button, false);
      if (error) return showError(friendly(error));
      dialog.close();
    },

    async signup(button) {
      const username = field("signup", "username").value.trim();
      const email = field("signup", "email").value.trim();
      const password = field("signup", "password").value;
      if (!USERNAME_RULE.test(username)) return showError("Usernames are 3–16 letters, numbers or _ (no spaces).");
      if (window.GoChatFilter && window.GoChatFilter.cleanMessage(username) !== username) {
        return showError("Please pick a friendlier username.");
      }
      if (!email) return showError("Please enter your email.");
      if (password.length < MIN_PASSWORD) return showError(`Please use a password of at least ${MIN_PASSWORD} characters.`);
      busy(button, true);
      const free = await client.rpc("username_available", { name: username });
      if (free.error) { busy(button, false); return showError(friendly(free.error)); }
      if (!free.data) { busy(button, false); return showError("That username is taken. Try another one."); }
      const { data, error } = await client.auth.signUp({
        email, password, options: { data: { username }, emailRedirectTo: homeAddress() },
      });
      busy(button, false);
      if (error) return showError(friendly(error));
      if (data.session) return dialog.close(); // email confirmation is switched off
      showView("login", `Almost done! We sent a confirmation link to ${email}. Click it, then log in here.`);
      field("login", "email").value = email;
    },

    async forgot(button) {
      const email = field("forgot", "email").value.trim();
      if (!email) return showError("Please enter your email.");
      busy(button, true);
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: homeAddress() });
      busy(button, false);
      if (error) return showError(friendly(error));
      showView("login", "If that email has an account, a link to reset the password is on its way.");
    },

    async "new-password"(button) {
      const password = field("new-password", "password").value;
      if (password.length < MIN_PASSWORD) return showError(`Please use at least ${MIN_PASSWORD} characters.`);
      busy(button, true);
      const { error } = await client.auth.updateUser({ password });
      busy(button, false);
      if (error) return showError(friendly(error));
      showView("profile", "Your new password is saved.");
    },

    async logout() {
      await client.auth.signOut();
      dialog.close();
    },

    async delete(button) {
      if (!profile || field("delete", "confirm").value.trim().toLowerCase() !== profile.username.toLowerCase()) {
        return showError("Type your username exactly to confirm.");
      }
      busy(button, true);
      const { error } = await client.rpc("delete_my_account");
      busy(button, false);
      if (error) return showError(friendly(error));
      await client.auth.signOut();
      showView("login", "Your account was deleted.");
    },
  };

  dialog.addEventListener("click", (event) => {
    const go = event.target.closest("[data-go]");
    if (go) return showView(go.dataset.go);
    const action = event.target.closest("[data-action]");
    if (action && actions[action.dataset.action]) actions[action.dataset.action](action);
  });
  // Enter in a field presses that view's main button.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.target.matches("input")) return;
    const mainButton = event.target.closest(".account-view").querySelector("[data-action], [data-main]");
    if (!mainButton) return;
    event.preventDefault();
    mainButton.click();
  });

  accountButton.addEventListener("click", () => showView(session ? "profile" : "login"));

  // ---- Keeping track of who is logged in ----

  async function loadProfile() {
    if (!session) {
      profile = null;
      return;
    }
    const { data } = await client.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    profile = data || null;
  }

  function announce() {
    drawButton();
    if (dialog.open && !dialog.querySelector('[data-view="profile"]').hidden) drawProfile();
    for (const fn of listeners) fn({ session, profile });
  }

  if (ready) {
    client.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
      if (event === "PASSWORD_RECOVERY") setTimeout(() => showView("new-password"), 0);
      // Supabase asks not to call it again inside this callback, so load the profile right after.
      setTimeout(async () => { await loadProfile(); announce(); }, 0);
    });
  }
  drawButton();

  window.GoAccounts = {
    ready,
    client,
    current: () => ({ session, profile }),
    onChange(fn) { listeners.push(fn); },
    async refreshProfile() { await loadProfile(); announce(); },
    // For other files: fill a view of the window when it opens, switch views, show a count on the button.
    onView(view, fn) { viewHooks[view] = fn; },
    showView,
    setBadge(count) { badge = count; drawButton(); },
  };
})();
