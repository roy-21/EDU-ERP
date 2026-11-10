// Needs PostgreSQL (docker compose up -d erp-postgres). Skips when it is offline.
const assert = require("node:assert");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../dist/app");
const { postgresService } = require("../dist/database/postgres");
const { createClient, live, removeInstitutions } = require("./hostel-helpers");

const app = createApp();
let server;
let baseUrl;

const { institution: INSTITUTION, call } = createClient(() => baseUrl);
const { institution: OTHER_INSTITUTION } = createClient(() => baseUrl);

let roomCounter = 0;
const roomBody = (change = {}) => ({
  hostelName: "Test Hostel",
  building: "T Block",
  floor: "3rd Floor",
  roomNumber: `R-${(roomCounter += 1)}`,
  roomType: "DELUXE",
  capacity: 2,
  facilities: ["Wi-Fi", " Wi-Fi ", "AC"],
  notes: "  Near stairs  ",
  ...change,
});

const createRoom = async (change) => {
  const res = await call("POST", "/hostel/rooms", roomBody(change));
  assert.strictEqual(res.status, 201, res.error);
  return res.data;
};

const seatsOf = async (roomId) =>
  (await call("GET", `/hostel/rooms/${roomId}`)).data.seats;

const student = (id) => ({
  studentId: id,
  studentName: `Student ${id}`,
  studentPhone: "01711111111",
  guardianName: "Guardian",
  guardianPhone: "01700000000",
  monthlyRent: 5000,
  startDate: new Date().toISOString().slice(0, 10),
});

test.before(async () => {
  await postgresService.initialize();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (postgresService.isLive()) {
    await removeInstitutions([INSTITUTION, OTHER_INSTITUTION]);
  }
});

test("creating a room creates its seats", live(async () => {
  const room = await createRoom({ capacity: 3 });
  assert.strictEqual(room.status, "Available");
  assert.deepStrictEqual(room.facilities, ["Wi-Fi", "AC"]);
  assert.strictEqual(room.notes, "Near stairs");
  assert.deepStrictEqual((await seatsOf(room.id)).map((seat) => seat.seatNumber), [1, 2, 3]);
}));

test("invalid rooms are rejected", live(async () => {
  const cases = [
    [{ hostelName: " " }, /Hostel is required/],
    [{ roomNumber: "" }, /Room number is required/],
    [{ capacity: 0 }, /Capacity/],
    [{ capacity: "4" }, /Capacity/],
    [{ capacity: 1.5 }, /Capacity/],
    [{ roomType: "VIP" }, /Room type/],
    [{ facilities: "Wi-Fi" }, /Facilities/],
  ];
  for (const [change, message] of cases) {
    const res = await call("POST", "/hostel/rooms", roomBody(change));
    assert.strictEqual(res.status, 400, JSON.stringify(change));
    assert.match(res.error, message);
  }
}));

test("a room number is unique per hostel building, ignoring case", live(async () => {
  const first = await createRoom({ roomNumber: "D-1" });
  const duplicate = await call("POST", "/hostel/rooms", roomBody({ roomNumber: "d-1" }));
  assert.strictEqual(duplicate.status, 409);

  const other = await createRoom({ roomNumber: "D-1", building: "U Block" });
  const moved = await call("PUT", `/hostel/rooms/${other.id}`, roomBody({ roomNumber: "D-1" }));
  assert.strictEqual(moved.status, 409);

  const unchanged = await call("PUT", `/hostel/rooms/${first.id}`, roomBody({ roomNumber: "D-1" }));
  assert.strictEqual(unchanged.status, 200);
}));

