// The chat box for online games. Messages are filtered on both sides (yours before
// sending, your friend's when they arrive) and are always shown as plain text.
(function () {
  const MAX_LENGTH = 200;
  const MAX_SHOWN = 100;
  const MIN_GAP_MS = 700; // stops someone flooding the chat

  const box = document.getElementById("chat-block");
  const list = document.getElementById("chat-messages");
  const input = document.getElementById("chat-input");
  const sendButton = document.getElementById("btn-chat-send");
  let lastSent = 0;

  function add(who, text, mine) {
    const line = document.createElement("div");
    line.className = mine ? "chat-line mine" : "chat-line";
    const name = document.createElement("b");
    name.textContent = `${who}: `;
    line.append(name, document.createTextNode(text)); // plain text only, never HTML
    list.append(line);
    while (list.children.length > MAX_SHOWN) list.firstChild.remove();
    list.scrollTop = list.scrollHeight;
  }

  function note(text) {
    const line = document.createElement("div");
    line.className = "chat-line note";
    line.textContent = text;
    list.append(line);
    list.scrollTop = list.scrollHeight;
  }

  function send() {
    const text = window.GoChatFilter.cleanMessage(input.value.trim().slice(0, MAX_LENGTH));
    if (!text) return;
    if (Date.now() - lastSent < MIN_GAP_MS) return;
    if (!window.GoPage.sendChat(text)) {
      note("Not connected right now, so the message wasn't sent.");
      return;
    }
    lastSent = Date.now();
    add("You", text, true);
    input.value = "";
  }

  sendButton.addEventListener("click", send);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") send(); });
  input.maxLength = MAX_LENGTH;

  window.GoChat = {
    receive(text) {
      if (typeof text !== "string") return;
      const clean = window.GoChatFilter.cleanMessage(text.trim().slice(0, MAX_LENGTH));
      if (clean) add(window.GoPage.friendWord() === "opponent" ? "Opponent" : "Friend", clean, false);
    },
    // Shown only during online games; a new game starts with an empty chat.
    show(visible) {
      box.hidden = !visible;
    },
    clear() {
      list.textContent = "";
      note("Say hi! Bad words are hidden automatically.");
    },
  };
})();
