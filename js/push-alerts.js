// Your-turn alerts: the on/off button in the account window. The database decides when to send them
// (supabase/25-push-alerts.sql) and sw.js shows them. Each device turns alerts on by itself.
(function () {
  const accounts = window.GoAccounts;
  if (!accounts || !accounts.ready) return;
  const client = accounts.client;
  const { t } = window.GoI18n;
  const errorText = (error) => t(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""));

  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isAppleTouch = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function keyBytes(text) {
    const plain = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
    return Uint8Array.from(plain, (c) => c.charCodeAt(0));
  }

  const currentSubscription = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();

  // Saves this device on the logged-in account.
  async function saveDevice(subscription) {
    const keys = subscription.toJSON().keys;
    const { error } = await client.rpc("push_subscribe", {
      p_endpoint: subscription.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
      p_lang: window.GO_LANG ? window.GO_LANG.lang : "en",
    });
    if (error) throw error;
  }

  async function turnOn() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return t("Alerts are blocked. You can allow them in your browser's settings for this site.");
    const { data: key, error } = await client.rpc("push_public_key");
    if (error) throw error;
    if (!key) return t("Alerts aren't ready yet. Please try again later.");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await saveDevice(subscription);
    return t("Alerts are on for this device.");
  }

  async function turnOff() {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const { error } = await client.rpc("push_unsubscribe", { p_endpoint: subscription.endpoint });
    if (error) throw error;
    await subscription.unsubscribe();
  }

  function draw(view) {
    let box = view.querySelector(".push-row");
    if (!box) {
      box = document.createElement("div");
      box.className = "push-row";
      view.querySelector(".two-step-row").before(box);
    }
    box.textContent = "";
    const status = document.createElement("span");
    status.className = "push-status";
    box.append(status);
    const note = document.createElement("p");
    note.className = "push-note";
    const action = (label, work) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link-button";
      b.textContent = label;
      b.addEventListener("click", async () => {
        b.disabled = true;
        note.textContent = "";
        let message = "";
        try { message = await work(); } catch (error) { message = errorText(error); }
        await refresh();
        note.textContent = message || "";
      });
      box.append(b);
    };
    const refresh = async () => {
      box.textContent = "";
      box.append(status);
      if (!supported()) {
        status.textContent = isAppleTouch()
          ? t("Alerts: on iPhone and iPad, add GoBoard to your Home Screen, then open it from there.")
          : t("Alerts: this browser can't show them.");
        return;
      }
      let subscription = null;
      try { subscription = await currentSubscription(); } catch { /* treated as off */ }
      if (subscription) {
        status.textContent = t("🔔 Alerts are on");
        action(t("Send a test alert"), async () => {
          await saveDevice(subscription);
          const { error } = await client.rpc("push_test");
          if (error) throw error;
          return t("Sent! It should arrive in a few seconds.");
        });
        action(t("Turn off"), async () => { await turnOff(); return ""; });
        saveDevice(subscription).catch(() => { /* tried again next time */ }); // this device may have changed account
      } else {
        status.textContent = t("🔕 Alerts for your turn and challenges");
        action(t("Turn on"), turnOn);
      }
      box.append(note);
    };
    refresh();
  }

  accounts.onView("profile", draw);

  // Logging out stops alerts on this device, so the next person here doesn't get yours.
  // Never holds up logging out by more than 3 seconds.
  async function forgetDevice() {
    if (!supported()) return;
    const work = async () => {
      const subscription = await currentSubscription();
      if (!subscription) return;
      await client.rpc("push_unsubscribe", { p_endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    };
    await Promise.race([work().catch(() => {}), new Promise((resolve) => { setTimeout(resolve, 3000); })]);
  }

  window.GoPush = { forgetDevice };
})();