test("allocation drives occupancy, transfer and vacate", live(async () => {
  const room = await createRoom({ capacity: 2 });
  const [seat1, seat2] = await seatsOf(room.id);

  const first = await call("POST", "/hostel/allocations", { ...student("A1"), seatId: seat1.id });
  assert.strictEqual(first.status, 201, first.error);
  assert.strictEqual(first.data.status, "Allocated");
  assert.strictEqual(first.data.seatNumber, 1);

  const taken = await call("POST", "/hostel/allocations", { ...student("A2"), seatId: seat1.id });
  assert.strictEqual(taken.status, 409);
  const notSaved = await call("POST", "/hostel/allocations", student("A2"));
  assert.strictEqual(notSaved.status, 201, "a failed allocation must leave nothing behind");

  const again = await call("POST", "/hostel/allocations", student("a1"));
  assert.strictEqual(again.status, 409, "one active allocation per student");

  const assigned = await call("POST", `/hostel/allocations/${notSaved.data.id}/assign`, { seatId: seat2.id });
  assert.strictEqual(assigned.status, 200);

  const full = (await call("GET", `/hostel/rooms/${room.id}`)).data;
  assert.strictEqual(full.room.occupied, 2);
  assert.strictEqual(full.room.status, "Occupied");
  assert.strictEqual(full.seats[0].studentName, "Student A1");

  const blockedDelete = await call("DELETE", `/hostel/rooms/${room.id}`);
  assert.strictEqual(blockedDelete.status, 409);

  const shrink = await call("PUT", `/hostel/rooms/${room.id}`, roomBody({ roomNumber: room.roomNumber, capacity: 1 }));
  assert.strictEqual(shrink.status, 409);

  const other = await createRoom({ capacity: 1 });
  const [otherSeat] = await seatsOf(other.id);
  const moved = await call("POST", `/hostel/allocations/${first.data.id}/assign`, { seatId: otherSeat.id });
  assert.strictEqual(moved.status, 200);
  assert.strictEqual(moved.data.roomId, other.id);
  assert.strictEqual((await call("GET", `/hostel/rooms/${room.id}`)).data.room.occupied, 1);

  const vacated = await call("POST", `/hostel/allocations/${assigned.data.id}/vacate`);
  assert.strictEqual(vacated.data.status, "Vacated");
  assert.ok(vacated.data.vacatedAt);
  assert.strictEqual((await call("POST", `/hostel/allocations/${assigned.data.id}/vacate`)).status, 409);
  assert.strictEqual((await call("DELETE", `/hostel/allocations/${assigned.data.id}`)).status, 409);

  const deleted = await call("DELETE", `/hostel/rooms/${room.id}`);
  assert.strictEqual(deleted.status, 200);

  const history = (await call("GET", "/hostel/allocations")).data.find((item) => item.id === assigned.data.id);
  assert.strictEqual(history.roomId, null);
  assert.match(history.roomLabel, new RegExp(room.roomNumber));
  assert.strictEqual(history.seatNumber, 2);
}));

test("two requests for one seat give it to only one student", live(async () => {
  const room = await createRoom({ capacity: 1 });
  const [seat] = await seatsOf(room.id);
  const results = await Promise.all(
    ["C1", "C2", "C3", "C4"].map((id) =>
      call("POST", "/hostel/allocations", { ...student(id), seatId: seat.id })
    )
  );
  assert.deepStrictEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
}));

test("capacity changes keep seats in step", live(async () => {
  const room = await createRoom({ capacity: 3 });
  const body = (capacity) => roomBody({ roomNumber: room.roomNumber, capacity });
  const seats = await seatsOf(room.id);

  await call("PUT", `/hostel/seats/${seats[2].id}`, { reserved: true, monthlyFee: 3500 });
  const shrunk = await call("PUT", `/hostel/rooms/${room.id}`, body(2));
  assert.strictEqual(shrunk.status, 200, shrunk.error);
  assert.deepStrictEqual((await seatsOf(room.id)).map((seat) => seat.seatNumber), [1, 3]);

  const grown = await call("PUT", `/hostel/rooms/${room.id}`, body(4));
  assert.strictEqual(grown.status, 200, grown.error);
  assert.deepStrictEqual((await seatsOf(room.id)).map((seat) => seat.seatNumber), [1, 2, 3, 4]);

  const after = await seatsOf(room.id);
  assert.strictEqual(after[2].status, "Reserved");
  assert.strictEqual(after[2].monthlyFee, 3500);

  await call("PUT", `/hostel/rooms/${room.id}`, body(1));
  assert.deepStrictEqual((await seatsOf(room.id)).map((seat) => seat.seatNumber), [3]);
}));

