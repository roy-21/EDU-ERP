import { NextFunction, Request, Response, Router } from "express";
import { postgresService } from "../../database/postgres";
import { hostelAllocationsRepository, STUDENT_FIELDS } from "./hostel-allocations.repository";
import { generateInvoices } from "./hostel-billing.service";
import { hostelMaintenanceRepository } from "./hostel-maintenance.repository";
import { hostelRoomsRepository } from "./hostel-rooms.repository";
import { hostelRentSync } from "./hostel-rent-sync.service";
import { sendAllocationConfirmation } from "./hostel-operations.controller";
import { HostelError, contextOf, route, send, toIso } from "./hostel.common";
import { hasPermission, permissionsOf, requirePermission } from "./hostel.permissions";
import {
  parseAllocation,
  parseAllocationChanges,
  parseDate,
  parseMoney,
  parseOptionalSeatId,
  parseReason,
  parseRoom,
  parseSeat,
  parseSeatId,
  parseTicket,
} from "./hostel.validation";

export const hostelRouter = Router();

// Open rooms show as Available or Occupied, depending on their seats.
const ROOM_STATUSES = ["Open", "Maintenance", "Closed"];
const MAX_BULK_ROOMS = 500;
const DEFAULT_AUDIT_ROWS = 200;
const MAX_AUDIT_ROWS = 1000;

const canSeeStudents = (req: Request) =>
  hasPermission(req, "manage_allocations", "manage_students");

// Bills right away instead of waiting for the next scheduled run. The allocation
// is already saved, and the scheduler retries, so a failure here is only logged.
const billNow = async (req: Request) => {
  const ctx = contextOf(req);
  await generateInvoices(ctx.institutionId, { ctx }).catch((err) =>
    console.error("[Hostel] Immediate billing failed:", err.message)
  );
};

// The email goes out after the response, and its failure is logged, not returned.
const confirmLater = (req: Request, allocationId: string) => {
  sendAllocationConfirmation(contextOf(req), allocationId, false).catch((err) =>
    console.error("[Hostel] Allocation email failed:", err.message)
  );
};

hostelRouter.use("/hostel", (req: Request, res: Response, next: NextFunction) => {
  if (postgresService.isLive()) return next();

  res.status(503).json({
    success: false,
    statusCode: 503,
    error:
      "The hostel database is offline. Start PostgreSQL (docker compose up -d erp-postgres) and restart the backend.",
  });
});

hostelRouter.get(
  "/hostel/me/permissions",
  route(async (req, res) => {
    send(res, 200, { permissions: permissionsOf(req) });
  })
);

// Summary
hostelRouter.get(
  "/hostel/summary",
  requirePermission("view_rooms"),
  route(async (req, res) => {
    const institutionId = req.institutionId as string;
    const [rooms, pendingApplications] = await Promise.all([
      hostelRoomsRepository.list(institutionId),
      hostelAllocationsRepository.countPending(institutionId),
    ]);

    const hostels = new Map<string, { hostelName: string; rooms: number; seats: number; occupied: number; reserved: number; maintenanceRooms: number; closedRooms: number }>();
    for (const room of rooms) {
      const hostel = hostels.get(room.hostelName) || {
        hostelName: room.hostelName,
        rooms: 0,
        seats: 0,
        occupied: 0,
        reserved: 0,
        maintenanceRooms: 0,
        closedRooms: 0,
      };
      hostel.rooms += 1;
      hostel.seats += room.capacity;
      hostel.occupied += room.occupied;
      hostel.reserved += room.reserved;
      hostel.maintenanceRooms += room.status === "Maintenance" ? 1 : 0;
      hostel.closedRooms += room.status === "Closed" ? 1 : 0;
      hostels.set(room.hostelName, hostel);
    }

    const byHostel = [...hostels.values()];
    const total = (key: "rooms" | "seats" | "occupied" | "reserved" | "maintenanceRooms" | "closedRooms") =>
      byHostel.reduce((sum, hostel) => sum + hostel[key], 0);

    send(res, 200, {
      rooms: total("rooms"),
      seats: total("seats"),
      occupied: total("occupied"),
      reserved: total("reserved"),
      maintenanceRooms: total("maintenanceRooms"),
      closedRooms: total("closedRooms"),
      openTickets: rooms.reduce((sum: number, room: any) => sum + room.openTickets, 0),
      pendingApplications,
      byHostel,
    });
  })
);

