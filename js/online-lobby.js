// Online games with a friend: create a game to get a room code, or join with one.
// PeerJS's free public server only introduces the two browsers; after that the
// moves go straight between them.
//
// Real internet connections hiccup, so this file:
// - lets the joiner keep saying "hello" until the creator answers with the full game ("sync"),
// - sends a small "ping" every few seconds and treats long silence as a dropped connection,
// - reconnects automatically after a drop; the creator then re-sends every move so both boards match.
(function () {
  // v2: the connection rules changed, so old and new versions of the page don't mix.
  const PEER_ID_PREFIX = "goboard-v2-";
  const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I mix-ups
  const CODE_LENGTH = 6;
  const TICK_MS = 3000;              // ping + retry rhythm
  const SILENCE_LIMIT_MS = 12000;    // no message for this long = connection is dead
  const DIAL_TIMEOUT_MS = 8000;      // a connection attempt that hasn't opened by now is retried
  const FIRST_JOIN_LIMIT_MS = 25000; // give up on a first join after this long
  const RECONNECT_LIMIT_MS = 120000; // give up reconnecting after 2 minutes

  const ERROR_TEXT = {
    "peer-unavailable": "No game found with that code. Check the code and ask your friend if their game is still waiting.",
    "network": "Can't reach the online service. Check your internet connection.",
    "server-error": "The online service isn't answering right now. Try again in a minute.",
    "socket-error": "Can't reach the online service. Check your internet connection.",
    "browser-incompatible": "This browser can't play online. Try Chrome, Edge or Firefox.",
    "busy": "That game already has two players.",
    "no-peerjs": "Online play couldn't load. Check your internet connection and reload the page.",
    "timeout": "Couldn't connect to your friend. Some school or work Wi-Fi blocks this. Try another network, or try again.",
  };

  const $ = (id) => document.getElementById(id);
  const statusEl = $("online-status");
  const inviteBox = $("invite-box");
  const optionsBox = $("online-options");
  const joinInput = $("join-code");

  let current = null; // the session being set up or played on

  function randomCode() {
    let code = "";
    for (let k = 0; k < CODE_LENGTH; k++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    return code;
  }

  const cleanCode = (text) => text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
  const errorText = (type) => ERROR_TEXT[type] || "Something went wrong with the connection. Try again.";

  // Shared by both sides: owns the current connection, pings, and notices drops.
  class Session {
    constructor() {
      this.peer = null;
      this.conn = null;
      this.closed = false;
      this.connected = false;      // true once the game state has been exchanged
      this.everConnected = false;
      this.lastHeard = 0;
      this.ticker = setInterval(() => this.tick(), TICK_MS);
    }

    isCurrent(conn) {
      return !this.closed && conn === this.conn;
    }

    useConnection(conn) {
      if (this.conn && this.conn !== conn) this.conn.close(); // its close event is ignored below
      this.conn = conn;
      this.dialedAt = Date.now();
      this.lastHeard = Date.now();
      conn.on("open", () => { if (this.isCurrent(conn)) { this.lastHeard = Date.now(); this.onOpen(); } });
      conn.on("data", (msg) => {
        if (!this.isCurrent(conn) || !msg || typeof msg.type !== "string") return;
        this.lastHeard = Date.now();
        if (msg.type !== "ping") this.onMessage(msg);
      });
      conn.on("close", () => { if (this.isCurrent(conn)) this.lost(); });
      conn.on("error", () => { if (this.isCurrent(conn)) this.lost(); });
    }

    send(message) {
      if (!this.conn || !this.conn.open) return;
      try { this.conn.send(message); } catch { this.lost(); }
    }

    tick() {
      if (this.closed) return;
      if (this.conn && this.conn.open) {
        this.send({ type: "ping" });
        if (this.connected && Date.now() - this.lastHeard > SILENCE_LIMIT_MS) this.lost();
      }
      this.onTick();
    }

    lost() {
      const conn = this.conn;
      this.conn = null;
      if (conn) conn.close();
      if (this.connected) {
        this.connected = false;
        this.lostAt = Date.now();
        this.onLost();
      }
    }

    // After a blip with the introduction server, log back in (the game itself may still be fine).
    keepPeerOnline() {
      const peer = this.peer;
      setTimeout(() => {
        if (!this.closed && peer === this.peer && peer.disconnected && !peer.destroyed) {
          try { peer.reconnect(); } catch { /* tried again on the next blip */ }
        }
      }, 1500);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.ticker);
      if (this.conn) this.conn.close();
      if (this.peer) this.peer.destroy();
    }

    onOpen() {}
    onMessage() {}
    onTick() {}
    onLost() {}
  }

  // The creator. Keeps its room code registered for the whole game, so the
  // friend can always find it again after a drop. The creator's board is the
  // "official" one that gets re-sent after a reconnect.
  class HostSession extends Session {
    // options: { quick: true } for Quick match, level: your chosen level when not logged in.
    constructor(size, hostColor, clockSettings, ratedWanted, ui, options = {}) {
      super();
      this.options = options;
      this.guestLevel = null;
      this.size = size;
      this.clockSettings = clockSettings; // the creator's clock choice counts for both players
      this.ratedWanted = ratedWanted;
      this.hostColor = hostColor;
      this.guestColor = hostColor === window.Go.BLACK ? window.Go.WHITE : window.Go.BLACK;
      this.guestToken = null;
      this.guestUserId = null;
      this.meta = null;       // names, ratings and the rated game id, sent to the joiner
      this.started = false;
      this.preparing = false;
      this.code = null;
      this.isHost = true;
      this.ui = ui;
      this.register(0);
    }

    // Names and ratings of both players, and a rated game in the database if one was asked for.
    async prepareMeta() {
      // casualReason says why a wanted rated game became casual; each side words it for itself.
      // gameKey: the same id on both sides, so each player's game history can save this game once.
      const meta = {
        ratedGameId: null, players: {}, casualReason: null, errorText: "", quick: Boolean(this.options.quick),
        gameKey: randomCode() + randomCode() + randomCode(),
      };
      const me = window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts.current().profile : null;
      const guest = this.guestUserId && window.GoRated
        ? await window.GoRated.profile(this.guestUserId).catch(() => null) : null;
      if (me) meta.players[this.hostColor] = { id: me.id, username: me.username, rating: me.rating };
      if (guest) meta.players[this.guestColor] = { id: guest.id, username: guest.username, rating: guest.rating };
      // Quick match guests without an account show the level they picked.
      if (!me && this.options.level) meta.players[this.hostColor] = { username: "Guest", level: this.options.level };
      if (!guest && this.guestLevel) meta.players[this.guestColor] = { username: "Guest", level: this.guestLevel };
      if (this.ratedWanted) {
        if (!me) meta.casualReason = "host-logged-out";
        else if (!guest) meta.casualReason = "guest-logged-out";
        else if (guest.id === me.id) meta.casualReason = "same-account";
        else {
          try { meta.ratedGameId = await window.GoRated.start(guest.id, this.hostColor, this.size); }
          catch (error) { meta.casualReason = "error"; meta.errorText = error.message; }
        }
      }
      return meta;
    }

    // Both players asked for a rematch: same board size, colors picked at random.
    async startRematch() {
      if (this.rematching) return;
      this.rematching = true;
      const { BLACK, WHITE } = window.Go;
      this.hostColor = Math.random() < 0.5 ? BLACK : WHITE;
      this.guestColor = this.hostColor === BLACK ? WHITE : BLACK;
      if (window.GoAccounts && window.GoAccounts.ready) await window.GoAccounts.refreshProfile(); // fresh rating
      this.meta = await this.prepareMeta();
      this.rematching = false;
      if (this.closed) return;
      window.GoPage.startOnlineGame(this.size, this.hostColor, [], this, "rematch", this.clockSettings, null, this.meta);
      this.send({ type: "rematch", size: this.size, yourColor: this.guestColor, clock: this.clockSettings, meta: this.meta });
    }

    register(attempt) {
      const code = randomCode();
      const peer = (this.peer = new Peer(PEER_ID_PREFIX + code));
      peer.on("open", () => {
        if (this.code) return; // just logged back in after a blip
        this.code = code;
        this.ui.onCode(code);
      });
      peer.on("connection", (conn) => this.listenForHello(conn));
      peer.on("disconnected", () => this.keepPeerOnline());
      peer.on("error", (err) => {
        if (this.closed || peer !== this.peer) return;
        if (!this.code) {
          if (err.type === "unavailable-id" && attempt < 3) {
            peer.destroy();
            this.register(attempt + 1);
          } else {
            this.ui.onFail(err.type);
          }
        } else {
          this.keepPeerOnline();
        }
      });
    }

    // A new connection only becomes "the" connection once it says hello with the right token,
    // so a stranger guessing the code can't kick your friend out.
    listenForHello(conn) {
      conn.on("data", (msg) => {
        if (this.closed || !msg || msg.type !== "hello") return;
        if (this.guestToken && msg.token !== this.guestToken) {
          try { conn.send({ type: "busy" }); } catch { /* they'll time out instead */ }
          setTimeout(() => conn.close(), 500);
          return;
        }
        this.guestToken = msg.token;
        if (conn !== this.conn) this.useConnection(conn);
        this.lastHeard = Date.now();
        if (this.started) return this.answerHello();
        // First hello: look up names (and start a rated game) before the game begins.
        // The joiner keeps saying hello, so it will get its answer once this is ready.
        if (this.preparing) return;
        this.preparing = true;
        this.guestUserId = typeof msg.user === "string" ? msg.user : null;
        this.guestLevel = window.GoLevels && window.GoLevels.isLevel(msg.level) ? msg.level : null;
        this.prepareMeta().then((meta) => {
          this.preparing = false;
          if (this.closed) return;
          this.meta = meta;
          this.started = true;
          this.ui.onStart(this.size, this.hostColor, meta);
          this.answerHello();
        });
      });
    }

    answerHello() {
      this.send({
        type: "sync", size: this.size, yourColor: this.guestColor, actions: window.GoPage.onlineActions(),
        clock: this.clockSettings, times: window.GoPage.clockTimes(), meta: this.meta,
      });
      if (!this.connected) {
        const cameBack = this.everConnected;
        this.connected = this.everConnected = true;
        if (cameBack) window.GoPage.setConnection(true, `Your ${window.GoPage.friendWord()} is back!`);
      }
    }

    onMessage(msg) {
      if (msg.type === "hello") return; // handled in listenForHello
      window.GoPage.receiveFromFriend(msg);
    }

    onLost() {
      window.GoPage.setConnection(false, `Your ${window.GoPage.friendWord()}'s connection dropped. Waiting for them to come back…`);
    }
  }

  // The joiner. Keeps dialing and saying hello until the creator sends the game.
  class GuestSession extends Session {
    constructor(code, ui, options = {}) {
      super();
      this.code = code;
      this.options = options;
      this.token = randomCode() + randomCode();
      this.isHost = false;
      this.ui = ui;
      this.startedAt = Date.now();
      this.makePeer();
    }

    makePeer() {
      const peer = (this.peer = new Peer());
      peer.on("open", () => this.dial());
      peer.on("disconnected", () => this.keepPeerOnline());
      peer.on("error", (err) => {
        if (this.closed || peer !== this.peer) return;
        this.lastError = err.type;
        // Before the first connection these are real answers; later we just keep retrying.
        if (!this.everConnected && (err.type === "peer-unavailable" || err.type === "browser-incompatible")) {
          this.ui.onFail(err.type);
        }
      });
    }

    dial() {
      if (this.closed || this.connected || !this.peer.open) return;
      this.useConnection(this.peer.connect(PEER_ID_PREFIX + this.code, { reliable: true }));
    }

    onOpen() {
      // If logged in, say who we are so the game can show names and be rated.
      const profile = window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts.current().profile : null;
      this.send({ type: "hello", token: this.token, user: profile ? profile.id : null, level: this.options.level || null });
    }

    onTick() {
      if (this.connected) return;
      const now = Date.now();
      if (!this.everConnected && now - this.startedAt > FIRST_JOIN_LIMIT_MS) {
        return this.ui.onFail(this.lastError === "peer-unavailable" ? "peer-unavailable" : "timeout");
      }
      if (this.everConnected && now - this.lostAt > RECONNECT_LIMIT_MS) {
        window.GoPage.setConnection(false, `Couldn't reconnect to your ${window.GoPage.friendWord()}. Start a new game to play again.`);
        return this.close();
      }
      if (this.conn && this.conn.open) return this.onOpen(); // say hello again until the game arrives
      if (this.conn && now - this.dialedAt < DIAL_TIMEOUT_MS) return; // still trying
      if (this.peer.destroyed) this.makePeer();
      else this.dial();
    }

    onMessage(msg) {
      if (msg.type === "sync") {
        if (this.connected) return; // an extra answer to a repeated hello
        const kind = this.everConnected ? "reconnect" : "new";
        this.connected = this.everConnected = true;
        this.ui.onSync(msg, kind);
      } else if (msg.type === "rematch") {
        window.GoPage.startOnlineGame(msg.size, msg.yourColor, [], this, "rematch", msg.clock, null, msg.meta);
      } else if (msg.type === "busy") {
        this.ui.onFail("busy");
      } else {
        window.GoPage.receiveFromFriend(msg);
      }
    }

    onLost() {
      window.GoPage.setConnection(false, "Connection lost. Reconnecting…");
    }
  }

  // ---- The Online panel ----

  function showStatus(text) {
    statusEl.textContent = text;
  }

  function showInvite(code) {
    $("invite-code").textContent = code;
    inviteBox.hidden = false;
    optionsBox.hidden = true;
  }

  function onlineSelected() {
    return document.querySelector("#mode-picker [data-mode='online']").classList.contains("selected");
  }

  function hideInvite() {
    inviteBox.hidden = true;
    if (onlineSelected()) optionsBox.hidden = false;
  }

  function stopCurrent() {
    if (current) current.close();
    current = null;
  }

  function peerJsMissing() {
    if (typeof window.Peer === "function") return false;
    showStatus(errorText("no-peerjs"));
    return true;
  }

  function failed(session, type) {
    if (session !== current) return;
    hideInvite();
    showStatus(errorText(type));
    stopCurrent();
  }

  // Hosting a room, for "Create online game" and Quick match.
  // hooks: onCode(code) once the room exists, onStart() when the game begins, onFail(type).
  function startHost({ size, color, clock, rated }, hooks, options) {
    window.GoPage.leaveOnlineGame();
    stopCurrent();
    const session = new HostSession(size, color, clock, rated, {
      onCode: (code) => { if (session === current) hooks.onCode(code); },
      onStart: (gameSize, myColor, meta) => {
        if (session !== current) return;
        if (hooks.onStart) hooks.onStart();
        hideInvite();
        showStatus("");
        window.GoPage.startOnlineGame(gameSize, myColor, [], session, "new", clock, null, meta);
      },
      onFail: (type) => { if (session === current) hooks.onFail(type); },
    }, options);
    current = session;
    return session;
  }

  // Joining someone's room by its code.
  function startGuest(code, hooks, options) {
    window.GoPage.leaveOnlineGame();
    stopCurrent();
    const session = new GuestSession(code, {
      onSync: (msg, kind) => {
        if (session !== current) return;
        if (hooks.onStart) hooks.onStart();
        showStatus("");
        window.GoPage.startOnlineGame(msg.size, msg.yourColor, msg.actions, session, kind, msg.clock, kind === "reconnect" ? msg.times : null, msg.meta);
      },
      onFail: (type) => { if (session === current) hooks.onFail(type); },
    }, options);
    current = session;
    return session;
  }

  // The creator picks the board size and colors.
  function createGame() {
    if (peerJsMissing()) return;
    showStatus("Creating your game…");
    const session = startHost(window.GoPage.getSetup(), {
      onCode: (code) => { showInvite(code); showStatus(""); },
      onFail: (type) => failed(session, type),
    });
  }

  function joinGame(rawCode) {
    if (peerJsMissing()) return;
    const code = cleanCode(rawCode);
    if (code.length !== CODE_LENGTH) {
      showStatus(`Codes are ${CODE_LENGTH} letters and numbers.`);
      return;
    }
    showStatus("Connecting to your friend…");
    const session = startGuest(code, { onFail: (type) => failed(session, type) });
  }

  // For quick-match.js.
  window.GoLobby = {
    startHost,
    startGuest,
    isCurrent: (session) => session === current,
    stop: stopCurrent,
    showStatus,
    errorText,
    peerJsMissing,
  };

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
      if (onlineSelected()) optionsBox.hidden = true; // keep showing the waiting invite
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
