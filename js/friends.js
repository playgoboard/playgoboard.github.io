// Friends: send friend requests by username, accept or decline them, see your
// friends' ratings, remove friends. Lives in the "Friends" view of the account window.
// The database decides what is allowed (supabase/03-friends.sql).
(function () {
  const accounts = window.GoAccounts;
  if (!accounts || !accounts.ready) return;
  const client = accounts.client;
  const { t } = window.GoI18n;
  const CHECK_EVERY_MS = 60000; // look for new friend requests once a minute

  let rows = [];
  let container = null;

  const me = () => accounts.current().profile;

  async function load() {
    if (!me()) {
      rows = [];
      accounts.setBadge(0);
      return;
    }
    const { data, error } = await client.from("friendships").select(`
      requester, addressee, status,
      requester_profile:profiles!friendships_requester_fkey(id, username, rating, games, wins, losses),
      addressee_profile:profiles!friendships_addressee_fkey(id, username, rating, games, wins, losses)`);
    if (error) throw error;
    rows = data || [];
    accounts.setBadge(rows.filter((r) => r.status === "pending" && r.addressee === me().id).length);
  }

  // The other player in a friendship row.
  const other = (row) => (row.requester === me().id ? row.addressee_profile : row.requester_profile);

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function button(label, className, onClick) {
    const b = element("button", `btn small-btn ${className || ""}`, label);
    b.addEventListener("click", onClick);
    return b;
  }

  function personRow(player, detail, ...buttons) {
    const row = element("div", "friend-row");
    const who = element("div", "friend-who");
    const name = element("b");
    if (player) name.append(window.GoAvatars.profileLink(player.username));
    else name.textContent = t("Unknown player");
    who.append(name, element("span", "friend-detail", detail));
    const actions = element("div", "friend-actions");
    actions.append(...buttons);
    row.append(who, actions);
    return row;
  }

  function section(title, items, emptyText) {
    const box = element("div", "friend-section");
    box.append(element("h3", "", title));
    if (items.length) box.append(...items);
    else if (emptyText) box.append(element("p", "friend-empty", emptyText));
    return box;
  }

  function setNote(text, isError) {
    const note = container.querySelector(".friend-note");
    note.textContent = text;
    note.classList.toggle("error", Boolean(isError));
  }

  // Runs a database action, then reloads the list.
  async function act(work, okText) {
    try {
      const { error } = await work();
      if (error) throw error;
      await load();
      draw();
      if (okText) setNote(okText);
    } catch (error) {
      setNote(t(((error && error.message) || String(error)).replace(/^.*?:\s*/, "")), true);
    }
  }

  function draw() {
    if (!container) return;
    container.innerHTML = "";
    container.append(element("h2", "", t("Friends")));

    const addRow = element("div", "join-row friend-add");
    const input = element("input");
    input.placeholder = t("Friend's username");
    input.maxLength = 16;
    input.autocomplete = "off";
    const addButton = button(t("Add friend"), "btn-primary", () => {
      const name = input.value.trim();
      if (!name) return setNote(t("Type your friend's username first."), true);
      act(() => client.rpc("send_friend_request", { friend_name: name }), t("Friend request sent to {name}.", { name }));
    });
    addButton.dataset.main = "yes"; // Enter in the box presses this button
    addRow.append(input, addButton);
    container.append(addRow, element("p", "friend-note"));

    const mine = me();
    const incoming = rows.filter((r) => r.status === "pending" && r.addressee === mine.id);
    const outgoing = rows.filter((r) => r.status === "pending" && r.requester === mine.id);
    const friends = rows.filter((r) => r.status === "accepted")
      .sort((a, b) => other(b).rating - other(a).rating);

    if (incoming.length) {
      container.append(section(t("Friend requests for you"), incoming.map((r) => {
        const p = other(r);
        return personRow(p, t("Rating {n}", { n: p.rating }),
          button(t("Accept"), "btn-primary", () => act(() => client.rpc("answer_friend_request", { friend: p.id, accept: true }), t("You and {name} are now friends!", { name: p.username }))),
          button(t("Decline"), "", () => act(() => client.rpc("answer_friend_request", { friend: p.id, accept: false }), t("Request declined."))));
      })));
    }

    container.append(section(t("Your friends"), friends.map((r) => {
      const p = other(r);
      return personRow(p, t("Rating {n} · {w} W / {l} L", { n: p.rating, w: p.wins, l: p.losses }),
        button(t("Daily game"), "btn-primary", () => { window.location.href = `daily.html?challenge=${encodeURIComponent(p.id)}`; }),
        button(t("Remove"), "", () => {
          if (confirm(t("Remove {name} from your friends?", { name: p.username }))) act(() => client.rpc("remove_friend", { friend: p.id }), t("{name} was removed.", { name: p.username }));
        }));
    }), t("No friends yet. Add someone by their username above.")));

    if (outgoing.length) {
      container.append(section(t("Requests you sent"), outgoing.map((r) => {
        const p = other(r);
        return personRow(p, t("Waiting for an answer"),
          button(t("Cancel"), "", () => act(() => client.rpc("remove_friend", { friend: p.id }), t("Request cancelled."))));
      })));
    }

    const back = element("p", "account-links");
    const backButton = element("button", "link-button", t("Back to your profile"));
    backButton.dataset.go = "profile";
    back.append(backButton);
    container.append(back);
  }

  accounts.onView("friends", async (view) => {
    container = view;
    const heading = () => {
      container.textContent = "";
      container.append(element("h2", "", t("Friends")));
    };
    heading();
    if (!me()) {
      container.append(element("p", "", t("Log in to see your friends.")));
      return;
    }
    container.append(element("p", "", t("Loading…")));
    try {
      await load();
      draw();
    } catch (error) {
      heading();
      container.append(element("p", "friend-empty", t("Couldn't load your friends. Check your internet connection.")));
    }
  });

  accounts.onChange(({ profile }) => {
    if (profile) load().catch(() => {});
    else accounts.setBadge(0);
  });
  setInterval(() => { if (me()) load().catch(() => {}); }, CHECK_EVERY_MS);
})();
