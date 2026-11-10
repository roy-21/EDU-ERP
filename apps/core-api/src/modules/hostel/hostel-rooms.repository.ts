import { PoolClient } from "pg";
import { postgresService } from "../../database/postgres";
import {
  HostelContext,
  HostelError,
  newId,
  toHostelError,
  toIso,
  toMoney,
  writeAudit,
} from "./hostel.common";
import { RoomInput } from "./hostel.validation";

const ROOM_SELECT = `
  SELECT r.*,
    (SELECT COUNT(*)::int FROM hostel_allocations a
      WHERE a.room_id = r.id AND a.status = 'Allocated') AS occupied,
    (SELECT COUNT(*)::int FROM hostel_seats s
      WHERE s.room_id = r.id AND s.reserved) AS reserved,
    (SELECT COUNT(*)::int FROM hostel_maintenance_tickets t
      WHERE t.room_id = r.id AND t.status <> 'Resolved') AS open_tickets,
    (SELECT COUNT(*)::int FROM hostel_maintenance_tickets t
      WHERE t.room_id = r.id AND t.status <> 'Resolved' AND t.blocks_room) AS blocking_tickets
  FROM hostel_rooms r`;

export const roomLabel = (row: any): string =>
  `${row.hostel_name} · ${row.building} · Room ${row.room_number}`;

