// Mock ticketing target for local load tests. Dev only — admin endpoints are unauthenticated.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 3000);
const SEATS = Number(process.env.SEATS ?? 100);
const EVENT_IDS = ["evt-1", "evt-2", "evt-3"];
const MAX_BODY_BYTES = 1024;
// Pre-issued tickets for scan-ticket load: gate-0 .. gate-(GATE_TICKETS-1).
const GATE_TICKETS = Number(process.env.GATE_TICKETS ?? 100_000);
const MAX_ORDERS = 200_000;
// Purchase flow (checkout journey): cart hold → checkout → sandbox payment → confirmed order → ticket.
const PRICE_CENTS = 2500;
const MAX_CARTS = 200_000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

const config = {
  latencyMs: Number(process.env.LATENCY_MS ?? 0),
  latencyJitterMs: Number(process.env.LATENCY_JITTER_MS ?? 0),
  errorRate: Number(process.env.ERROR_RATE ?? 0),
  oversell: process.env.OVERSELL === "true",
  healthy: true,
  // Time from order to a viewable ticket (receive-poll).
  ticketDelayMs: Number(process.env.TICKET_DELAY_MS ?? 2000),
  // Seats stay held from cart to payment for this long; an unpaid hold is released after it.
  cartHoldMs: Number(process.env.CART_HOLD_MS ?? 600_000),
  // Payment sandbox: requests per second across all callers (429 + Retry-After above it), like a real PSP.
  paymentRps: Number(process.env.PAYMENT_RPS ?? 50),
  // Time from captured payment to a confirmed order.
  confirmDelayMs: Number(process.env.CONFIRM_DELAY_MS ?? 500),
  // Faults for the journey and integrity checks to catch:
  // charge, then drop the connection without answering (the client must retry with the same Idempotency-Key)
  dropAfterChargeRate: Number(process.env.DROP_AFTER_CHARGE_RATE ?? 0),
  // treat every payment as new, so a retry charges twice (double charge)
  ignoreIdempotency: process.env.IGNORE_IDEMPOTENCY === "true",
  // charge but never create the order (charged, no ticket)
  loseOrderRate: Number(process.env.LOSE_ORDER_RATE ?? 0),
};

let events;
let orders;
let scanned;
let nextOrder;
let carts;
let checkouts;
let payments; // Idempotency-Key → { fingerprint, status, body }
let charges; // every captured charge: { paymentId, checkoutId }
let nextId;
let bucket; // payment rate limit: { tokens, at }
function resetInventory() {
  events = new Map(EVENT_IDS.map((id) => [id, { id, capacity: SEATS, sold: 0, held: 0 }]));
  orders = new Map();
  scanned = new Set();
  nextOrder = 1;
  carts = new Map();
  checkouts = new Map();
  payments = new Map();
  charges = [];
  nextId = 1;
  bucket = { tokens: config.paymentRps, at: Date.now() };
}
resetInventory();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const remaining = (e) => e.capacity - e.sold - e.held;
const publicEvent = (e) => ({ id: e.id, capacity: e.capacity, sold: e.sold, held: e.held, remaining: remaining(e) });

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

