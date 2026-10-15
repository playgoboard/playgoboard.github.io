// Friends: send friend requests by username, accept or decline them, see your
// friends' ratings, remove friends. Lives in the "Friends" view of the account window.
// The database decides what is allowed (supabase/03-friends.sql).
(function () {
  const accounts = window.GoAccounts;
  if (!accounts || !accounts.ready) return;
  const client = accounts.client;
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
    who.append(element("b", "", player ? player.username : "Unknown player"), element("span", "friend-detail", detail));
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
      setNote(((error && error.message) || String(error)).replace(/^.*?:\s*/, ""), true);
    }
  }

  function draw() {
    if (!container) return;
    container.innerHTML = "";
    container.append(element("h2", "", "Friends"));

    const addRow = element("div", "join-row friend-add");
    const input = element("input");
    input.placeholder = "Friend's username";
    input.maxLength = 16;
    input.autocomplete = "off";
    const addButton = button("Add friend", "btn-primary", () => {
      const name = input.value.trim();
      if (!name) return setNote("Type your friend's username first.", true);
      act(() => client.rpc("send_friend_request", { friend_name: name }), `Friend request sent to ${name}.`);
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
      container.append(section("Friend requests for you", incoming.map((r) => {
        const p = other(r);
        return personRow(p, `Rating ${p.rating}`,
          button("Accept", "btn-primary", () => act(() => client.rpc("answer_friend_request", { friend: p.id, accept: true }), `You and ${p.username} are now friends!`)),
          button("Decline", "", () => act(() => client.rpc("answer_friend_request", { friend: p.id, accept: false }), "Request declined.")));
      })));
    }

    container.append(section("Your friends", friends.map((r) => {
      const p = other(r);
      return personRow(p, `Rating ${p.rating} · ${p.wins} W / ${p.losses} L`,
        button("Remove", "", () => {
          if (confirm(`Remove ${p.username} from your friends?`)) act(() => client.rpc("remove_friend", { friend: p.id }), `${p.username} was removed.`);
        }));
    }), "No friends yet. Add someone by their username above."));

    if (outgoing.length) {
      container.append(section("Requests you sent", outgoing.map((r) => {
        const p = other(r);
        return personRow(p, "Waiting for an answer",
          button("Cancel", "", () => act(() => client.rpc("remove_friend", { friend: p.id }), "Request cancelled.")));
      })));
    }

    const back = element("p", "account-links");
    const backButton = element("button", "link-button", "Back to your profile");
    backButton.dataset.go = "profile";
    back.append(backButton);
    container.append(back);
  }

  accounts.onView("friends", async (view) => {
    container = view;
    if (!me()) {
      container.innerHTML = "<h2>Friends</h2><p>Log in to see your friends.</p>";
      return;
    }
    container.innerHTML = "<h2>Friends</h2><p>Loading…</p>";
    try {
      await load();
      draw();
    } catch (error) {
      container.innerHTML = "<h2>Friends</h2>";
      container.append(element("p", "friend-empty", "Couldn't load your friends. Check your internet connection."));
    }
  });

  accounts.onChange(({ profile }) => {
    if (profile) load().catch(() => {});
    else accounts.setBadge(0);
  });
  setInterval(() => { if (me()) load().catch(() => {}); }, CHECK_EVERY_MS);
})();
