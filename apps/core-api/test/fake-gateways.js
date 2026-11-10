// Local stand-ins for bKash and an SMTP server. They prove how our code behaves.
// They do not prove anything about the real bKash API or Gmail.
const http = require("node:http");
const net = require("node:net");

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const startFakeBkash = async () => {
  const state = {
    grants: 0,
    refreshes: 0,
    calls: [],
    payments: new Map(),
    grantFails: false,
    executeDown: false,
    queryDown: false,
    createDown: false,
    executeError: null,
    forceAmount: null,
    expiresIn: 3600,
    tokens: new Set(),
    credentials: { username: "fake-user", password: "fake-pass-value", appKey: "fake-app-key", appSecret: "fake-app-secret" },
  };
  let counter = 0;

  const answer = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const paymentBody = (payment) => ({
    statusCode: "0000",
    statusMessage: "Successful",
    paymentID: payment.id,
    trxID: payment.trx || undefined,
    transactionStatus: payment.status,
    amount: state.forceAmount ?? payment.amount,
    currency: "BDT",
    merchantInvoiceNumber: payment.merchantInvoiceNumber,
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fake");

    // What the bKash checkout page would do after the student acts.
    if (req.method === "GET" && url.pathname.startsWith("/checkout/")) {
      const payment = state.payments.get(url.pathname.split("/")[2]);
      const action = url.searchParams.get("action");
      if (!action) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h1>Fake bKash checkout</h1><p>BDT ${payment.amount}</p>
          <a href="?action=success">Approve</a> <a href="?action=cancel">Cancel</a> <a href="?action=failure">Fail</a>`);
        return;
      }
      if (action === "success") payment.approved = true;
      res.writeHead(302, { Location: `${payment.callbackURL}?paymentID=${payment.id}&status=${action}` });
      res.end();
      return;
    }

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const path = url.pathname.replace("/v2/tokenized-checkout", "");
      state.calls.push({ path, body, headers: req.headers });

      if (path === "/auth/grant-token") {
        state.grants += 1;
        const ok =
          !state.grantFails &&
          req.headers.username === state.credentials.username &&
          req.headers.password === state.credentials.password &&
          body.app_key === state.credentials.appKey &&
          body.app_secret === state.credentials.appSecret;
        if (!ok) return answer(res, 200, { statusCode: "9999", statusMessage: "Invalid credentials" });
        const token = `id-token-${state.grants}`;
        state.tokens.add(token);
        return answer(res, 200, { statusCode: "0000", id_token: token, refresh_token: `refresh-${state.grants}`, expires_in: String(state.expiresIn), token_type: "Bearer" });
      }
      if (path === "/auth/refresh-token") {
        state.refreshes += 1;
        const token = `id-token-r${state.refreshes}`;
        state.tokens.add(token);
        return answer(res, 200, { statusCode: "0000", id_token: token, refresh_token: body.refresh_token, expires_in: "3600" });
      }

      if (!state.tokens.has(req.headers.authorization) || req.headers["x-app-key"] !== state.credentials.appKey) {
        return answer(res, 401, { statusCode: "2001", statusMessage: "Unauthorized" });
      }

      if (path === "/payment/create") {
        if (state.createDown) return answer(res, 503, {});
        counter += 1;
        const payment = {
          id: `TR00${Date.now()}${counter}`,
          amount: body.amount,
          merchantInvoiceNumber: body.merchantInvoiceNumber,
          callbackURL: body.callbackURL,
          status: "Initiated",
          approved: false,
          trx: null,
        };
        state.payments.set(payment.id, payment);
        return answer(res, 200, {
          statusCode: "0000",
          statusMessage: "Successful",
          paymentID: payment.id,
          bkashURL: `http://127.0.0.1:${server.address().port}/checkout/${payment.id}`,
          transactionStatus: "Initiated",
          amount: body.amount,
          currency: "BDT",
          merchantInvoiceNumber: body.merchantInvoiceNumber,
        });
      }

      const payment = state.payments.get(body.paymentId);
      if (path === "/payment/execute") {
        if (state.executeDown) return answer(res, 503, {});
        if (state.executeError) return answer(res, 200, { statusCode: state.executeError, statusMessage: "Insufficient balance" });
        if (!payment) return answer(res, 200, { statusCode: "2002", statusMessage: "Invalid Payment ID" });
        if (payment.status === "Completed") return answer(res, 200, { statusCode: "2056", statusMessage: "The payment has already been completed" });
        if (!payment.approved) return answer(res, 200, { statusCode: "2054", statusMessage: "Payment execution pre-requisite hasn't been met" });
        payment.status = "Completed";
        payment.trx = `TRX${counter}${Date.now().toString(36)}`.toUpperCase();
        // Money moved here, even when the answer below never arrives.
        if (state.executeLosesAnswer) return answer(res, 503, {});
        return answer(res, 200, paymentBody(payment));
      }
      if (path === "/query/payment") {
        if (state.queryDown) return answer(res, 503, {});
        if (!payment) return answer(res, 200, { statusCode: "2002", statusMessage: "Invalid Payment ID" });
        return answer(res, 200, paymentBody(payment));
      }
      return answer(res, 404, { statusCode: "404", statusMessage: "Unknown path" });
    });
  });

  const port = await listen(server);
  return {
    state,
    baseUrl: `http://127.0.0.1:${port}/v2/tokenized-checkout`,
    approve: (id) => (state.payments.get(id).approved = true),
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
};

const startFakeSmtp = async () => {
  const state = { messages: [], logins: [], down: false };
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (state.down) return socket.destroy();

    let buffer = "";
    let inData = false;
    let current = { to: [], from: "", raw: "" };
    socket.write("220 fake ESMTP\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (true) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          current.raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          inData = false;
          state.messages.push(current);
          current = { to: [], from: "", raw: "" };
          socket.write("250 OK queued\r\n");
          continue;
        }
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.toUpperCase();

        if (command.startsWith("EHLO")) socket.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (command.startsWith("AUTH")) {
          state.logins.push(line);
          socket.write("235 OK\r\n");
        } else if (command.startsWith("MAIL FROM")) {
          current.from = line;
          socket.write("250 OK\r\n");
        } else if (command.startsWith("RCPT TO")) {
          if (command.includes("BOUNCE@")) socket.write("550 No such user\r\n");
          else {
            current.to.push(line);
            socket.write("250 OK\r\n");
          }
        } else if (command === "DATA") {
          inData = true;
          socket.write("354 go\r\n");
        } else if (command === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("250 OK\r\n");
      }
    });
  });

  const port = await listen(server);
  return {
    state,
    port,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(resolve);
      }),
  };
};

// Reads a nodemailer message, including its quoted-printable parts.
const decodeMail = (raw) =>
  raw
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

module.exports = { startFakeBkash, startFakeSmtp, decodeMail };