// Event page for k6 browser steps: the hero is the LCP element, the event loads client-side, the button gives INP.
function eventPage(id) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Event</title>
<style>
body{margin:0;font-family:system-ui,sans-serif}
.hero{height:60vh;display:flex;align-items:flex-end;padding:24px;background:linear-gradient(135deg,#1e3a8a,#9333ea);color:#fff}
.hero h1{margin:0;font-size:40px}
main{padding:24px}
button{padding:12px 20px;font-size:18px}
</style>
</head>
<body>
<section class="hero"><h1 id="title">Loading event…</h1></section>
<main>
<p id="seats">Checking seats…</p>
<button id="buy" type="button">Choose seats</button>
<p id="picked" hidden>Seat map opened.</p>
</main>
<script>
const id = ${JSON.stringify(id)};
const $ = (s) => document.querySelector(s);
fetch("/events/" + encodeURIComponent(id))
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((e) => {
    $("#title").textContent = "Event " + e.id;
    $("#seats").textContent = e.remaining + " of " + e.capacity + " seats left";
  })
  .catch((err) => {
    console.error("event load failed: " + err);
    $("#title").textContent = "Event not found";
    $("#seats").textContent = "No seats";
  });
$("#buy").addEventListener("click", () => ($("#picked").hidden = false));
</script>
</body>
</html>
`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function applyConfig(patch) {
  const next = { ...config };
  if ("latencyMs" in patch) next.latencyMs = patch.latencyMs;
  if ("latencyJitterMs" in patch) next.latencyJitterMs = patch.latencyJitterMs;
  if ("errorRate" in patch) next.errorRate = patch.errorRate;
  if ("oversell" in patch) next.oversell = patch.oversell;
  if ("healthy" in patch) next.healthy = patch.healthy;
  if ("ticketDelayMs" in patch) next.ticketDelayMs = patch.ticketDelayMs;
  for (const k of ["cartHoldMs", "paymentRps", "confirmDelayMs", "dropAfterChargeRate", "ignoreIdempotency", "loseOrderRate"]) if (k in patch) next[k] = patch[k];
  const validMs = (v) => Number.isInteger(v) && v >= 0 && v <= 60_000;
  if (!validMs(next.latencyMs) || !validMs(next.latencyJitterMs)) return "latency must be an integer 0..60000";
  if (!Number.isInteger(next.ticketDelayMs) || next.ticketDelayMs < 0 || next.ticketDelayMs > 600_000) return "ticketDelayMs must be an integer 0..600000";
  if (typeof next.errorRate !== "number" || next.errorRate < 0 || next.errorRate > 1) return "errorRate must be 0..1";
  if (typeof next.oversell !== "boolean" || typeof next.healthy !== "boolean") return "oversell/healthy must be boolean";
  if (!Number.isInteger(next.paymentRps) || next.paymentRps < 1 || next.paymentRps > 100_000) return "paymentRps must be an integer 1..100000";
  if (!validMs(next.confirmDelayMs)) return "confirmDelayMs must be an integer 0..60000";
  if (!Number.isInteger(next.cartHoldMs) || next.cartHoldMs < 1 || next.cartHoldMs > 3_600_000) return "cartHoldMs must be an integer 1..3600000";
  const rate = (v) => typeof v === "number" && v >= 0 && v <= 1;
  if (!rate(next.dropAfterChargeRate) || !rate(next.loseOrderRate)) return "dropAfterChargeRate/loseOrderRate must be 0..1";
  if (typeof next.ignoreIdempotency !== "boolean") return "ignoreIdempotency must be boolean";
  Object.assign(config, next);
  return null;
}

/**
 * Read-only reconciliation (the integrity adapter's data source). `since`/`until` (epoch ms) limit charge-based
 * counts to one run's window; oversold is the inventory's current state, so it is never windowed.
 */
function integrity(since = 0, until = Infinity) {
  const list = [...events.values()].map((e) => ({ ...publicEvent(e), oversold: Math.max(0, e.sold - e.capacity) }));
  const oversold = list.reduce((n, e) => n + e.oversold, 0);
  const inWindow = charges.filter((c) => c.at >= since && c.at <= until);
  const perCheckout = new Map();
  for (const c of inWindow) perCheckout.set(c.checkoutId, (perCheckout.get(c.checkoutId) ?? 0) + 1);
  // Every charge beyond the first for one checkout is a double charge.
  const doubleCharges = [...perCheckout.values()].reduce((n, k) => n + k - 1, 0);
  const chargedNoTicket = [...perCheckout.keys()].filter((id) => !checkouts.get(id)?.orderId).length;
  return {
    ok: oversold === 0 && doubleCharges === 0 && chargedNoTicket === 0,
    oversold,
    doubleCharges,
    chargedNoTicket,
    orders: orders.size,
    charges: inWindow.length,
    scans: scanned.size,
    events: list,
  };
}

/** Global token bucket for the payment sandbox. Returns seconds to wait, or 0 when the call may go ahead. */
function paymentThrottle() {
  const now = Date.now();
  bucket.tokens = Math.min(config.paymentRps, bucket.tokens + ((now - bucket.at) / 1000) * config.paymentRps);
  bucket.at = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return 0;
  }
  return Math.max(1, Math.ceil((1 - bucket.tokens) / config.paymentRps));
}

const holding = (cart) => cart.status === "open" || cart.status === "checked_out";

/** Releases seats held by carts (checked out or not) that weren't paid before the hold ran out. */
function expireHolds(now = Date.now()) {
  for (const cart of carts.values()) {
    if (holding(cart) && cart.expiresAt <= now) {
      cart.status = "expired";
      events.get(cart.eventId).held -= cart.qty;
    }
  }
}
setInterval(expireHolds, 1000).unref();

function capped(map, max) {
  // Oldest first: Map keeps insertion order.
  if (map.size > max) map.delete(map.keys().next().value);
}

const orderView = (id, o) =>
  o.status === "confirmed" || Date.now() >= (o.confirmAt ?? 0)
    ? { orderId: id, eventId: o.eventId, qty: o.qty, status: "confirmed", ticketId: `tkt-${id}` }
    : { orderId: id, eventId: o.eventId, qty: o.qty, status: "pending" };

function validTicket(id) {
  const gate = /^gate-(\d+)$/.exec(id);
  if (gate) return Number(gate[1]) < GATE_TICKETS;
  const order = /^tkt-(ord-\d+)$/.exec(id);
  const o = order && orders.get(order[1]);
  return Boolean(o && Date.now() - o.at >= config.ticketDelayMs);
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, "http://localhost");

  const asset = req.method === "GET" && STATIC_FILES.get(pathname);
  if (asset) {
    const [name, type] = asset;
    const contents = await readFile(path.join(PUBLIC_DIR, name));
    res.writeHead(200, { "Content-Type": type });
    return res.end(contents);
  }

  if (req.method === "GET" && pathname === "/healthz") {
    return config.healthy ? send(res, 200, { status: "ok" }) : send(res, 503, { status: "unhealthy" });
  }

  if (pathname.startsWith("/__admin/")) {
    if (req.method === "GET" && pathname === "/__admin/config") return send(res, 200, config);
    if (req.method === "POST" && pathname === "/__admin/config") {
      const error = applyConfig(await readJson(req));
      return error ? send(res, 400, { error }) : send(res, 200, config);
    }
    if (req.method === "GET" && pathname === "/__admin/integrity") {
      const q = new URL(req.url, "http://localhost").searchParams;
      const ms = (k, fallback) => (q.has(k) ? Number(q.get(k)) : fallback);
      const since = ms("since", 0);
      const until = ms("until", Infinity);
      if (!Number.isFinite(since) || Number.isNaN(until) || since > until) return send(res, 400, { error: "since/until must be epoch ms, since ≤ until" });
      return send(res, 200, integrity(since, until));
    }
    if (req.method === "POST" && pathname === "/__admin/reset") {
      resetInventory();
      return send(res, 200, integrity());
    }
    return send(res, 404, { error: "not found" });
  }

  // Fault injection applies to business endpoints only.
  const delay = config.latencyMs + Math.floor(Math.random() * (config.latencyJitterMs + 1));
  if (delay > 0) await sleep(delay);
  if (Math.random() < config.errorRate) return send(res, 500, { error: "injected failure" });

  if (req.method === "GET" && pathname === "/events") {
    return send(res, 200, [...events.values()].map(publicEvent));
  }

  const page = pathname.match(/^\/events\/([\w-]+)\/page$/);
  if (req.method === "GET" && page) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(eventPage(page[1]));
  }

  const match = pathname.match(/^\/events\/([\w-]+)$/);
  if (req.method === "GET" && match) {
    const event = events.get(match[1]);
    return event ? send(res, 200, publicEvent(event)) : send(res, 404, { error: "event not found" });
  }

  if (req.method === "POST" && pathname === "/orders") {
    const { eventId, qty } = await readJson(req);
    const event = events.get(eventId);
    if (!event) return send(res, 404, { error: "event not found" });
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return send(res, 400, { error: "qty must be an integer 1..10" });
    // Oversell mode deliberately skips the inventory check so integrity checks have something to catch.
    if (!config.oversell && qty > remaining(event)) return send(res, 409, { error: "sold out" });
    event.sold += qty;
    const orderId = `ord-${nextOrder++}`;
    orders.set(orderId, { eventId, qty, at: Date.now() });
    // Oldest first: Map keeps insertion order.
    if (orders.size > MAX_ORDERS) orders.delete(orders.keys().next().value);
    return send(res, 201, { orderId, eventId, qty, remaining: remaining(event) });
  }

  // 1. Hold seats in a cart.
  if (req.method === "POST" && pathname === "/carts") {
    const { eventId, qty } = await readJson(req);
    const event = events.get(eventId);
    if (!event) return send(res, 404, { error: "event not found" });
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) return send(res, 400, { error: "qty must be an integer 1..10" });
    if (!config.oversell && qty > remaining(event)) return send(res, 409, { error: "sold out" });
    event.held += qty;
    const cartId = `cart-${nextId++}`;
    const expiresAt = Date.now() + config.cartHoldMs;
    carts.set(cartId, { eventId, qty, expiresAt, status: "open" });
    capped(carts, MAX_CARTS);
    return send(res, 201, { cartId, eventId, qty, expiresAt: new Date(expiresAt).toISOString() });
  }

  // 2. Turn the cart into a checkout with a price.
  if (req.method === "POST" && pathname === "/checkouts") {
    const { cartId } = await readJson(req);
    const cart = carts.get(cartId);
    if (!cart) return send(res, 404, { error: "cart not found" });
    if (cart.status === "expired" || cart.expiresAt <= Date.now()) return send(res, 410, { error: "cart hold expired" });
    if (cart.status !== "open") return send(res, 409, { error: "cart already checked out" });
    cart.status = "checked_out";
    const checkoutId = `chk-${nextId++}`;
    const amountCents = cart.qty * PRICE_CENTS;
    checkouts.set(checkoutId, { cartId, eventId: cart.eventId, qty: cart.qty, amountCents, orderId: null });
    capped(checkouts, MAX_CARTS);
    return send(res, 201, { checkoutId, cartId, amountCents, currency: "USD" });
  }

  // 3. Sandbox payment. Idempotency-Key is required: the same key and body replays the first answer (no new charge).
  if (req.method === "POST" && pathname === "/payments") {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[\w-]{8,128}$/.test(key)) return send(res, 400, { error: "Idempotency-Key header required (8-128 chars)" });
    const body = await readJson(req);
    const fingerprint = createHash("sha256").update(JSON.stringify([body.checkoutId, body.method])).digest("hex");
    const seen = config.ignoreIdempotency ? undefined : payments.get(key);
    if (seen) {
      if (seen.fingerprint !== fingerprint) return send(res, 422, { error: "Idempotency-Key reused with a different request" });
      return send(res, seen.status, seen.body, { "Idempotent-Replayed": "true" });
    }
    const wait = paymentThrottle();
    if (wait) return send(res, 429, { error: "payment rate limit" }, { "Retry-After": String(wait) });
    const checkout = checkouts.get(body.checkoutId);
    if (!checkout) return send(res, 404, { error: "checkout not found" });
    if (body.method !== "card-sandbox") return send(res, 402, { error: "payment method declined", method: body.method ?? null });
    const cart = carts.get(checkout.cartId);
    if (!checkout.orderId && (!cart || !holding(cart) || cart.expiresAt <= Date.now())) return send(res, 410, { error: "cart hold expired" });

    const paymentId = `pay-${nextId++}`;
    charges.push({ paymentId, checkoutId: body.checkoutId, at: Date.now() });
    if (charges.length > MAX_ORDERS) charges.shift();
    const event = events.get(checkout.eventId);
    if (!checkout.orderId && Math.random() >= config.loseOrderRate) {
      // Held seats become sold; the order confirms after confirmDelayMs.
      event.held -= checkout.qty;
      event.sold += checkout.qty;
      cart.status = "paid";
      checkout.orderId = `ord-${nextOrder++}`;
      orders.set(checkout.orderId, { eventId: checkout.eventId, qty: checkout.qty, at: Date.now(), confirmAt: Date.now() + config.confirmDelayMs, paymentId });
      capped(orders, MAX_ORDERS);
    }
    const answer = { paymentId, status: "captured", checkoutId: body.checkoutId, orderId: checkout.orderId, amountCents: checkout.amountCents };
    payments.set(key, { fingerprint, status: 201, body: answer });
    capped(payments, MAX_ORDERS);
    // Charged, then the connection drops: only a retry with the same key gets the answer.
    if (Math.random() < config.dropAfterChargeRate) return req.socket.destroy();
    return send(res, 201, answer);
  }

  // 4. Confirmation: pending until confirmDelayMs after the charge.
  const order = pathname.match(/^\/orders\/(ord-\d+)$/);
  if (req.method === "GET" && order) {
    const o = orders.get(order[1]);
    return o ? send(res, 200, orderView(order[1], o)) : send(res, 404, { error: "order not found" });
  }

  const ticket = pathname.match(/^\/orders\/(ord-\d+)\/ticket$/);
  if (req.method === "GET" && ticket) {
    const order = orders.get(ticket[1]);
    if (!order) return send(res, 404, { error: "order not found" });
    return Date.now() - order.at < config.ticketDelayMs
      ? send(res, 200, { status: "pending" })
      : send(res, 200, { status: "issued", ticketId: `tkt-${ticket[1]}` });
  }

  if (req.method === "POST" && pathname === "/scan") {
    const { ticketId, gate } = await readJson(req);
    if (typeof ticketId !== "string" || !validTicket(ticketId)) return send(res, 404, { result: "unknown ticket" });
    if (scanned.has(ticketId)) return send(res, 409, { result: "already used" });
    scanned.add(ticketId);
    return send(res, 200, { result: "admitted", ticketId, gate: typeof gate === "string" ? gate : null });
  }

  return send(res, 404, { error: "not found" });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 400, { error: err.message }));
  })
  .listen(PORT, () => console.log(`mock-target listening on :${PORT}`, config));