test("an admin can set a room to maintenance, closed or open", live(async () => {
  const room = await createRoom({ capacity: 1 });
  const path = `/hostel/rooms/${room.id}/status`;
  const statusIs = async (expected) =>
    assert.strictEqual((await call("GET", `/hostel/rooms/${room.id}`)).data.room.status, expected);

  assert.strictEqual((await call("POST", path, { status: "Full" })).status, 400);
  assert.strictEqual((await call("POST", path, {})).status, 400);

  const maintenance = await call("POST", path, { status: "Maintenance" });
  assert.strictEqual(maintenance.status, 200, maintenance.error);
  assert.strictEqual(maintenance.data.status, "Maintenance");
  const [seat] = await seatsOf(room.id);
  assert.strictEqual((await call("POST", "/hostel/allocations", { ...student("M1"), seatId: seat.id })).status, 409);

  const closed = await call("POST", path, { status: "Closed" });
  assert.strictEqual(closed.data.status, "Closed");
  assert.strictEqual(closed.data.underMaintenance, false);
  const audit = (await call("GET", "/hostel/audit?limit=1")).data[0];
  assert.match(audit.summary, /to Closed\.$/);

  const repeated = await call("POST", path, { status: "Closed" });
  assert.strictEqual(repeated.status, 200);
  assert.strictEqual((await call("GET", "/hostel/audit?limit=1")).data[0].id, audit.id, "no audit entry when nothing changed");

  const refused = await call("POST", "/hostel/allocations", { ...student("M2"), seatId: seat.id });
  assert.strictEqual(refused.status, 409);
  assert.match(refused.error, /is closed/);
  assert.strictEqual((await seatsOf(room.id))[0].roomBlocked, true);
  assert.strictEqual((await seatsOf(room.id))[0].roomClosed, true);

  // Editing the room or resolving a ticket does not reopen it.
  const edited = await call("PUT", `/hostel/rooms/${room.id}`, roomBody({ roomNumber: room.roomNumber, capacity: 1 }));
  assert.strictEqual(edited.data.status, "Closed");
  const ticket = await call("POST", "/hostel/tickets", { roomId: room.id, title: "Leak", blocksRoom: true });
  await statusIs("Closed");
  await call("PUT", `/hostel/tickets/${ticket.data.id}`, { title: "Leak", blocksRoom: true, status: "Resolved" });
  await statusIs("Closed");

  const hostelRow = (await call("GET", "/hostel/summary")).data.byHostel.find((item) => item.hostelName === room.hostelName);
  assert.ok(hostelRow.closedRooms >= 1);

  const opened = await call("POST", path, { status: "Open" });
  assert.strictEqual(opened.data.status, "Available");

  // A blocking ticket still holds an open room in maintenance.
  const blocking = await call("POST", "/hostel/tickets", { roomId: room.id, title: "Leak 2", blocksRoom: true });
  const blocked = (await call("POST", path, { status: "Open" })).data;
  assert.strictEqual(blocked.status, "Maintenance");
  assert.strictEqual(blocked.blockingTickets, 1);
  await call("DELETE", `/hostel/tickets/${blocking.data.id}`);

  assert.strictEqual((await call("POST", path, { status: "Closed" }, "TEACHER")).status, 403);
  assert.strictEqual((await call("POST", path, { status: "Closed" }, "ADMIN", OTHER_INSTITUTION)).status, 404);
}));

