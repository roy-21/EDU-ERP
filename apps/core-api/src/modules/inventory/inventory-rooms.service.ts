import { newId } from "../hostel/hostel.common";
import { postgresService } from "../../database/postgres";
import { Actor, audit } from "../identity/identity.service";
import { date, fail, inTx, text, todayBd } from "../academics/academics.common";
import { activeItem, activeStore, assetEvent, docNo, r2, roomLabel, roomOf, skuOf, takeOut } from "./inventory.service";

// Room inventory: what each hostel room holds (2 fans, 3 lights, 2 beds...). Assets are put in a
// room by hand, or taken straight out of stock: buy 20 fans, then send 2 to Room 101, 3 to Room 103
// and keep the rest in the store. The stock leaves the ledger as an issue and each unit becomes an
// asset with its own tag, cost and history, held by its room.

export const roomsService = {
  // Every hostel room with its assets counted by name.
  async list(institutionId: string) {
    const { rows } = await postgresService.query(
      `SELECT r.id, r.hostel_name, r.building, r.floor, r.room_number, r.capacity, r.under_maintenance,
         COALESCE(json_agg(json_build_object('name', g.name, 'count', g.n, 'value', g.value, 'attention', g.attention) ORDER BY g.name)
           FILTER (WHERE g.name IS NOT NULL), '[]') AS assets
       FROM hostel_rooms r
       LEFT JOIN (
         SELECT room_id, name, COUNT(*) AS n, SUM(purchase_cost) AS value,
           COUNT(*) FILTER (WHERE status = 'UNDER_REPAIR' OR condition = 'POOR') AS attention
         FROM inv_assets WHERE institution_id = $1 AND room_id IS NOT NULL AND status NOT IN ('DISPOSED', 'LOST')
         GROUP BY room_id, name) g ON g.room_id = r.id
       WHERE r.institution_id = $1
       GROUP BY r.id ORDER BY r.hostel_name, r.building, r.floor, r.room_number`, [institutionId]);
    return rows.map((row: any) => {
      const assets = (row.assets || []).map((asset: any) => ({ name: asset.name, count: Number(asset.count), value: r2(Number(asset.value)), attention: Number(asset.attention) }));
      return {
        id: row.id, label: roomLabel(row), hostelName: row.hostel_name, building: row.building, floor: row.floor, roomNumber: row.room_number,
        capacity: row.capacity, underMaintenance: row.under_maintenance, assets,
        assetCount: assets.reduce((sum: number, asset: any) => sum + asset.count, 0),
        assetValue: r2(assets.reduce((sum: number, asset: any) => sum + asset.value, 0)),
        needsAttention: assets.reduce((sum: number, asset: any) => sum + asset.attention, 0),
      };
    });
  },

  // Takes units of a stock item out of a store and registers each one as an asset, in a room or at a place.
  async fromStock(actor: Actor, body: any) {
    if (!actor.permissions.includes("inventory.manage_assets")) fail(403, "Registering assets from stock also needs the permission to handle assets.");
    const raw = Array.isArray(body?.allocations) ? body.allocations : [];
    if (raw.length === 0) fail(400, "Say where the units go: a room or a place, and how many.");
    if (raw.length > 100) fail(400, "Allocate to at most 100 places at a time.");
    const allocations = raw.map((entry: any, index: number) => {
      const count = Number(entry?.quantity);
      if (!Number.isInteger(count) || count < 1) fail(400, `Line ${index + 1}: the number of units must be a whole number above 0.`);
      const location = text(entry?.location, `Line ${index + 1} location`, 200);
      if (!entry?.roomId && !location) fail(400, `Line ${index + 1}: choose a room or type a place.`);
      return { roomId: entry?.roomId || null, location, count };
    });
    const total = allocations.reduce((sum: number, entry: any) => sum + entry.count, 0);
    if (total > 500) fail(400, "Register at most 500 assets at a time.");
    const warrantyUntil = date(body?.warrantyUntil, "Warranty end");
    const note = text(body?.note, "Note", 500);
    const no = docNo("ISS");
    const created = await inTx(async (tx) => {
      const store = await activeStore(tx, actor.institutionId, body?.storeId);
      const item = await activeItem(tx, actor.institutionId, body?.itemId);
      // Units: each asset is one whole piece of the item.
      const cost = r2(Number(item.avg_cost));
      const prefix = skuOf(body?.assetTag, "Asset tag prefix", 34) || item.sku;
      const taken = (await tx.query(
        "SELECT asset_tag FROM inv_assets WHERE institution_id = $1 AND LOWER(asset_tag) LIKE LOWER($2) || '-%'", [actor.institutionId, prefix])).rows;
      let next = taken.reduce((max: number, row: any) => {
        const number = Number(String(row.asset_tag).slice(prefix.length + 1));
        return Number.isInteger(number) && number > max ? number : max;
      }, 0) + 1;
      const ids: string[] = [];
      for (const allocation of allocations) {
        const room = allocation.roomId ? await roomOf(tx, actor.institutionId, allocation.roomId) : null;
        const where = room ? roomLabel(room) : allocation.location;
        await takeOut(tx, actor, item, store, allocation.count, {
          kind: "ISSUE", docNo: no, party: where, reference: "Asset register", note: note || `Registered as assets at ${where}`, expenseCategory: "Fixed assets",
        }, { usableOnly: true });
        for (let unit = 0; unit < allocation.count; unit += 1) {
          const id = newId();
          const tag = `${prefix}-${String(next).padStart(3, "0")}`;
          next += 1;
          await tx.query(
            `INSERT INTO inv_assets (id, institution_id, asset_tag, name, category, brand, store_id, location, purchase_cost, purchased_on, warranty_until,
               condition, status, assigned_to, assigned_on, room_id, item_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'NEW', $12, $13, $14, $15, $16, $17)`,
            [id, actor.institutionId, tag, item.name, item.category, item.brand, store.id, where, cost, todayBd(), warrantyUntil,
              room ? "ASSIGNED" : "AVAILABLE", room ? where : "", room ? todayBd() : null, room?.id || null, item.id, note]);
          await assetEvent(tx, actor, id, "REGISTERED", `Taken from stock (${item.sku}, ${no}) into ${where}.`);
          ids.push(id);
        }
      }
      await audit(tx, actor, "inventory.asset.from_stock", "asset", ids[0], `Registered ${total} × "${item.name}" from ${store.name} as assets (${no}).`);
      return ids;
    });
    return { created: created.length, docNo: no };
  },
};
