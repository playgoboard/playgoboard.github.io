// Backup messenger for online games: when the two browsers can't link up directly (phone
// hotspots, many school networks), their messages go through a Supabase Realtime channel
// named after the game code instead. A RelayConnection behaves like a PeerJS connection
// (on("open"/"data"/"close"/"error"), send, close, open), so online-lobby.js can use either.
(function () {
  const client = () => (window.GoAccounts && window.GoAccounts.ready ? window.GoAccounts.client : null);

  // One channel per game code; everyone in it sees every message, so each message says who
  // it's from and who it's for.
  class RelayHub {
    constructor(code, myId) {
      this.myId = myId;
      this.conns = new Map(); // other side's id -> RelayConnection
      this.ready = false;
      this.onNewConnection = null; // the creator: (conn) => ...
      this.channel = client().channel(`goboard-room-${code}`, { config: { broadcast: { self: false } } });
      this.channel.on("broadcast", { event: "m" }, ({ payload }) => this.receive(payload));
      this.channel.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        this.ready = true;
        for (const conn of this.conns.values()) conn.becomeOpen();
      });
    }

    receive(payload) {
      if (!payload || payload.to !== this.myId || typeof payload.from !== "string") return;
      let conn = this.conns.get(payload.from);
      if (!conn || conn.closed) {
        if (!this.onNewConnection) return;
        conn = this.connect(payload.from);
        this.onNewConnection(conn);
      }
      conn.emit("data", payload.msg);
    }

    connect(otherId) {
      const conn = new RelayConnection(this, otherId);
      this.conns.set(otherId, conn);
      if (this.ready) setTimeout(() => conn.becomeOpen(), 0);
      return conn;
    }

    post(to, msg) {
      this.channel.send({ type: "broadcast", event: "m", payload: { from: this.myId, to, msg } });
    }

    close() {
      for (const conn of this.conns.values()) conn.close();
      client().removeChannel(this.channel);
    }
  }

  class RelayConnection {
    constructor(hub, otherId) {
      this.hub = hub;
      this.otherId = otherId;
      this.open = false;
      this.closed = false;
      this.handlers = {};
    }

    on(event, fn) {
      (this.handlers[event] = this.handlers[event] || []).push(fn);
    }

    emit(event, value) {
      for (const fn of this.handlers[event] || []) fn(value);
    }

    becomeOpen() {
      if (this.open || this.closed) return;
      this.open = true;
      this.emit("open");
    }

    send(msg) {
      if (!this.open) return;
      this.hub.post(this.otherId, msg);
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.emit("close");
    }
  }

  window.GoRelay = {
    available: () => Boolean(client()),
    // The creator listens for joiners; the joiner connects to "host".
    host(code, onNewConnection) {
      const hub = new RelayHub(code, "host");
      hub.onNewConnection = onNewConnection;
      return hub;
    },
    join(code, myId) {
      const hub = new RelayHub(code, myId);
      return { hub, conn: hub.connect("host") };
    },
  };
})();