test("reject and delete follow the application status", live(async () => {
  const pending = (await call("POST", "/hostel/allocations", student("R1"))).data;
  const rejected = await call("POST", `/hostel/allocations/${pending.id}/reject`, { reason: "No seats" });
  assert.strictEqual(rejected.data.status, "Rejected");
  assert.strictEqual(rejected.data.rejectReason, "No seats");
  assert.strictEqual((await call("POST", `/hostel/allocations/${pending.id}/reject`, {})).status, 409);

  const reapply = await call("POST", "/hostel/allocations", student("R1"));
  assert.strictEqual(reapply.status, 201, "a rejected student can apply again");

  assert.strictEqual((await call("DELETE", `/hostel/allocations/${pending.id}`)).status, 200);
}));

test("a blocking ticket closes a room until it is resolved", live(async () => {
  const room = await createRoom({ capacity: 2 });
  const [seat] = await seatsOf(room.id);
  const ticketBody = { roomId: room.id, title: "Leak", category: "Plumbing", priority: "High", blocksRoom: true };

  const ticket = await call("POST", "/hostel/tickets", ticketBody);
  assert.strictEqual(ticket.status, 201, ticket.error);
  assert.strictEqual((await call("GET", `/hostel/rooms/${room.id}`)).data.room.status, "Maintenance");

  const blocked = await call("POST", "/hostel/allocations", { ...student("T1"), seatId: seat.id });
  assert.strictEqual(blocked.status, 409);
  assert.match(blocked.error, /maintenance/);
  assert.strictEqual((await call("DELETE", `/hostel/rooms/${room.id}`)).status, 409);

  const resolved = await call("PUT", `/hostel/tickets/${ticket.data.id}`, { ...ticketBody, status: "Resolved" });
  assert.ok(resolved.data.resolvedAt);
  assert.strictEqual((await call("GET", `/hostel/rooms/${room.id}`)).data.room.status, "Available");

  const reopened = await call("PUT", `/hostel/tickets/${ticket.data.id}`, { ...ticketBody, status: "Open" });
  assert.strictEqual(reopened.data.resolvedAt, null);
  assert.strictEqual((await call("DELETE", `/hostel/tickets/${ticket.data.id}`)).status, 200);
  assert.strictEqual((await call("GET", "/hostel/tickets")).data.some((item) => item.id === ticket.data.id), false);

  assert.strictEqual((await call("POST", "/hostel/tickets", { title: "No room" })).status, 400);
  assert.strictEqual((await call("POST", "/hostel/tickets", { ...ticketBody, priority: "Urgent" })).status, 400);
}));

test("bulk add is all or nothing and reports the bad row", live(async () => {
  const count = async () => (await call("GET", "/hostel/rooms")).data.length;
  const before = await count();
  const rows = [roomBody({ roomNumber: "B-1" }), roomBody({ roomNumber: "B-2", capacity: 5 })];

  const invalid = await call("POST", "/hostel/rooms/bulk", { rooms: [rows[0], { ...rows[1], capacity: 0 }] });
  assert.strictEqual(invalid.status, 400);
  assert.match(invalid.error, /^Row 2:/);

  const repeated = await call("POST", "/hostel/rooms/bulk", { rooms: [rows[0], { ...rows[0], roomNumber: "b-1" }] });
  assert.strictEqual(repeated.status, 409);
  assert.strictEqual(await count(), before);

  assert.strictEqual((await call("POST", "/hostel/rooms/bulk", { rooms: [] })).status, 400);

  const created = await call("POST", "/hostel/rooms/bulk", { rooms: rows });
  assert.strictEqual(created.status, 201, created.error);
  assert.strictEqual(created.data.created, 2);
  assert.strictEqual(await count(), before + 2);

  const again = await call("POST", "/hostel/rooms/bulk", { rooms: rows });
  assert.strictEqual(again.status, 409);
  assert.match(again.error, /Row 1: room B-1 already exists/);
}));

