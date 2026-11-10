import { postgresService } from "../../database/postgres";
import {
  HostelContext,
  HostelError,
  newId,
  toIso,
  writeAudit,
} from "./hostel.common";
import { roomLabel } from "./hostel-rooms.repository";
import { TicketInput } from "./hostel.validation";

const fromRow = (row: any) => ({
  id: row.id,
  roomId: row.room_id,
  roomLabel: row.room_label,
  title: row.title,
  description: row.description,
  category: row.category,
  priority: row.priority,
  status: row.status,
  blocksRoom: row.blocks_room,
  assignedTo: row.assigned_to,
  reportedBy: row.reported_by,
  resolvedAt: toIso(row.resolved_at),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

export const hostelMaintenanceRepository = {
  async list(institutionId: string, roomId?: string) {
    const result = await postgresService.query(
      `SELECT * FROM hostel_maintenance_tickets WHERE institution_id = $1
       ${roomId ? "AND room_id = $2" : ""} ORDER BY created_at DESC`,
      roomId ? [institutionId, roomId] : [institutionId]
    );
    return result.rows.map(fromRow);
  },

  create(ctx: HostelContext, roomId: string, input: TicketInput) {
    return postgresService.transaction(async (tx) => {
      const room = await tx.query(
        "SELECT * FROM hostel_rooms WHERE institution_id = $1 AND id = $2 FOR UPDATE",
        [ctx.institutionId, roomId]
      );
      if (!room.rows[0]) throw new HostelError(404, "Room not found.");

      const id = newId();
      const label = roomLabel(room.rows[0]);
      const { rows } = await tx.query(
        `INSERT INTO hostel_maintenance_tickets (id, institution_id, room_id, room_label,
           title, description, category, priority, status, blocks_room, assigned_to,
           reported_by, resolved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          id,
          ctx.institutionId,
          roomId,
          label,
          input.title,
          input.description,
          input.category,
          input.priority,
          input.status,
          input.blocksRoom,
          input.assignedTo,
          ctx.actorEmail,
          input.status === "Resolved" ? new Date() : null,
        ]
      );
      await writeAudit(tx, ctx, "Created", "Ticket", id, `Opened ticket "${input.title}" for ${label}.`);
      return fromRow(rows[0]);
    });
  },

  update(ctx: HostelContext, id: string, input: TicketInput) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE hostel_maintenance_tickets SET title = $3, description = $4, category = $5,
           priority = $6, status = $7::varchar, blocks_room = $8, assigned_to = $9,
           resolved_at = CASE
             WHEN $7::varchar <> 'Resolved' THEN NULL
             ELSE COALESCE(resolved_at, NOW())
           END,
           updated_at = NOW()
         WHERE institution_id = $1 AND id = $2 RETURNING *`,
        [
          ctx.institutionId,
          id,
          input.title,
          input.description,
          input.category,
          input.priority,
          input.status,
          input.blocksRoom,
          input.assignedTo,
        ]
      );
      if (!rows[0]) throw new HostelError(404, "Ticket not found.");

      await writeAudit(tx, ctx, "Updated", "Ticket", id, `Ticket "${input.title}" for ${rows[0].room_label} is ${input.status}.`);
      return fromRow(rows[0]);
    });
  },

  remove(ctx: HostelContext, id: string) {
    return postgresService.transaction(async (tx) => {
      const { rows } = await tx.query(
        "DELETE FROM hostel_maintenance_tickets WHERE institution_id = $1 AND id = $2 RETURNING title, room_label",
        [ctx.institutionId, id]
      );
      if (!rows[0]) throw new HostelError(404, "Ticket not found.");

      await writeAudit(tx, ctx, "Deleted", "Ticket", id, `Deleted ticket "${rows[0].title}" for ${rows[0].room_label}.`);
    });
  },
};