// Rooms
hostelRouter.get(
  "/hostel/rooms",
  requirePermission("view_rooms"),
  route(async (req, res) => {
    send(res, 200, await hostelRoomsRepository.list(req.institutionId as string));
  })
);

hostelRouter.post(
  "/hostel/rooms/bulk",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    const rows = req.body?.rooms;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new HostelError(400, "Add at least one room.");
    }
    if (rows.length > MAX_BULK_ROOMS) {
      throw new HostelError(400, `A bulk add can have at most ${MAX_BULK_ROOMS} rooms.`);
    }

    const inputs = rows.map((row: unknown, index: number) => {
      try {
        return parseRoom(row);
      } catch (err) {
        if (err instanceof HostelError) {
          throw new HostelError(400, `Row ${index + 1}: ${err.message}`);
        }
        throw err;
      }
    });

    send(res, 201, await hostelRoomsRepository.createMany(contextOf(req), inputs));
  })
);

hostelRouter.post(
  "/hostel/rooms",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    send(res, 201, await hostelRoomsRepository.create(contextOf(req), parseRoom(req.body)));
  })
);

hostelRouter.get(
  "/hostel/rooms/:id",
  requirePermission("view_rooms"),
  route(async (req, res) => {
    const institutionId = req.institutionId as string;
    const { id } = req.params;
    const includeStudents = canSeeStudents(req);
    const room = await hostelRoomsRepository.get(institutionId, id);
    const [seats, allocations, tickets] = await Promise.all([
      hostelRoomsRepository.listSeats(institutionId, id, includeStudents),
      includeStudents ? hostelAllocationsRepository.list(institutionId, id) : [],
      hostelMaintenanceRepository.list(institutionId, id),
    ]);
    send(res, 200, { room, seats, allocations, tickets });
  })
);

hostelRouter.put(
  "/hostel/rooms/:id",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    send(res, 200, await hostelRoomsRepository.update(contextOf(req), req.params.id, parseRoom(req.body)));
  })
);

hostelRouter.post(
  "/hostel/rooms/:id/status",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    const status = req.body?.status;
    if (!ROOM_STATUSES.includes(status)) {
      throw new HostelError(400, `Status must be one of: ${ROOM_STATUSES.join(", ")}.`);
    }
    send(res, 200, await hostelRoomsRepository.setStatus(contextOf(req), req.params.id, status));
  })
);

hostelRouter.delete(
  "/hostel/rooms/:id",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    await hostelRoomsRepository.remove(contextOf(req), req.params.id);
    send(res, 200, { id: req.params.id });
  })
);

// Seats
hostelRouter.get(
  "/hostel/seats",
  requirePermission("view_rooms", "manage_allocations"),
  route(async (req, res) => {
    send(
      res,
      200,
      await hostelRoomsRepository.listSeats(req.institutionId as string, undefined, canSeeStudents(req))
    );
  })
);

hostelRouter.put(
  "/hostel/seats/:id",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    await hostelRentSync.updateSeat(contextOf(req), req.params.id, parseSeat(req.body));
    send(res, 200, await hostelRoomsRepository.getSeat(req.institutionId as string, req.params.id));
  })
);

// Allocations
hostelRouter.get(
  "/hostel/allocations",
  requirePermission("manage_allocations", "manage_students"),
  route(async (req, res) => {
    send(res, 200, await hostelAllocationsRepository.list(req.institutionId as string));
  })
);

hostelRouter.get(
  "/hostel/allocations/:id",
  requirePermission("manage_allocations", "manage_students", "view_due_rent", "manage_payments"),
  route(async (req, res) => {
    send(
      res,
      200,
      await hostelAllocationsRepository.get(
        req.institutionId as string,
        req.params.id,
        hasPermission(req, "manage_students")
      )
    );
  })
);

hostelRouter.post(
  "/hostel/allocations",
  requirePermission("manage_allocations"),
  route(async (req, res) => {
    const allocation = await hostelAllocationsRepository.create(
      contextOf(req),
      parseAllocation(req.body),
      parseOptionalSeatId(req.body?.seatId)
    );
    if (allocation.status === "Allocated") {
      await billNow(req);
      confirmLater(req, allocation.id);
    }
    send(res, 201, allocation);
  })
);

