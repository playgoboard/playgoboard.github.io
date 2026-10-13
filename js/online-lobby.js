// Online games with a friend: create a game to get a room code, or join with one.
// PeerJS's free public server only introduces the two browsers; after that the
// moves go straight between them.
(function () {
  const PEER_ID_PREFIX = "goboard-v1-"; // keeps our room codes apart from other PeerJS sites
  const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups
  const CODE_LENGTH = 6;
  const ERROR_TEXT = {
    "peer-unavailable": "No game found with that code. Check the code and ask your friend if their game is still waiting.",
    "network": "Can't reach the online service. Check your internet connection.",
    "server-error": "The online service isn't answering right now. Try again in a minute.",
    "socket-error": "Can't reach the online service. Check your internet connection.",
    "browser-incompatible": "This browser can't play online. Try Chrome, Edge or Firefox.",
    "busy": "That game already has two players.",
    "no-peerjs": "Online play couldn't load. Check your internet connection and reload the page.",
  };

  const $ = (id) => document.getElementById(id);
  const statusEl = $("online-status");
  const inviteBox = $("invite-box");
  const optionsBox = $("online-options");
  const joinInput = $("join-code");

  let current = null; // the OnlineLink being set up or played on

  function randomCode() {
    let code = "";
    for (let k = 0; k < CODE_LENGTH; k++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    return code;
  }

  const cleanCode = (text) => text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);

  // One connection to one friend. Messages are small objects like { type: "move", x, y }.
  class OnlineLink {
    constructor(handlers) {
      this.handlers = handlers;
      this.peer = null;
      this.conn = null;
      this.closed = false;
    }

    host(attempt = 0) {
      const code = randomCode();
      this.peer = new Peer(PEER_ID_PREFIX + code);
      this.peer.on("open", () => this.handlers.onCode(code));
      this.peer.on("connection", (conn) => {
        if (this.conn) {
          conn.on("open", () => { conn.send({ type: "busy" }); setTimeout(() => conn.close(), 500); });
          return;
        }
        this.attach(conn);
      });
      // Keep the room code alive if the connection to the introduction server blips.
      this.peer.on("disconnected", () => { if (!this.closed && !this.conn) this.peer.reconnect(); });
      this.peer.on("error", (err) => {
        if (err.type === "unavailable-id" && attempt < 3) {
          this.peer.destroy();
          this.host(attempt + 1);
        } else this.fail(err.type);
      });
    }

    join(code) {
      this.peer = new Peer();
      this.peer.on("open", () => this.attach(this.peer.connect(PEER_ID_PREFIX + code, { reliable: true })));
      this.peer.on("error", (err) => this.fail(err.type));
    }

    attach(conn) {
      this.conn = conn;
      conn.on("open", () => { if (!this.closed) this.handlers.onConnected(); });
      conn.on("data", (data) => { if (!this.closed) this.handlers.onMessage(data); });
      conn.on("close", () => { if (!this.closed) this.handlers.onClosed(); });
    }

    fail(type) {
      if (!this.closed) this.handlers.onError(type);
    }

    send(message) {
      if (this.conn && this.conn.open) this.conn.send(message);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    }
  }

  function showStatus(text) {
    statusEl.textContent = text;
  }

  function showInvite(code) {
    $("invite-code").textContent = code;
    inviteBox.hidden = false;
    optionsBox.hidden = true;
  }

  function hideInvite() {
    inviteBox.hidden = true;
    if (document.querySelector("#mode-picker [data-mode='online']").classList.contains("selected")) optionsBox.hidden = false;
  }

  function stopCurrent() {
    if (current) current.close();
    current = null;
  }

  function errorText(type) {
    return ERROR_TEXT[type] || "Something went wrong with the connection. Try again.";
  }

  // Shared handlers once the two browsers are talking. `startMessage` is how each side begins.
  function makeLink(onConnected) {
    const link = new OnlineLink({
      onCode: (code) => { showInvite(code); showStatus(""); },
      onConnected: () => onConnected(link),
      onMessage: (message) => {
        if (message.type === "start") {
          hideInvite();
          showStatus("");
          window.GoPage.startOnlineGame(message.size, message.yourColor, link);
        } else if (message.type === "busy") {
          showStatus(errorText("busy"));
          stopCurrent();
        } else {
          window.GoPage.receiveFromFriend(message);
        }
      },
      onClosed: () => { if (link === current) window.GoPage.friendDisconnected(); },
      onError: (type) => {
        if (link !== current) return;
        hideInvite();
        showStatus(errorText(type));
        stopCurrent();
      },
    });
    return link;
  }

  function peerJsMissing() {
    if (typeof window.Peer === "function") return false;
    showStatus(errorText("no-peerjs"));
    return true;
  }

  // The creator picks the board size and colors, then tells the friend when they arrive.
  function createGame() {
    if (peerJsMissing()) return;
    window.GoPage.leaveOnlineGame();
    stopCurrent();
    const { size, color } = window.GoPage.getSetup();
    showStatus("Creating your game…");
    current = makeLink((link) => {
      const friendColor = color === window.Go.BLACK ? window.Go.WHITE : window.Go.BLACK;
      link.send({ type: "start", size, yourColor: friendColor });
      hideInvite();
      showStatus("");
      window.GoPage.startOnlineGame(size, color, link);
    });
    current.host();
  }

  function joinGame(rawCode) {
    if (peerJsMissing()) return;
    const code = cleanCode(rawCode);
    if (code.length !== CODE_LENGTH) {
      showStatus(`Codes are ${CODE_LENGTH} letters and numbers.`);
      return;
    }
    window.GoPage.leaveOnlineGame();
    stopCurrent();
    showStatus("Joining…");
    current = makeLink(() => showStatus("Connected. Waiting for the game to start…"));
    current.join(code);
  }

  function inviteLink(code) {
    const url = new URL(window.location.href);
    url.search = `?join=${code}`;
    url.hash = "";
    return url.toString();
  }

  $("btn-create").addEventListener("click", createGame);
  $("btn-join").addEventListener("click", () => joinGame(joinInput.value));
  joinInput.addEventListener("keydown", (event) => { if (event.key === "Enter") joinGame(joinInput.value); });
  joinInput.addEventListener("input", () => { joinInput.value = cleanCode(joinInput.value); });

  $("btn-copy-link").addEventListener("click", async () => {
    const link = inviteLink($("invite-code").textContent);
    try {
      await navigator.clipboard.writeText(link);
      showStatus("Invite link copied. Paste it to your friend.");
    } catch {
      showStatus(`Copy this link: ${link}`);
    }
  });

  $("btn-cancel-invite").addEventListener("click", () => {
    stopCurrent();
    hideInvite();
    showStatus("");
  });

  // Starting a local game, or picking another opponent, cancels a waiting invite.
  $("btn-new").addEventListener("click", () => { stopCurrent(); hideInvite(); showStatus(""); });
  for (const picker of [$("mode-picker"), $("nav")]) {
    picker.addEventListener("click", () => {
      if (inviteBox.hidden) return;
      const stillOnline = document.querySelector("#mode-picker [data-mode='online']").classList.contains("selected");
      if (stillOnline) optionsBox.hidden = true; // keep showing the waiting invite
      else { stopCurrent(); hideInvite(); showStatus(""); }
    });
  }

  // Opened from an invite link: switch to Online and join right away.
  const invitedCode = new URLSearchParams(window.location.search).get("join");
  if (invitedCode) {
    window.GoPage.setMode("online");
    joinInput.value = cleanCode(invitedCode);
    joinGame(invitedCode);
  }
})();