test("summary counts real data and audit records who did what", live(async () => {
  const hostelName = `Summary ${randomUUID().slice(0, 6)}`;
  const room = await createRoom({ hostelName, capacity: 2 });
  const [seat] = await seatsOf(room.id);
  await call("POST", "/hostel/allocations", { ...student("S1"), seatId: seat.id });
  await call("POST", "/hostel/allocations", student("S2"));

  const summary = (await call("GET", "/hostel/summary")).data;
  const hostel = summary.byHostel.find((item) => item.hostelName === hostelName);
  assert.deepStrictEqual(
    { rooms: hostel.rooms, seats: hostel.seats, occupied: hostel.occupied },
    { rooms: 1, seats: 2, occupied: 1 }
  );
  assert.ok(summary.pendingApplications >= 1);

  const audit = (await call("GET", "/hostel/audit?limit=5")).data;
  assert.strictEqual(audit.length, 5);
  assert.strictEqual(audit[0].actorEmail, "test@example.com");
  assert.match(audit[0].summary, /Student S2/);
}));

test("only hostel managers can change rooms or see student data", live(async () => {
  assert.strictEqual((await call("GET", "/hostel/rooms", undefined, null)).status, 401);
  assert.strictEqual((await call("GET", "/hostel/rooms", undefined, "TEACHER")).status, 403);
  assert.strictEqual((await call("GET", "/hostel/summary", undefined, "TEACHER")).status, 403);

  const forbidden = [
    ["POST", "/hostel/rooms"],
    ["POST", "/hostel/rooms/bulk"],
    ["GET", "/hostel/rooms/x"],
    ["DELETE", "/hostel/rooms/x"],
    ["GET", "/hostel/seats"],
    ["GET", "/hostel/allocations"],
    ["POST", "/hostel/allocations"],
    ["GET", "/hostel/tickets"],
    ["GET", "/hostel/audit"],
  ];
  for (const [method, path] of forbidden) {
    const res = await call(method, path, method === "POST" ? {} : undefined, "TEACHER");
    assert.strictEqual(res.status, 403, `${method} ${path}`);
  }

  assert.strictEqual((await call("POST", "/hostel/rooms", roomBody(), "HOSTEL_WARDEN")).status, 201);
  assert.strictEqual((await call("POST", "/hostel/rooms", roomBody(), "SUPER_ADMIN")).status, 201);
}));

test("data from another institution cannot be read or changed", live(async () => {
  const room = await createRoom({ capacity: 1 });
  const [seat] = await seatsOf(room.id);
  const allocation = (await call("POST", "/hostel/allocations", { ...student("X1"), seatId: seat.id })).data;
  const ticket = (await call("POST", "/hostel/tickets", { roomId: room.id, title: "Fan" })).data;

  const asOther = (method, path, body) => call(method, path, body, "ADMIN", OTHER_INSTITUTION);

  assert.strictEqual((await asOther("GET", "/hostel/rooms")).data.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/seats")).data.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/allocations")).data.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/tickets")).data.length, 0);
  assert.strictEqual((await asOther("GET", "/hostel/audit")).data.length, 0);
  assert.strictEqual((await asOther("GET", `/hostel/rooms/${room.id}`)).status, 404);
  assert.strictEqual((await asOther("PUT", `/hostel/rooms/${room.id}`, roomBody())).status, 404);
  assert.strictEqual((await asOther("DELETE", `/hostel/rooms/${room.id}`)).status, 404);
  assert.strictEqual((await asOther("PUT", `/hostel/seats/${seat.id}`, {})).status, 404);
  assert.strictEqual((await asOther("POST", "/hostel/allocations", { ...student("X2"), seatId: seat.id })).status, 404);
  assert.strictEqual((await asOther("POST", `/hostel/allocations/${allocation.id}/vacate`)).status, 404);
  assert.strictEqual((await asOther("DELETE", `/hostel/allocations/${allocation.id}`)).status, 404);
  assert.strictEqual((await asOther("POST", "/hostel/tickets", { roomId: room.id, title: "x" })).status, 404);
  assert.strictEqual((await asOther("PUT", `/hostel/tickets/${ticket.id}`, { title: "x" })).status, 404);
  assert.strictEqual((await asOther("DELETE", `/hostel/tickets/${ticket.id}`)).status, 404);
}));