hostelRouter.put(
  "/hostel/allocations/:id",
  requirePermission("manage_allocations", "manage_students"),
  route(async (req, res) => {
    const changes = parseAllocationChanges(req.body);
    const keys = Object.keys(changes) as (keyof typeof changes)[];

    if (keys.some((key) => STUDENT_FIELDS.includes(key)) && !hasPermission(req, "manage_students")) {
      throw new HostelError(403, "You do not have permission to change student information.");
    }
    if (keys.some((key) => !STUDENT_FIELDS.includes(key)) && !hasPermission(req, "manage_allocations")) {
      throw new HostelError(403, "You do not have permission to change allocation details.");
    }

    send(
      res,
      200,
      await hostelAllocationsRepository.update(
        contextOf(req),
        req.params.id,
        changes,
        hasPermission(req, "manage_students")
      )
    );
  })
);

hostelRouter.post(
  "/hostel/allocations/:id/assign",
  requirePermission("manage_allocations"),
  route(async (req, res) => {
    const body = req.body ?? {};
    const before = await hostelAllocationsRepository.get(req.institutionId as string, req.params.id, false);
    const isTransfer = before.status === "Allocated";
    const allocation = await hostelAllocationsRepository.assignSeat(
      contextOf(req),
      req.params.id,
      parseSeatId(body.seatId),
      {
        monthlyRent: body.monthlyRent === undefined ? undefined : parseMoney(body.monthlyRent, "Monthly rent"),
        securityDeposit:
          body.securityDeposit === undefined ? undefined : parseMoney(body.securityDeposit, "Security deposit"),
        startDate: body.startDate ? parseDate(body.startDate, "Allocation start date") : undefined,
        firstDueDate: body.firstDueDate ? parseDate(body.firstDueDate, "Initial payment due date") : undefined,
      }
    );
    await billNow(req);
    if (!isTransfer) confirmLater(req, allocation.id);
    send(res, 200, allocation);
  })
);

hostelRouter.post(
  "/hostel/allocations/:id/reject",
  requirePermission("manage_allocations"),
  route(async (req, res) => {
    send(res, 200, await hostelAllocationsRepository.reject(contextOf(req), req.params.id, parseReason(req.body?.reason)));
  })
);

hostelRouter.post(
  "/hostel/allocations/:id/vacate",
  requirePermission("manage_allocations"),
  route(async (req, res) => {
    const endDate = req.body?.endDate ? parseDate(req.body.endDate, "End date") : null;
    const allocation = await hostelAllocationsRepository.vacate(contextOf(req), req.params.id, endDate);
    await billNow(req);
    send(res, 200, allocation);
  })
);

hostelRouter.delete(
  "/hostel/allocations/:id",
  requirePermission("manage_allocations"),
  route(async (req, res) => {
    await hostelAllocationsRepository.remove(contextOf(req), req.params.id);
    send(res, 200, { id: req.params.id });
  })
);

// Maintenance
hostelRouter.get(
  "/hostel/tickets",
  requirePermission("view_rooms"),
  route(async (req, res) => {
    send(res, 200, await hostelMaintenanceRepository.list(req.institutionId as string));
  })
);

hostelRouter.post(
  "/hostel/tickets",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    const roomId = req.body?.roomId;
    if (typeof roomId !== "string" || !roomId) {
      throw new HostelError(400, "Room is required.");
    }
    send(res, 201, await hostelMaintenanceRepository.create(contextOf(req), roomId, parseTicket(req.body)));
  })
);

hostelRouter.put(
  "/hostel/tickets/:id",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    send(res, 200, await hostelMaintenanceRepository.update(contextOf(req), req.params.id, parseTicket(req.body)));
  })
);

hostelRouter.delete(
  "/hostel/tickets/:id",
  requirePermission("manage_rooms"),
  route(async (req, res) => {
    await hostelMaintenanceRepository.remove(contextOf(req), req.params.id);
    send(res, 200, { id: req.params.id });
  })
);

// Audit log
hostelRouter.get(
  "/hostel/audit",
  requirePermission("manage_rooms", "manage_allocations", "configure_rent", "manage_payments"),
  route(async (req, res) => {
    const requested = Number(req.query.limit);
    const limit =
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, MAX_AUDIT_ROWS)
        : DEFAULT_AUDIT_ROWS;

    const { rows } = await postgresService.query(
      `SELECT * FROM hostel_audit_log WHERE institution_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [req.institutionId, limit]
    );
    send(
      res,
      200,
      rows.map((row: any) => ({
        id: row.id,
        actorEmail: row.actor_email,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        createdAt: toIso(row.created_at),
      }))
    );
  })
);
