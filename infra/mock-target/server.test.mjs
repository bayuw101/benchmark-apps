// node --test infra/mock-target/server.test.mjs — starts the mock on a free port and walks the purchase flow and its faults.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

let base;
let proc;
before(async () => {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  proc = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: { ...process.env, PORT: String(port), SEATS: "10", CONFIRM_DELAY_MS: "100", PAYMENT_RPS: "5" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await once(proc.stdout, "data");
  base = `http://127.0.0.1:${port}`;
});
after(() => proc.kill());

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: await res.json() };
};
const admin = (patch) => call("POST", "/__admin/config", patch);
const key = () => `k-${crypto.randomUUID()}`;

async function buy(qty = 2, k = key()) {
  const cart = await call("POST", "/carts", { eventId: "evt-1", qty });
  const chk = await call("POST", "/checkouts", { cartId: cart.body.cartId });
  const pay = await call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": k });
  return { cart, chk, pay, k };
}

test("serves the ticketing UI without changing the benchmark API", async () => {
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.match(await page.text(), /GatePass Tickets/);
  const script = await fetch(base + "/app.js");
  assert.equal(script.status, 200);
  assert.match(await script.text(), /POST|payments/);
  assert.equal((await call("GET", "/events")).status, 200);
});

test("cart → checkout → payment → confirmed order → ticket", async () => {
  await call("POST", "/__admin/reset");
  const { cart, chk, pay } = await buy(2);
  assert.equal(cart.status, 201);
  assert.equal((await call("GET", "/events/evt-1")).body.held, 0, "payment turns the hold into a sale");
  assert.equal(chk.body.amountCents, 5000);
  assert.equal(pay.status, 201);
  assert.equal((await call("GET", `/orders/${pay.body.orderId}`)).body.status, "pending");
  await new Promise((r) => setTimeout(r, 150));
  const confirmed = (await call("GET", `/orders/${pay.body.orderId}`)).body;
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.ticketId, `tkt-${pay.body.orderId}`);
  assert.equal((await call("POST", "/checkouts", { cartId: cart.body.cartId })).status, 409, "a cart checks out once");
});

test("holds count against inventory", async () => {
  await call("POST", "/__admin/reset");
  assert.equal((await call("POST", "/carts", { eventId: "evt-1", qty: 10 })).status, 201);
  assert.equal((await call("POST", "/carts", { eventId: "evt-1", qty: 1 })).status, 409);
  assert.equal((await call("POST", "/orders", { eventId: "evt-1", qty: 1 })).status, 409, "old /orders respects holds too");
});

test("an unpaid checkout gives its seats back when the hold runs out, and can't be paid after", async () => {
  await call("POST", "/__admin/reset");
  await admin({ cartHoldMs: 300 });
  const cart = await call("POST", "/carts", { eventId: "evt-2", qty: 3 });
  const chk = await call("POST", "/checkouts", { cartId: cart.body.cartId });
  assert.equal(chk.status, 201);
  await admin({ cartHoldMs: 600_000 });
  await new Promise((r) => setTimeout(r, 1400));
  assert.equal((await call("GET", "/events/evt-2")).body.held, 0);
  const pay = await call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": key() });
  assert.equal(pay.status, 410);
  assert.equal((await call("GET", "/__admin/integrity")).body.charges, 0);
});

test("same Idempotency-Key replays without a second charge; a different body is refused", async () => {
  await call("POST", "/__admin/reset");
  const { chk, pay, k } = await buy(1);
  const again = await call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": k });
  assert.equal(again.status, 201);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.deepEqual(again.body, pay.body);
  assert.equal((await call("POST", "/payments", { checkoutId: "chk-x", method: "card-sandbox" }, { "Idempotency-Key": k })).status, 422);
  assert.equal((await call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" })).status, 400, "key required");
  const i = (await call("GET", "/__admin/integrity")).body;
  assert.equal(i.charges, 1);
  assert.equal(i.ok, true);
});

test("dropped connection after charge: the retry gets the same payment", async () => {
  await call("POST", "/__admin/reset");
  await admin({ dropAfterChargeRate: 1 });
  const cart = await call("POST", "/carts", { eventId: "evt-1", qty: 1 });
  const chk = await call("POST", "/checkouts", { cartId: cart.body.cartId });
  const k = key();
  await assert.rejects(call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": k }));
  await admin({ dropAfterChargeRate: 0 });
  const retry = await call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": k });
  assert.equal(retry.headers.get("idempotent-replayed"), "true");
  assert.equal((await call("GET", "/__admin/integrity")).body.doubleCharges, 0);
});

test("faults show up in integrity: ignored idempotency double-charges, lost order is charged-no-ticket", async () => {
  await call("POST", "/__admin/reset");
  await admin({ ignoreIdempotency: true });
  const { chk, k } = await buy(1);
  await call("POST", "/payments", { checkoutId: chk.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": k });
  await admin({ ignoreIdempotency: false, loseOrderRate: 1 });
  await buy(1);
  await admin({ loseOrderRate: 0 });
  const i = (await call("GET", "/__admin/integrity")).body;
  assert.equal(i.doubleCharges, 1);
  assert.equal(i.chargedNoTicket, 1);
  assert.equal(i.ok, false);
});

test("payment sandbox rate limit answers 429 with Retry-After", async () => {
  await call("POST", "/__admin/reset");
  const statuses = [];
  let retryAfter = null;
  for (let n = 0; n < 8; n++) {
    const r = await call("POST", "/payments", { checkoutId: "chk-none", method: "card-sandbox" }, { "Idempotency-Key": key() });
    statuses.push(r.status);
    retryAfter ??= r.headers.get("retry-after");
  }
  assert.ok(statuses.includes(429), String(statuses));
  assert.ok(Number(retryAfter) >= 1);
});

test("integrity can be limited to a run's window", async () => {
  await call("POST", "/__admin/reset");
  await call("POST", "/__admin/config", { ignoreIdempotency: true });
  const before = Date.now();
  const cart = await call("POST", "/carts", { eventId: "evt-1", qty: 1 });
  const co = await call("POST", "/checkouts", { cartId: cart.body.cartId });
  const pay = () => call("POST", "/payments", { checkoutId: co.body.checkoutId, method: "card-sandbox" }, { "Idempotency-Key": "window-key-1" });
  await pay();
  await pay();
  await call("POST", "/__admin/config", { ignoreIdempotency: false });
  const all = (await call("GET", "/__admin/integrity")).body;
  assert.equal(all.doubleCharges, 1);
  const earlier = (await call("GET", `/__admin/integrity?since=0&until=${before - 1}`)).body;
  assert.equal(earlier.doubleCharges, 0);
  assert.equal(earlier.charges, 0);
  assert.equal((await call("GET", `/__admin/integrity?since=${before}&until=${Date.now()}`)).body.doubleCharges, 1);
  assert.equal((await call("GET", "/__admin/integrity?since=5&until=1")).status, 400);
});