const fromRow = (row: any) => {
  const isBlocked = row.under_maintenance || row.blocking_tickets > 0;

  return {
    id: row.id,
    hostelName: row.hostel_name,
    building: row.building,
    floor: row.floor,
    roomNumber: row.room_number,
    roomType: row.room_type,
    capacity: row.capacity,
    occupied: row.occupied,
    reserved: row.reserved,
    openTickets: row.open_tickets,
    blockingTickets: row.blocking_tickets,
    facilities: row.facilities,
    underMaintenance: row.under_maintenance,
    notes: row.notes,
    status: row.closed
      ? "Closed"
      : isBlocked
        ? "Maintenance"
        : row.occupied >= row.capacity
          ? "Occupied"
          : "Available",
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
};

const seatFromRow = (row: any, includeStudents = true) => ({
  id: row.id,
  roomId: row.room_id,
  seatNumber: row.seat_number,
  monthlyFee: toMoney(row.monthly_fee),
  allocationRent: row.allocation_id && row.allocation_rent !== undefined ? toMoney(row.allocation_rent) : null,
  reserved: row.reserved,
  dueDay: row.due_day,
  buildingId: row.building_id,
  buildingDueDay: row.building_due_day,
  allocationId: includeStudents ? row.allocation_id : null,
  studentId: includeStudents ? row.student_id : null,
  studentName: includeStudents ? row.student_name : null,
  status: row.allocation_id ? "Occupied" : row.reserved ? "Reserved" : "Available",
  hostelName: row.hostel_name,
  building: row.building,
  floor: row.floor,
  roomNumber: row.room_number,
  roomBlocked: row.room_blocked,
  roomClosed: row.room_closed,
});

const SEAT_SELECT = `
  SELECT s.*, a.id AS allocation_id, a.student_id, a.student_name, a.monthly_rent AS allocation_rent,
    r.hostel_name, r.building, r.floor, r.room_number, r.building_id,
    b.due_day AS building_due_day,
    r.closed AS room_closed,
    (r.closed OR r.under_maintenance OR EXISTS (
      SELECT 1 FROM hostel_maintenance_tickets t
      WHERE t.room_id = r.id AND t.status <> 'Resolved' AND t.blocks_room
    )) AS room_blocked
  FROM hostel_seats s
  JOIN hostel_rooms r ON r.id = s.room_id
  LEFT JOIN hostel_buildings b ON b.id = r.building_id
  LEFT JOIN hostel_allocations a ON a.seat_id = s.id AND a.status = 'Allocated'`;

const ensureBuilding = async (
  tx: PoolClient,
  institutionId: string,
  input: RoomInput
): Promise<string> => {
  const { rows } = await tx.query(
    `INSERT INTO hostel_buildings (id, institution_id, hostel_name, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (institution_id, LOWER(hostel_name), LOWER(name))
     DO UPDATE SET updated_at = hostel_buildings.updated_at
     RETURNING id`,
    [newId(), institutionId, input.hostelName, input.building]
  );
  return rows[0].id;
};

const insertRoom = async (
  tx: PoolClient,
  institutionId: string,
  input: RoomInput
): Promise<string> => {
  const id = newId();
  const buildingId = await ensureBuilding(tx, institutionId, input);

  await tx.query(
    `INSERT INTO hostel_rooms (id, institution_id, hostel_name, building, floor,
       room_number, room_type, capacity, facilities, under_maintenance, notes, building_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      institutionId,
      input.hostelName,
      input.building,
      input.floor,
      input.roomNumber,
      input.roomType,
      input.capacity,
      input.facilities,
      input.underMaintenance,
      input.notes,
      buildingId,
    ]
  );

  await tx.query(
    `INSERT INTO hostel_seats (id, institution_id, room_id, seat_number)
     SELECT gen_random_uuid()::text, $1, $2, n FROM generate_series(1, $3::int) AS n`,
    [institutionId, id, input.capacity]
  );

  return id;
};

const lockRoom = async (tx: PoolClient, institutionId: string, id: string) => {
  const result = await tx.query(
    "SELECT * FROM hostel_rooms WHERE institution_id = $1 AND id = $2 FOR UPDATE",
    [institutionId, id]
  );
  if (!result.rows[0]) throw new HostelError(404, "Room not found.");
  return result.rows[0];
};

const syncSeatsToCapacity = async (
  tx: PoolClient,
  institutionId: string,
  roomId: string,
  capacity: number
) => {
  const { rows: seats } = await tx.query(
    `SELECT s.id, s.seat_number, s.reserved,
       EXISTS (SELECT 1 FROM hostel_allocations a
               WHERE a.seat_id = s.id AND a.status = 'Allocated') AS occupied
     FROM hostel_seats s WHERE s.room_id = $1 ORDER BY s.seat_number DESC`,
    [roomId]
  );

  if (capacity < seats.length) {
    const removable = seats.filter((seat: any) => !seat.occupied && !seat.reserved);
    const minimum = seats.length - removable.length;
    if (capacity < minimum) {
      throw new HostelError(
        409,
        `Capacity cannot go below ${minimum}, because that many seats are occupied or reserved.`
      );
    }
    await tx.query("DELETE FROM hostel_seats WHERE id = ANY($1)", [
      removable.slice(0, seats.length - capacity).map((seat: any) => seat.id),
    ]);
    return;
  }

  // Fills gaps left by earlier removals before adding higher numbers.
  const taken = new Set(seats.map((seat: any) => seat.seat_number));
  let added = seats.length;
  for (let number = 1; added < capacity; number += 1) {
    if (taken.has(number)) continue;
    await tx.query(
      `INSERT INTO hostel_seats (id, institution_id, room_id, seat_number)
       VALUES ($1, $2, $3, $4)`,
      [newId(), institutionId, roomId, number]
    );
    added += 1;
  }
};

export const hostelRoomsRepository = {
  async list(institutionId: string) {
    const result = await postgresService.query(
      `${ROOM_SELECT} WHERE r.institution_id = $1
       ORDER BY r.hostel_name, r.building, r.room_number`,
      [institutionId]
    );
    return result.rows.map(fromRow);
  },

  async get(institutionId: string, id: string) {
    const result = await postgresService.query(
      `${ROOM_SELECT} WHERE r.institution_id = $1 AND r.id = $2`,
      [institutionId, id]
    );
    if (!result.rows[0]) throw new HostelError(404, "Room not found.");
    return fromRow(result.rows[0]);
  },

  async create(ctx: HostelContext, input: RoomInput) {
    const id = await postgresService
      .transaction(async (tx) => {
        const roomId = await insertRoom(tx, ctx.institutionId, input);
        await writeAudit(
          tx,
          ctx,
          "Created",
          "Room",
          roomId,
          `Added room ${input.roomNumber} in ${input.hostelName}, ${input.building} with ${input.capacity} seat(s).`
        );
        return roomId;
      })
      .catch((err) => {
        throw toHostelError(err);
      });
    return this.get(ctx.institutionId, id);
  },

  async createMany(ctx: HostelContext, inputs: RoomInput[]) {
    const key = (hostel: string, building: string, number: string) =>
      [hostel, building, number].join("\n").toLowerCase();

    const { rows } = await postgresService.query(
      "SELECT hostel_name, building, room_number FROM hostel_rooms WHERE institution_id = $1",
      [ctx.institutionId]
    );
    const taken = new Set(
      rows.map((row: any) => key(row.hostel_name, row.building, row.room_number))
    );

    const problems: string[] = [];
    inputs.forEach((input, index) => {
      const roomKey = key(input.hostelName, input.building, input.roomNumber);
      if (taken.has(roomKey)) {
        problems.push(`Row ${index + 1}: room ${input.roomNumber} already exists.`);
      }
      taken.add(roomKey);
    });
    if (problems.length > 0) {
      throw new HostelError(409, problems.slice(0, 5).join(" "));
    }

    await postgresService
      .transaction(async (tx) => {
        for (const input of inputs) {
          await insertRoom(tx, ctx.institutionId, input);
        }
        await writeAudit(
          tx,
          ctx,
          "Created",
          "Room",
          "",
          `Bulk added ${inputs.length} room(s).`
        );
      })
      .catch((err) => {
        throw toHostelError(err);
      });

    return { created: inputs.length };
  },

  async update(ctx: HostelContext, id: string, input: RoomInput) {
    await postgresService
      .transaction(async (tx) => {
        await lockRoom(tx, ctx.institutionId, id);
        await syncSeatsToCapacity(tx, ctx.institutionId, id, input.capacity);
        const buildingId = await ensureBuilding(tx, ctx.institutionId, input);

        const { rows } = await tx.query(
          `UPDATE hostel_rooms SET hostel_name = $3, building = $4, floor = $5,
             room_number = $6, room_type = $7, capacity = $8, facilities = $9,
             under_maintenance = $10, notes = $11, building_id = $12, updated_at = NOW()
           WHERE institution_id = $1 AND id = $2 RETURNING *`,
          [
            ctx.institutionId,
            id,
            input.hostelName,
            input.building,
            input.floor,
            input.roomNumber,
            input.roomType,
            input.capacity,
            input.facilities,
            input.underMaintenance,
            input.notes,
            buildingId,
          ]
        );

        const label = roomLabel(rows[0]);
        await tx.query("UPDATE hostel_allocations SET room_label = $2 WHERE room_id = $1", [id, label]);
        await tx.query("UPDATE hostel_maintenance_tickets SET room_label = $2 WHERE room_id = $1", [id, label]);
        await writeAudit(tx, ctx, "Updated", "Room", id, `Updated ${label}.`);
      })
      .catch((err) => {
        throw toHostelError(err);
      });

    return this.get(ctx.institutionId, id);
  },

  async setStatus(ctx: HostelContext, id: string, status: string) {
    const closed = status === "Closed";
    const underMaintenance = status === "Maintenance";

    await postgresService.transaction(async (tx) => {
      const room = await lockRoom(tx, ctx.institutionId, id);
      if (room.closed === closed && room.under_maintenance === underMaintenance) return;

      await tx.query(
        "UPDATE hostel_rooms SET closed = $2, under_maintenance = $3, updated_at = NOW() WHERE id = $1",
        [id, closed, underMaintenance]
      );
      await writeAudit(tx, ctx, "Updated", "Room", id, `Set ${roomLabel(room)} to ${status}.`);
    });

    return this.get(ctx.institutionId, id);
  },

  async remove(ctx: HostelContext, id: string) {
    await postgresService.transaction(async (tx) => {
      const room = await lockRoom(tx, ctx.institutionId, id);

      const active = await tx.query(
        "SELECT COUNT(*)::int AS count FROM hostel_allocations WHERE room_id = $1 AND status = 'Allocated'",
        [id]
      );
      if (active.rows[0].count > 0) {
        throw new HostelError(
          409,
          `Room ${room.room_number} still has ${active.rows[0].count} student(s). Move them out before deleting it.`
        );
      }

      const tickets = await tx.query(
        "SELECT COUNT(*)::int AS count FROM hostel_maintenance_tickets WHERE room_id = $1 AND status <> 'Resolved'",
        [id]
      );
      if (tickets.rows[0].count > 0) {
        throw new HostelError(
          409,
          `Room ${room.room_number} has ${tickets.rows[0].count} open maintenance ticket(s). Resolve them before deleting it.`
        );
      }

      await tx.query("DELETE FROM hostel_rooms WHERE id = $1", [id]);
      await writeAudit(tx, ctx, "Deleted", "Room", id, `Deleted ${roomLabel(room)}.`);
    });
  },

  async listSeats(institutionId: string, roomId?: string, includeStudents = true) {
    const result = await postgresService.query(
      `${SEAT_SELECT} WHERE s.institution_id = $1 ${roomId ? "AND s.room_id = $2" : ""}
       ORDER BY r.hostel_name, r.building, r.room_number, s.seat_number`,
      roomId ? [institutionId, roomId] : [institutionId]
    );
    return result.rows.map((row: any) => seatFromRow(row, includeStudents));
  },

  async getSeat(institutionId: string, id: string) {
    const result = await postgresService.query(`${SEAT_SELECT} WHERE s.institution_id = $1 AND s.id = $2`, [institutionId, id]);
    if (!result.rows[0]) throw new HostelError(404, "Seat not found.");
    return seatFromRow(result.rows[0]);
  },
};
